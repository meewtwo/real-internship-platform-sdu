import { MATCH_NOTIFY_THRESHOLD, matchScore, validateVacancy, type FieldErrors } from '@sdu/shared';
import type { Env } from '../env';
import type { Db } from '../lib/db';
import { iso } from '../lib/sql';
import { audit } from './audit';
import { embedVacancy } from './embeddings';
import { enqueue } from './jobs';
import { almatyToday, loadStudentSignals, VACANCY_SELECT, vacancySignal, type VacancyRow } from './matching';
import { alertSavedSearches } from './savedSearches';

/**
 * Scores every active student against a vacancy (3 queries to load, one atomic batch to write), stores matches >= threshold and notifies up to 300.
 * Idempotent: matches are rebuilt from scratch and a student who already has a "new match" notification for this vacancy is not notified again.
 */
export async function matchStudents(db: Db, v: VacancyRow): Promise<number> {
  const signals = await loadStudentSignals(db);
  const sig = vacancySignal(v);
  const hits: { u: string; p: number }[] = [];
  for (const [id, s] of signals) {
    const m = matchScore(s, sig);
    if (m.percent >= MATCH_NOTIFY_THRESHOLD) hits.push({ u: id, p: m.percent });
  }
  const stmts = [{ sql: 'DELETE FROM matches WHERE vacancy_id = $1', params: [v.id] }];
  if (hits.length) {
    stmts.push(
      { sql: 'INSERT OR IGNORE INTO matches (vacancy_id, student_id, percent) SELECT $1, json_extract(value, \'$.u\'), json_extract(value, \'$.p\') FROM json_each($2)', params: [v.id, JSON.stringify(hits)] },
      { sql: `INSERT INTO notifications (user_id, kind, params, link)
         SELECT json_extract(j.value, '$.u'), 'new_match', json_object('title', $1, 'company', $2, 'percent', json_extract(j.value, '$.p')), $3 FROM json_each($4) j
         WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = json_extract(j.value, '$.u') AND n.kind = 'new_match' AND n.link = $3)`,
        params: [v.title, v.company_name, `/vacancies/${v.id}`, JSON.stringify(hits.slice(0, 300))] },
    );
  }
  await db.batch(stmts);
  return hits.length;
}

export type PublishResult = { ok: true; matches: number; queued: boolean } | { ok: false; fields: FieldErrors };

/**
 * Draft → published, the ONE implementation used by the employer's "Publish" button, by an admin approving the company (drafts the employer asked
 * to publish while waiting) and by the cron sweep. The caller has already checked that the company may publish. Re-validates the stored draft,
 * flips the status atomically (two concurrent publishes cannot both win, so matches/notifications are never doubled), then scores students
 * (inline, or in the background job when a queue is bound) and alerts saved searches; a failed matching run undoes the publish.
 */
export async function publishVacancy(db: Db, env: Env, cur: VacancyRow, actor: { id: string; role: string } | null): Promise<PublishResult> {
  const chk = validateVacancy({
    title: cur.title, description: cur.description, kind: cur.kind, industry: cur.industry_key,
    // drafts saved before the "Other" text existed have none; they stay publishable (the editor asks for it on the next edit)
    industryOther: cur.industry_other ?? (cur.industry_key === 'other' ? 'Other' : undefined), city: cur.city_key, cityOther: cur.city_other ?? undefined,
    workFormat: cur.work_format, minGpa: cur.min_gpa ?? undefined, deadline: cur.deadline ?? undefined, requiredSkills: cur.skills, salaryMin: cur.salary_min ?? undefined, salaryMax: cur.salary_max ?? undefined,
  });
  if (!chk.ok && !(Object.keys(chk.fields).length === 1 && chk.fields.deadline === 'DEADLINE_PAST')) return { ok: false, fields: chk.fields };
  if (cur.deadline && cur.deadline < almatyToday()) return { ok: false, fields: { deadline: 'DEADLINE_PAST' } };
  const queued = !!env.JOBS;
  if (!queued) cur.emb = await embedVacancy(db, env, cur); // semantic vector first (outside the transaction: it calls an external service); a failure just means lexical matching
  const won = await db.query(`UPDATE vacancies SET status = 'published', published_at = COALESCE(published_at, $2), publish_requested_at = NULL WHERE id = $1 AND status = 'draft'`, [cur.id, iso()]);
  if (!won.rowCount) return { ok: true, matches: 0, queued: false };
  let matches = 0;
  try {
    // with a queue binding the heavy part (scoring every student) runs in the background job; otherwise it runs here
    matches = queued ? 0 : await matchStudents(db, cur);
    let alerts = 0;
    if (!queued) {
      try { alerts = await alertSavedSearches(db, cur); }
      catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'saved-search alerts failed', detail: (e as Error).message })); }
    }
    await audit(db, actor, 'vacancy.publish', { type: 'vacancy', id: cur.id }, { matches, alerts, queued });
  } catch (e) {
    // D1 has no multi-step transactions: undo the publish so a failed matching run never leaves a half-published vacancy
    await db.query(`UPDATE vacancies SET status = 'draft', published_at = NULL WHERE id = $1 AND status = 'published'`, [cur.id]).catch(() => undefined);
    throw e;
  }
  if (queued) {
    try { await enqueue(env, { type: 'match_vacancy', vacancyId: cur.id }); }
    catch (e) {
      // the queue is down: do the work now rather than leave a published vacancy with no matches
      console.error(JSON.stringify({ level: 'error', msg: 'enqueue failed, matching inline', detail: (e as Error).message }));
      matches = await matchStudents(db, cur); await alertSavedSearches(db, cur);
      return { ok: true, matches, queued: false };
    }
  }
  return { ok: true, matches, queued };
}

/**
 * Publishes the drafts an employer asked to publish while the company was waiting for approval ("Publish after approval"), once the company is
 * approved — right after the admin's approval and again on every cron run (which also retries anything that failed). A draft that is no longer
 * valid (e.g. its deadline passed meanwhile) keeps its request and stays a draft for the employer to fix. Returns how many were published.
 */
export async function publishRequestedDrafts(db: Db, env: Env, employerId?: string, actor: { id: string; role: string } | null = null): Promise<number> {
  const { rows } = await db.query<VacancyRow>(
    `${VACANCY_SELECT} JOIN users u ON u.id = v.employer_id
     WHERE v.status = 'draft' AND v.publish_requested_at IS NOT NULL AND ep.review_status = 'approved' AND u.status = 'active' ${employerId ? 'AND v.employer_id = $1' : ''}
     ORDER BY v.publish_requested_at LIMIT 50`, employerId ? [employerId] : []);
  let n = 0;
  for (const v of rows) {
    try { const r = await publishVacancy(db, env, v, actor); if (r.ok) n++; }
    catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'requested publish failed', vacancy: v.id, detail: (e as Error).message })); }
  }
  return n;
}
