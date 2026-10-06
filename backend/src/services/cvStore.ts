import type { Env } from '../env';
import { randomToken } from '../lib/crypto';

/** Where a CV's bytes go: R2 when the CV_BUCKET binding exists, else the `cvs.content` column. Both can coexist (old rows keep working). */
export async function storeCvBytes(env: Env, userId: string, bytes: Uint8Array): Promise<{ content: Uint8Array | null; key: string | null }> {
  if (!env.CV_BUCKET) return { content: bytes, key: null };
  const key = `cv/${userId}/${randomToken(12)}`;
  await env.CV_BUCKET.put(key, bytes);
  return { content: null, key };
}

export async function loadCvBytes(env: Env, row: { content: Uint8Array | null; storage_key: string | null }): Promise<Uint8Array | null> {
  if (row.content) return new Uint8Array(row.content);
  if (!row.storage_key || !env.CV_BUCKET) return null;
  const obj = await env.CV_BUCKET.get(row.storage_key);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

/** Best effort: an orphaned object is harmless, a failed delete must never break the user-facing operation. */
export async function removeCvObjects(env: Env, keys: (string | null | undefined)[]): Promise<void> {
  if (!env.CV_BUCKET) return;
  for (const k of keys) if (k) { try { await env.CV_BUCKET.delete(k); } catch (e) { console.error(JSON.stringify({ level: 'warn', msg: 'r2 delete failed', detail: (e as Error).message })); } }
}
