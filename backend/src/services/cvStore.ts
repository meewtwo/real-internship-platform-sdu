import type { Env } from '../env';
import type { Queryable, Stmt } from '../lib/db';
import { randomToken } from '../lib/crypto';

/** `cvs.storage_key` of a CV whose bytes live in `cv_chunks` (R2 keys always start with 'cv/'). */
export const CV_CHUNKED = 'd1-chunks';
/** Largest file kept inline in `cvs.content`: a D1 row is capped at 2,000,000 bytes and also holds the extracted text. Also the chunk size. */
export const CV_INLINE_MAX = 1_000_000;

export interface StoredCv { content: Uint8Array | null; key: string | null; chunks: Uint8Array[] }

/**
 * Where a CV's bytes go: R2 when the CV_BUCKET binding exists; otherwise the database — `cvs.content` when the file fits in one row,
 * else `cv_chunks` (write them with `cvChunkStmts` in the same batch as the `cvs` upsert). Old rows of every kind keep working.
 */
export async function storeCvBytes(env: Env, userId: string, bytes: Uint8Array): Promise<StoredCv> {
  if (env.CV_BUCKET) {
    const key = `cv/${userId}/${randomToken(12)}`;
    await env.CV_BUCKET.put(key, bytes);
    return { content: null, key, chunks: [] };
  }
  if (bytes.length <= CV_INLINE_MAX) return { content: bytes, key: null, chunks: [] };
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += CV_INLINE_MAX) chunks.push(bytes.slice(i, i + CV_INLINE_MAX));
  return { content: null, key: CV_CHUNKED, chunks };
}

/** Replaces the user's chunks; run AFTER the `cvs` upsert in one batch (the chunks reference the row). Clears stale chunks for inline/R2 CVs too. */
export function cvChunkStmts(userId: string, stored: StoredCv): Stmt[] {
  return [
    { sql: 'DELETE FROM cv_chunks WHERE user_id = $1', params: [userId] },
    ...stored.chunks.map((data, seq) => ({ sql: 'INSERT INTO cv_chunks (user_id, seq, data) VALUES ($1, $2, $3)', params: [userId, seq, data] })),
  ];
}

export async function loadCvBytes(env: Env, db: Queryable, row: { user_id: string; size_bytes: number; content: Uint8Array | null; storage_key: string | null }): Promise<Uint8Array | null> {
  if (row.content) return new Uint8Array(row.content);
  if (row.storage_key === CV_CHUNKED) {
    const parts = (await db.query<{ content: Uint8Array }>('SELECT data AS content FROM cv_chunks WHERE user_id = $1 ORDER BY seq', [row.user_id])).rows.map((r) => r.content); // "content": the db layer converts it as a BLOB
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out.length === Number(row.size_bytes) ? out : null; // a missing part must never be served as a truncated file
  }
  if (!row.storage_key || !env.CV_BUCKET) return null;
  const obj = await env.CV_BUCKET.get(row.storage_key);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

/** Best effort: an orphaned object is harmless, a failed delete must never break the user-facing operation. Chunks go with the row (FK cascade). */
export async function removeCvObjects(env: Env, keys: (string | null | undefined)[]): Promise<void> {
  if (!env.CV_BUCKET) return;
  for (const k of keys) if (k && k !== CV_CHUNKED) { try { await env.CV_BUCKET.delete(k); } catch (e) { console.error(JSON.stringify({ level: 'warn', msg: 'r2 delete failed', detail: (e as Error).message })); } }
}
