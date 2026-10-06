import type { Language } from '@sdu/shared';
import { appSecret, type Env } from '../env';
import { constantTimeEqual, hmacHex, randomCode6 } from '../lib/crypto';
import type { Db } from '../lib/db';
import { sendCodeEmail } from '../lib/mail';
import { iso, secondsUntil } from '../lib/sql';

export type Purpose = 'register' | 'reset';
export const CODE_TTL_MIN = 10;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SEC = 60;
export const MAX_SENDS_PER_HOUR = 5;

const hashCode = (env: Env, userId: string, purpose: Purpose, code: string) => hmacHex(appSecret(env), `${userId}:${purpose}:${code}`);

export type IssueResult = { ok: true } | { ok: false; code: 'RESEND_COOLDOWN' | 'RESEND_LIMIT'; retryAfter: number };

/**
 * Creates a fresh code (invalidating older ones), enforcing 60 s cooldown and 5 sends/hour, then emails it. The limits are checked INSIDE the INSERT
 * (one atomic statement), so parallel requests cannot slip past them.
 */
export async function issueCode(
  db: Db, env: Env,
  user: { id: string; email: string; display_name: string },
  purpose: Purpose, lang: Language,
): Promise<IssueResult> {
  const code = randomCode6();
  const codeHash = await hashCode(env, user.id, purpose, code);
  const cooldownCut = iso(-RESEND_COOLDOWN_SEC * 1000), hourCut = iso(-3600_000);
  const ins = await db.query<{ id: number }>(
    `INSERT INTO email_verifications (user_id, purpose, code_hash, expires_at)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM email_verifications WHERE user_id = $1 AND purpose = $2 AND created_at > $5)
       AND (SELECT count(*) FROM email_verifications WHERE user_id = $1 AND purpose = $2 AND created_at > $6) < $7
     RETURNING id`,
    [user.id, purpose, codeHash, iso(CODE_TTL_MIN * 60_000), cooldownCut, hourCut, MAX_SENDS_PER_HOUR],
  );
  if (!ins.rows[0]) {
    const last = (await db.query<{ created_at: string }>('SELECT created_at FROM email_verifications WHERE user_id = $1 AND purpose = $2 ORDER BY id DESC LIMIT 1', [user.id, purpose])).rows[0];
    if (last && last.created_at > cooldownCut) return { ok: false, code: 'RESEND_COOLDOWN', retryAfter: secondsUntil(iso(Date.parse(last.created_at) + RESEND_COOLDOWN_SEC * 1000 - Date.now())) };
    const first = (await db.query<{ created_at: string }>('SELECT min(created_at) AS created_at FROM email_verifications WHERE user_id = $1 AND purpose = $2 AND created_at > $3', [user.id, purpose, hourCut])).rows[0];
    return { ok: false, code: 'RESEND_LIMIT', retryAfter: first?.created_at ? secondsUntil(new Date(Date.parse(first.created_at) + 3600_000).toISOString()) : 1 };
  }
  await db.query('UPDATE email_verifications SET consumed_at = $4 WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND id < $3', [user.id, purpose, ins.rows[0].id, iso()]);
  await sendCodeEmail(env, { to: user.email, lang, purpose, code, name: user.display_name });
  return { ok: true };
}

export type CheckResult = 'ok' | 'invalid' | 'expired' | 'too_many';

/** Verifies a code: ≤5 attempts, 10 min expiry, single use. Every attempt is counted by an atomic UPDATE, so parallel guesses cannot exceed the limit. */
export async function checkCode(db: Db, env: Env, userId: string, purpose: Purpose, code: string): Promise<CheckResult> {
  const row = (await db.query<{ id: number; code_hash: string; attempts: number; expires_at: string }>(
    `SELECT id, code_hash, attempts, expires_at FROM email_verifications WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`, [userId, purpose])).rows[0];
  if (!row) return 'invalid';
  if (row.expires_at <= iso()) return 'expired';
  if (row.attempts >= MAX_ATTEMPTS) return 'too_many';
  const match = constantTimeEqual(await hashCode(env, userId, purpose, code), row.code_hash);
  const upd = await db.query<{ attempts: number }>(
    `UPDATE email_verifications SET attempts = attempts + 1, consumed_at = CASE WHEN $2 THEN $3 ELSE consumed_at END
     WHERE id = $1 AND consumed_at IS NULL AND attempts < $4 RETURNING attempts`, [row.id, match, iso(), MAX_ATTEMPTS]);
  if (!upd.rows[0]) return 'too_many'; // another request used the last attempt or consumed the code first
  if (match) return 'ok';
  return upd.rows[0].attempts >= MAX_ATTEMPTS ? 'too_many' : 'invalid';
}
