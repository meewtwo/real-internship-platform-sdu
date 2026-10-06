import type { Language } from '@sdu/shared';
import type { Env } from '../env';
import type { Db } from '../lib/db';
import { sendMail } from '../lib/mail';
import { iso } from '../lib/sql';
import { mailLinks } from './emailLinks';
import { instantEmail } from './emailText';

export const INSTANT_KINDS = ['status_changed', 'invitation', 'new_application', 'employer_approved', 'new_message', 'interview_update'] as const;
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 2 * 86400_000;
const CLAIM_TTL_MS = 2 * 60_000;

interface Row { id: number; user_id: string; kind: string; params: Record<string, unknown>; link: string | null; email: string; lang: Language; status: string; instant: boolean; name: string }

/**
 * Outbox pattern: notifications are the queue. A batch is CLAIMED with one atomic UPDATE (claims expire after 2 minutes, so a crashed worker's rows are
 * retried), so concurrent flushes (request hooks + cron) never send the same mail twice. A failed send is retried (≤5 attempts, ≤2 days old) and never
 * blocks the action that created it.
 */
export async function flushInstantEmails(db: Db, env: Env, base: string, limit = 25): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const now = iso();
  const claimed = await db.query<{ id: number }>(
    `UPDATE notifications SET email_claimed_at = $1 WHERE id IN (
       SELECT id FROM notifications WHERE emailed_at IS NULL AND kind IN (SELECT value FROM json_each($2)) AND email_attempts < $3 AND created_at > $4
         AND (email_claimed_at IS NULL OR email_claimed_at < $5) ORDER BY id LIMIT $6) RETURNING id`,
    [now, JSON.stringify(INSTANT_KINDS), MAX_ATTEMPTS, iso(-MAX_AGE_MS), iso(-CLAIM_TTL_MS), limit]);
  if (!claimed.rows.length) return out;
  const { rows } = await db.query<Row>(
    `SELECT n.id, n.user_id, n.kind, n.params, n.link, u.email, u.preferred_language AS lang, u.status, COALESCE(p.email_instant, 1) AS instant,
            COALESCE(sp.name, ep.contact_name, '') AS name
     FROM notifications n JOIN users u ON u.id = n.user_id
     LEFT JOIN notification_prefs p ON p.user_id = n.user_id LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN employer_profiles ep ON ep.user_id = u.id
     WHERE n.id IN (SELECT value FROM json_each($1)) ORDER BY n.id`, [JSON.stringify(claimed.rows.map((r) => r.id))]);
  for (const r of rows) {
    if (!r.instant || r.status !== 'active') { await db.query('UPDATE notifications SET emailed_at = $2 WHERE id = $1', [r.id, iso()]); out.skipped++; continue; }
    const links = await mailLinks(env, base, r.user_id, 'instant', r.link ?? '/notifications');
    const mail = instantEmail(r.lang, r.kind, r.params, r.name, links);
    if (!mail) { await db.query('UPDATE notifications SET emailed_at = $2 WHERE id = $1', [r.id, iso()]); out.skipped++; continue; }
    const ok = await sendMail(env, { to: r.email, kind: `notification.${r.kind}`, ...mail });
    if (ok) { await db.query('UPDATE notifications SET emailed_at = $2 WHERE id = $1', [r.id, iso()]); out.sent++; }
    else { await db.query('UPDATE notifications SET email_attempts = email_attempts + 1, email_claimed_at = NULL WHERE id = $1', [r.id]); out.failed++; }
  }
  return out;
}
