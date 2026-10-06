import type { Language } from '@sdu/shared';
import type { Env } from '../env';
import type { Db } from '../lib/db';
import { sendMail } from '../lib/mail';
import { mailLinks } from './emailLinks';
import { digestEmail, digestIsEmpty, digestLabels, type DigestData, type DigestItem } from './emailText';
import { SQL_TODAY } from './matching';
import { isoAt } from '../lib/sql';

const MIN_GAP_DAYS = 6;
const TOP = 5;

interface Cand { id: string; role: 'student' | 'employer'; email: string; lang: Language; name: string }

async function collect(db: Db, c: Cand, since: string, base: string, lang: Language): Promise<DigestData> {
  const L = digestLabels(lang);
  const d: DigestData = { role: c.role, matches: [], saved: [], status: [], deadlines: [], applicants: [], pending: 0 };
  if (c.role === 'student') {
    d.matches = (await db.query<{ id: string; title: string; company: string; percent: number }>(
      `SELECT v.id, v.title, ep.company_name AS company, m.percent FROM matches m JOIN vacancies v ON v.id = m.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id
       WHERE m.student_id = $1 AND m.created_at > $2 AND m.percent >= 60 AND v.status = 'published' AND (v.deadline IS NULL OR v.deadline >= ${SQL_TODAY})
         AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = v.id AND a.student_id = $1 AND a.status <> 'withdrawn')
       ORDER BY m.percent DESC, v.id LIMIT ${TOP}`, [c.id, since])).rows.map((r) => ({ title: r.title, sub: `${r.company} · ${L.match(r.percent)}`, url: `${base}/vacancies/${r.id}` }));
    const notes = async (kind: string) => (await db.query<{ params: Record<string, unknown>; link: string | null }>(
      `SELECT params, link FROM notifications WHERE user_id = $1 AND kind = $2 AND created_at > $3 ORDER BY id DESC LIMIT ${TOP}`, [c.id, kind, since])).rows;
    d.saved = (await notes('saved_search')).map((n) => ({ title: String(n.params.title ?? ''), sub: String(n.params.company ?? ''), url: `${base}${n.link ?? '/vacancies'}` }));
    d.status = (await notes('status_changed')).map((n) => ({ title: String(n.params.title ?? ''), sub: `${String(n.params.company ?? '')} · ${L.status[String(n.params.status)] ?? String(n.params.status ?? '')}`, url: `${base}/applications` }));
    d.deadlines = (await db.query<{ id: string; title: string; deadline: string }>(
      `SELECT v.id, v.title, v.deadline AS deadline FROM favorites f JOIN vacancies v ON v.id = f.vacancy_id
       WHERE f.user_id = $1 AND v.status = 'published' AND v.deadline BETWEEN ${SQL_TODAY} AND date('now', '+5 hours', '+7 days')
         AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = v.id AND a.student_id = $1 AND a.status <> 'withdrawn')
       ORDER BY v.deadline, v.id LIMIT ${TOP}`, [c.id])).rows.map((r) => ({ title: r.title, sub: L.deadline(r.deadline), url: `${base}/vacancies/${r.id}` }));
  } else {
    d.applicants = (await db.query<{ id: string; title: string; n: number }>(
      `SELECT v.id, v.title, count(*) AS n FROM applications a JOIN vacancies v ON v.id = a.vacancy_id
       WHERE v.employer_id = $1 AND a.created_at > $2 AND a.status <> 'withdrawn' GROUP BY v.id, v.title ORDER BY n DESC, v.id LIMIT ${TOP}`, [c.id, since]))
      .rows.map((r) => ({ title: r.title, sub: L.apps(r.n), url: `${base}/vacancies/${r.id}/applicants` }));
    d.pending = (await db.query<{ n: number }>(`SELECT count(*) AS n FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE v.employer_id = $1 AND a.status = 'applied'`, [c.id])).rows[0].n;
    if (!d.applicants.length) d.pending = 0; // only nag about the backlog in weeks when something new also arrived
  }
  return d;
}

/**
 * Weekly digest. A user is claimed under a row lock (so two concurrent runs cannot both mail them), mailed only when there is something to say,
 * and the claim is rolled back if the send fails or there was nothing to report — so the next run retries.
 */
export async function runDigest(db: Db, env: Env, o: { base: string; now?: Date; limit?: number; userId?: string }): Promise<{ considered: number; sent: number; skipped: number; failed: number }> {
  const nowDate = o.now ?? new Date();
  const now = nowDate.toISOString();
  const cutoff = isoAt(nowDate, -MIN_GAP_DAYS * 86400_000);
  const out = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const cands = (await db.query<Cand & { last_digest_at: string | null }>(
    `SELECT u.id, u.role, u.email, u.preferred_language AS lang, COALESCE(sp.name, ep.contact_name, '') AS name, u.last_digest_at
     FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN employer_profiles ep ON ep.user_id = u.id LEFT JOIN notification_prefs p ON p.user_id = u.id
     WHERE u.status = 'active' AND u.role IN ('student', 'employer') AND COALESCE(p.email_digest, 1) = 1
       AND (u.last_digest_at IS NULL OR u.last_digest_at < $1) ${o.userId ? 'AND u.id = $3' : ''}
     ORDER BY u.id LIMIT $2`, o.userId ? [cutoff, o.limit ?? 200, o.userId] : [cutoff, o.limit ?? 200])).rows;
  for (const c of cands) {
    out.considered++;
    // claim = compare-and-set on last_digest_at: of several concurrent runs exactly one UPDATE matches
    const prev = c.last_digest_at;
    const claim = await db.query('UPDATE users SET last_digest_at = $2 WHERE id = $1 AND status = \'active\' AND last_digest_at IS $3 RETURNING id', [c.id, now, prev]);
    if (!claim.rowCount) { out.skipped++; continue; }
    const restore = () => db.query('UPDATE users SET last_digest_at = $2 WHERE id = $1 AND last_digest_at = $3', [c.id, prev, now]);
    try {
      const since = prev ?? new Date(nowDate.getTime() - 7 * 86400_000).toISOString();
      const data = await collect(db, c, since, o.base, c.lang);
      if (digestIsEmpty(data)) { await restore(); out.skipped++; continue; }
      const mail = digestEmail(c.lang, c.name, data, await mailLinks(env, o.base, c.id, 'digest', '/dashboard'));
      if (await sendMail(env, { to: c.email, kind: 'digest', ...mail })) out.sent++;
      else { await restore(); out.failed++; }
    } catch (e) {
      await restore().catch(() => undefined);
      out.failed++;
      console.error(JSON.stringify({ level: 'error', msg: 'digest failed for one user', detail: (e as Error).message }));
    }
  }
  return out;
}
