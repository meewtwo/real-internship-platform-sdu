import type { Env } from '../env';
import type { Db } from '../lib/db';
import { UUID_RE } from '../lib/http';
import { VACANCY_SELECT, type VacancyRow } from './matching';
import { matchStudents } from './publish';
import { alertSavedSearches } from './savedSearches';
import { embedVacancy } from './embeddings';

export type Job = { type: 'match_vacancy'; vacancyId: string };

export async function enqueue(env: Env, job: Job): Promise<boolean> {
  if (!env.JOBS) return false;
  await env.JOBS.send(job);
  return true;
}

/**
 * Runs one background job. Queues deliver AT LEAST once, so every job is idempotent: matches are rebuilt from scratch and notifications are
 * only created for students who have none yet. Unknown/malformed jobs and vacancies that are gone or no longer published are acknowledged and ignored.
 */
export async function processJob(db: Db, env: Env, raw: unknown): Promise<'done' | 'skipped'> {
  const j = raw as Partial<Job> | null;
  if (!j || typeof j !== 'object' || j.type !== 'match_vacancy' || typeof j.vacancyId !== 'string' || !UUID_RE.test(j.vacancyId)) return 'skipped';
  const v = (await db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1 AND v.status = 'published'`, [j.vacancyId])).rows[0];
  if (!v) return 'skipped';
  v.emb = await embedVacancy(db, env, v);
  await matchStudents(db, v);
  try { await alertSavedSearches(db, v); }
  catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'saved-search alerts failed', detail: (e as Error).message })); }
  return 'done';
}
