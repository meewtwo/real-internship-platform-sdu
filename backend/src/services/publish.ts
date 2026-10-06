import { MATCH_NOTIFY_THRESHOLD, matchScore } from '@sdu/shared';
import type { Db } from '../lib/db';
import { loadStudentSignals, vacancySignal, type VacancyRow } from './matching';

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
