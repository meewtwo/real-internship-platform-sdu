import type { Env } from '../env';

/**
 * Database access for SQLite (Cloudflare D1 in production; node:sqlite locally and in tests — the same engine, so SQL behaves identically).
 *
 * Rules the whole code base follows because D1 has NO interactive transactions and NO row locks:
 *  - every statement is atomic on its own; guards live INSIDE the statement (INSERT … SELECT … WHERE count < n, UPDATE … WHERE version = ?);
 *  - several writes that must succeed together go through `db.batch([...])` (one implicit transaction, no reads in between);
 *  - claims (emails, digests…) are compare-and-set UPDATEs, never "select, then update".
 * Placeholders are written `$1, $2 …` and translated to SQLite's `?1, ?2 …`.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export interface Stmt { sql: string; params?: unknown[] }
export type Result<T = Record<string, unknown>> = { rows: T[]; rowCount: number };

/** What a driver must provide. Parameters are already converted to SQLite-bindable values. */
export interface Driver {
  run(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[]; changes: number }>;
  batch(stmts: { sql: string; params: unknown[] }[]): Promise<{ rows: Record<string, unknown>[]; changes: number }[]>;
}
let nodeDriverFactory: ((env: Env) => Driver) | null = null;
/** Called once by Node entry points (server, CLI, tests) so the Worker bundle never references node:sqlite. */
export const registerNodeDriver = (f: (env: Env) => Driver) => { nodeDriverFactory = f; };

// ───────────────────────── value conversion ─────────────────────────
/** Columns SQLite returns as 0/1 that the application treats as booleans. */
export const BOOL_COLS = new Set(['remember', 'enabled', 'free', 'public_contact', 'email_digest', 'email_instant', 'instant', 'expired', 'has_cv', 'invited', 'locked', 'favorite']);
/** Columns holding JSON text that the application treats as parsed values. */
export const JSON_COLS = new Set(['params', 'filters', 'meta', 'data', 'response', 'courses', 'experience_items', 'extracted_skills', 'interests', 'inferred_skills', 'events', 'skills', 'cv_skills', 'history', 'requiredSkills', 'inferredSkills']);
const BLOB_COLS = new Set(['content', 'vec', 'emb']);

export function toParam(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return v;
  if (typeof v === 'object') return JSON.stringify(v); // arrays and plain objects are stored as JSON text
  return v;
}
export function fromRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(r)) {
    let v = r[k];
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (BOOL_COLS.has(k) && typeof v === 'number') v = v !== 0;
    else if (JSON_COLS.has(k) && typeof v === 'string') { try { v = JSON.parse(v); } catch { /* leave as text */ } }
    else if (BLOB_COLS.has(k) && Array.isArray(v)) v = Uint8Array.from(v as number[]); // D1 returns BLOBs as number arrays
    else if (BLOB_COLS.has(k) && v instanceof ArrayBuffer) v = new Uint8Array(v);
    out[k] = v;
  }
  return out;
}

const translated = new Map<string, string>();
/** `$1` → `?1`, skipping anything inside single-quoted string literals. */
export function translate(sql: string): string {
  const hit = translated.get(sql);
  if (hit !== undefined) return hit;
  let out = '', inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") { inStr = !inStr; out += ch; continue; }
    if (!inStr && ch === '$' && /[0-9]/.test(sql[i + 1] ?? '')) { out += '?'; continue; }
    out += ch;
  }
  if (translated.size > 2000) translated.clear();
  translated.set(sql, out);
  return out;
}

/** Highest placeholder number in the query = how many parameters it takes (SQLite rejects extra ones; D1 caps at 100). */
function usedParams(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\?(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

// ───────────────────────── D1 driver ─────────────────────────
function d1Driver(env: Env): Driver {
  const prep = (s: { sql: string; params: unknown[] }) => env.DB!.prepare(s.sql).bind(...s.params.slice(0, usedParams(s.sql)));
  const norm = (r: { results?: unknown[]; meta?: { changes?: number } }) => ({ rows: (r.results ?? []) as Record<string, unknown>[], changes: r.meta?.changes ?? 0 });
  return {
    run: async (sql, params) => norm(await prep({ sql, params }).all()),
    batch: async (stmts) => (await env.DB!.batch(stmts.map(prep))).map(norm),
  };
}

export class Db implements Queryable {
  private driver: Driver;
  /** Set by notify(): tells the request pipeline there are fresh notifications to e-mail once the response work is done. */
  notified = false;
  markNotified() { this.notified = true; }

  constructor(env: Env) {
    if (env.DB) this.driver = d1Driver(env);
    else if (nodeDriverFactory) this.driver = nodeDriverFactory(env);
    else throw new Error('No database configured (bind D1 as DB, or register the Node SQLite driver)');
  }

  private prepare(text: string, params: unknown[]) {
    const sql = translate(text);
    if (/insert\s+into\s+notifications/i.test(sql)) this.notified = true;
    return { sql, params: params.map(toParam), returns: /^\s*(select|with|pragma)\b|\breturning\b/i.test(sql) };
  }
  private shape(r: { rows: Record<string, unknown>[]; changes: number }, returns: boolean): Result {
    const rows = r.rows.map(fromRow);
    return { rows, rowCount: returns ? rows.length : r.changes };
  }

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<Result<T>> {
    const p = this.prepare(text, params);
    return this.shape(await this.driver.run(p.sql, p.params), p.returns) as Result<T>;
  }

  /** Atomic multi-statement write: all succeed or none do. Statements cannot read each other's results — put guards inside the SQL. */
  async batch(stmts: Stmt[]): Promise<Result[]> {
    if (!stmts.length) return [];
    const ps = stmts.map((s) => this.prepare(s.sql, s.params ?? []));
    const rs = await this.driver.batch(ps.map((p) => ({ sql: p.sql, params: p.params })));
    return rs.map((r, i) => this.shape(r, ps[i].returns));
  }

  async close() { /* connections are shared (D1 binding / one SQLite handle); nothing to release */ }
}

// ───────────────────────── errors ─────────────────────────
export interface DbError { code?: string; constraint?: string; message?: string }
const UNIQUE_NAMES: Record<string, string> = {
  'users.student_id': 'users_student_id_uq', 'users.email': 'users_email_uq', 'users.phone': 'users_phone_uq', 'employer_profiles.bin': 'employer_bin_uq',
  'applications.vacancy_id,student_id': 'applications_once_uq', 'saved_searches.user_id,name': 'saved_searches_name_uq', 'interviews.application_id': 'interviews_one_active_uq',
  'resume_docs.public_slug': 'resume_docs_slug_uq', 'skills.name_key': 'skills_name_key_uq', 'telegram_links.chat_id': 'telegram_links_chat_uq',
};
/** Maps SQLite/D1 errors to the PostgreSQL-style codes the routes already understand (23505 unique, 23514 check, 23503 foreign key). */
export function asDbError(e: unknown): DbError {
  const message = e instanceof Error ? e.message : typeof e === 'object' && e !== null ? String((e as { message?: unknown }).message ?? '') : String(e);
  const u = /UNIQUE constraint failed: ([^:]+)/.exec(message);
  if (u) {
    const cols = u[1].split(',').map((x) => x.trim());
    const table = cols[0].split('.')[0];
    const key = `${table}.${cols.map((c) => c.split('.').pop()).join(',')}`;
    return { code: '23505', constraint: UNIQUE_NAMES[key] ?? key, message };
  }
  const c = /CHECK constraint failed: (\w+)/.exec(message);
  if (c) return { code: '23514', constraint: c[1], message };
  if (/FOREIGN KEY constraint failed/.test(message)) return { code: '23503', message };
  if (/TAGS_TOO_MANY|VACANCY_SKILLS_TOO_MANY/.test(message)) return { code: '23514', message };
  return { message };
}
export const asPgError = asDbError;
