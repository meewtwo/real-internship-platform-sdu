/**
 * Semantic embeddings for matching. Provider order: test override → Workers AI binding → OpenAI-compatible endpoint. With none configured every
 * function is a no-op and matching stays lexical. Everything that fails here degrades to the lexical score — it can never break a request.
 * Texts sent to the provider are PII-redacted first (names, e-mails, phones, links, ids).
 */
import { fromBytes, quantize, type StudentSignal } from '@sdu/shared';
import { iso } from '../lib/sql';
import type { Env } from '../env';
import { Db, type Queryable } from '../lib/db';
import { sha256Hex } from '../lib/crypto';
import { redactPii } from './ai';
import { loadStudentSignals, VACANCY_SELECT, type VacancyRow } from './matching';

export interface Embedder { model: string; embed(texts: string[]): Promise<number[][]> }
let override: Embedder | null = null;
export const setEmbedder = (e: Embedder | null) => { override = e; };

const MAX_TEXTS = 32;
const MAX_CHARS = 3000;

export function getEmbedder(env: Env): Embedder | null {
  if (override) return override;
  if (env.AI) {
    const model = env.EMBED_MODEL ?? '@cf/baai/bge-m3';
    return { model, embed: async (texts) => {
      const r = (await env.AI!.run(model, { text: texts })) as { data?: number[][] };
      return validate(r?.data, texts.length);
    } };
  }
  if (env.EMBED_API_KEY && env.EMBED_BASE_URL) {
    const model = env.EMBED_MODEL ?? 'text-embedding-3-small';
    const base = env.EMBED_BASE_URL.replace(/\/+$/, '');
    return { model, embed: async (texts) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20_000);
      try {
        const r = await fetch(`${base}/embeddings`, { method: 'POST', signal: ctl.signal, headers: { authorization: `Bearer ${env.EMBED_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts }) });
        if (!r.ok) throw new Error(`embeddings status ${r.status}`);
        const j = (await r.json()) as { data?: { index?: number; embedding?: number[] }[] };
        const sorted = [...(j.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding as number[]);
        return validate(sorted, texts.length);
      } finally { clearTimeout(timer); }
    } };
  }
  return null;
}
export const embeddingsEnabled = (env: Env) => getEmbedder(env) !== null;

function validate(data: unknown, n: number): number[][] {
  if (!Array.isArray(data) || data.length !== n) throw new Error('unexpected embeddings response shape');
  for (const v of data) if (!Array.isArray(v) || v.length === 0 || v.length > 4096 || v.some((x) => typeof x !== 'number')) throw new Error('invalid embedding vector');
  return data as number[][];
}

const humanize = (k: string) => k.replace(/_/g, ' ');
export function studentText(s: StudentSignal, names: string[]): string {
  const parts = [humanize(s.majorKey), humanize(s.interestArea), [...new Set([...s.skills, ...s.cvSkills])].join(', '), s.interests.join(', '), s.cvText.slice(0, MAX_CHARS)];
  return redactPii(parts.filter(Boolean).join('. '), names).slice(0, MAX_CHARS);
}
export function vacancyText(v: Pick<VacancyRow, 'title' | 'skills' | 'description'>): string {
  return redactPii(`${v.title}. ${v.skills.join(', ')}. ${v.description.slice(0, MAX_CHARS)}`).slice(0, MAX_CHARS);
}

type Kind = 'student' | 'vacancy';
const T = { student: { table: 'student_embeddings', key: 'user_id' }, vacancy: { table: 'vacancy_embeddings', key: 'vacancy_id' } } as const;

async function existingHash(q: Queryable, kind: Kind, id: string, model: string): Promise<{ hash: string; vec: Uint8Array } | null> {
  const r = (await q.query<{ content_hash: string; vec: Uint8Array; model: string }>(`SELECT content_hash, vec, model FROM ${T[kind].table} WHERE ${T[kind].key} = $1`, [id])).rows[0];
  return r && r.model === model ? { hash: r.content_hash, vec: r.vec } : null;
}
async function save(q: Queryable, kind: Kind, id: string, model: string, vec: Int8Array, hash: string) {
  await q.query(
    `INSERT INTO ${T[kind].table} (${T[kind].key}, model, dim, vec, content_hash) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (${T[kind].key}) DO UPDATE SET model = $2, dim = $3, vec = $4, content_hash = $5, updated_at = $6`, [id, model, vec.length, new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength), hash, iso()]);
}

/** Embeds (or reuses, when the content hash is unchanged) one text. Returns the stored bytes or null on any failure. */
async function ensure(q: Queryable, env: Env, kind: Kind, id: string, text: string): Promise<Uint8Array | null> {
  const e = getEmbedder(env);
  if (!e || !text.trim()) return null;
  try {
    const hash = await sha256Hex(`${e.model}\n${text}`);
    const have = await existingHash(q, kind, id, e.model);
    if (have && have.hash === hash) return have.vec;
    const [raw] = await e.embed([text]);
    const vec = quantize(raw);
    if (!vec) return null;
    await save(q, kind, id, e.model, vec, hash);
    return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  } catch (err) {
    console.error(JSON.stringify({ level: 'warn', msg: 'embedding failed, matching stays lexical', kind, detail: (err as Error).message }));
    return null;
  }
}

export const embedVacancy = (q: Queryable, env: Env, v: Pick<VacancyRow, 'id' | 'title' | 'skills' | 'description'>) => ensure(q, env, 'vacancy', v.id, vacancyText(v));

export async function embedStudent(q: Queryable, env: Env, userId: string): Promise<Uint8Array | null> {
  if (!embeddingsEnabled(env)) return null;
  const s = (await loadStudentSignals(q, [userId])).get(userId);
  if (!s) return null;
  const nm = (await q.query<{ name: string; surname: string }>('SELECT name, surname FROM student_profiles WHERE user_id = $1', [userId])).rows[0];
  return ensure(q, env, 'student', userId, studentText(s, nm ? [nm.name, nm.surname] : []));
}

/**
 * Runs `fn` after the response when the platform allows (Workers waitUntil), else inline; always with its own connection and never throwing.
 * Used to refresh a student's embedding after profile/CV changes without making the save wait for the model.
 */
export async function afterResponse(c: { env: Env; executionCtx?: unknown }, fn: (db: Db) => Promise<void>): Promise<void> {
  if (!embeddingsEnabled(c.env)) return;
  const run = async () => { const db = new Db(c.env); try { await fn(db); } catch (e) { console.error(JSON.stringify({ level: 'warn', msg: 'background task failed', detail: (e as Error).message })); } finally { await db.close(); } };
  try { (c.executionCtx as { waitUntil(p: Promise<unknown>): void }).waitUntil(run()); } catch { await run(); }
}

/** Embeds students/vacancies that have no vector yet (cron + admin backfill). Bounded and batched. */
export async function backfillEmbeddings(db: Db, env: Env, limit = 50): Promise<{ vacancies: number; students: number }> {
  const out = { vacancies: 0, students: 0 };
  const e = getEmbedder(env);
  if (!e) return out;
  const vs = (await db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.status = 'published' AND ve.vacancy_id IS NULL ORDER BY v.published_at DESC LIMIT $1`, [limit])).rows;
  for (const v of vs) if (await embedVacancy(db, env, v)) out.vacancies++;
  const ids = (await db.query<{ user_id: string }>(`SELECT sp.user_id FROM student_profiles sp JOIN users u ON u.id = sp.user_id AND u.status = 'active' LEFT JOIN student_embeddings se ON se.user_id = sp.user_id WHERE se.user_id IS NULL ORDER BY sp.user_id LIMIT $1`, [limit])).rows;
  for (const r of ids) if (await embedStudent(db, env, r.user_id)) out.students++;
  return out;
}
export { fromBytes };
