import type { Queryable } from './db';
import type { Env } from '../env';
import { iso, secondsUntil } from './sql';

export interface RateResult { allowed: boolean; retryAfter: number; count: number }

/** Atomic fixed-window counter in the database (no shared memory on Workers): one UPSERT, so concurrent requests cannot lose increments. */
export async function rateLimit(db: Queryable, env: Env, key: string, limit: number, windowSec: number): Promise<RateResult> {
  const mult = Math.max(1, Number(env.RATE_LIMIT_MULTIPLIER ?? 1) || 1);
  const now = iso();
  const { rows } = await db.query<{ count: number; reset_at: string }>(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count    = CASE WHEN reset_at <= $3 THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= $3 THEN $2 ELSE reset_at END
     RETURNING count, reset_at`,
    [key, iso(windowSec * 1000), now],
  );
  if (Math.random() < 0.01) await db.query('DELETE FROM rate_limits WHERE reset_at < $1', [iso(-86400_000)]);
  const { count, reset_at } = rows[0];
  return { allowed: count <= limit * mult, retryAfter: secondsUntil(reset_at), count };
}

/** Reads a counter without incrementing it. */
export async function rateState(db: Queryable, key: string): Promise<{ count: number; retryAfter: number }> {
  const { rows } = await db.query<{ count: number; reset_at: string }>('SELECT count, reset_at FROM rate_limits WHERE key = $1 AND reset_at > $2', [key, iso()]);
  return rows[0] ? { count: rows[0].count, retryAfter: secondsUntil(rows[0].reset_at) } : { count: 0, retryAfter: 0 };
}

export async function rateReset(db: Queryable, key: string) {
  await db.query('DELETE FROM rate_limits WHERE key = $1', [key]);
}
