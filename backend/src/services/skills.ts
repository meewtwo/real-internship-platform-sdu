import type { Db, Queryable } from '../lib/db';
import { addStudentSkillsStmts, replaceSkillsStmts } from '../lib/sql';

/** Replaces a student's skills atomically (case-insensitive dedupe; new names join the shared vocabulary; the DB caps a student at 30). */
export async function replaceStudentSkills(db: Pick<Db, 'batch'>, userId: string, names: string[]) {
  await db.batch(replaceSkillsStmts('student_skills', 'user_id', userId, names));
}
export async function replaceVacancySkills(db: Pick<Db, 'batch'>, vacancyId: string, names: string[]) {
  await db.batch(replaceSkillsStmts('vacancy_skills', 'vacancy_id', vacancyId, names));
}
/** Adds skills without touching existing ones; safe under concurrent calls (never exceeds 30). */
export async function addStudentSkills(db: Pick<Db, 'batch'>, userId: string, names: string[]) {
  await db.batch(addStudentSkillsStmts(userId, names));
}
export type { Queryable };
