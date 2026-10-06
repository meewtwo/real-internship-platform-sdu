import { skillKey } from '@sdu/shared';
import type { Stmt } from './db';

/** Current instant as the ISO-8601 text used for every timestamp column (sorts and compares correctly as a string). */
export const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/** Today's date in Asia/Almaty (UTC+5, no DST) as 'YYYY-MM-DD'. */
export const TODAY = "date('now','+5 hours')";
export const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
/**
 * ISO timestamp with 6 extra random digits ('…24.469' + 'a1b2c3' + 'Z'). Used as a per-attempt PROOF stamp in guarded batches: two attempts in the same
 * millisecond (even on different isolates) must never share a stamp, or the loser could mistake the winner's row for its own.
 */
export const uniqueStamp = () => new Date().toISOString().replace('Z', String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0') + 'Z');
export const isoAt = (d: Date, ms = 0) => new Date(d.getTime() + ms).toISOString();
/** Seconds until an ISO instant, rounded up, at least 1. */
export const secondsUntil = (isoTs: string, from = Date.now()) => Math.max(1, Math.ceil((Date.parse(isoTs) - from) / 1000));

/** Statements that replace the skill set of one owner (student/vacancy). Run them inside `db.batch` so the swap is atomic. */
export function replaceSkillsStmts(table: 'student_skills' | 'vacancy_skills', ownerCol: 'user_id' | 'vacancy_id', ownerId: string, names: string[]): Stmt[] {
  const seen = new Map<string, string>();
  for (const n of names) { const k = skillKey(n); if (!seen.has(k)) seen.set(k, n); }
  const rows = [...seen].map(([k, n]) => ({ k, n }));
  const out: Stmt[] = [{ sql: `DELETE FROM ${table} WHERE ${ownerCol} = $1`, params: [ownerId] }];
  if (rows.length) {
    out.push(
      { sql: `INSERT INTO skills (name, name_key) SELECT json_extract(value, '$.n'), json_extract(value, '$.k') FROM json_each($1) WHERE true ON CONFLICT (name_key) DO NOTHING`, params: [JSON.stringify(rows)] },
      { sql: `INSERT OR IGNORE INTO ${table} (${ownerCol}, skill_id) SELECT $1, s.id FROM skills s WHERE s.name_key IN (SELECT value FROM json_each($2))`, params: [ownerId, JSON.stringify(rows.map((r) => r.k))] },
    );
  }
  return out;
}

/** Status-history row for an application, guarded: only when the application really is in `status` and that is not already the latest event. */
export const appEventStmt = (appId: string, status: string): Stmt => ({
  sql: `INSERT INTO application_events (application_id, status) SELECT $1, $2 WHERE (SELECT status FROM applications WHERE id = $1) = $2
        AND COALESCE((SELECT status FROM application_events WHERE application_id = $1 ORDER BY id DESC LIMIT 1), '') <> $2`,
  params: [appId, status],
});

/** Adds skills to a student without removing any (new names join the vocabulary). The cap of 30 is enforced inside the statement and by a DB trigger. */
export function addStudentSkillsStmts(userId: string, names: string[], max = 30): Stmt[] {
  const seen = new Map<string, string>();
  for (const n of names) { const k = skillKey(n); if (!seen.has(k)) seen.set(k, n); }
  const rows = [...seen].map(([k, n]) => ({ k, n }));
  if (!rows.length) return [];
  return [
    { sql: `INSERT INTO skills (name, name_key) SELECT json_extract(value, '$.n'), json_extract(value, '$.k') FROM json_each($1) WHERE true ON CONFLICT (name_key) DO NOTHING`, params: [JSON.stringify(rows)] },
    { sql: `INSERT OR IGNORE INTO student_skills (user_id, skill_id) SELECT $1, s.id FROM skills s
            WHERE s.name_key IN (SELECT value FROM json_each($2)) AND s.id NOT IN (SELECT skill_id FROM student_skills WHERE user_id = $1)
            LIMIT MAX(0, $3 - (SELECT count(*) FROM student_skills WHERE user_id = $1))`, params: [userId, JSON.stringify(rows.map((r) => r.k)), max] },
  ];
}
