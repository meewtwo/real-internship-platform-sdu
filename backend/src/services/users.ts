import type { Language, Role } from '@sdu/shared';
import type { Queryable } from '../lib/db';
import type { PublicUser } from '../lib/http';

export interface UserRow {
  id: string; role: Role; student_id: string | null; email: string; phone: string | null; password_hash: string;
  status: PublicUser['status']; preferred_language: Language; failed_login_count: number; locked_until: string | null;
  display_name: string;
}

export const toPublicUser = (u: Pick<UserRow, 'id' | 'role' | 'status' | 'email' | 'student_id' | 'phone' | 'preferred_language'>): PublicUser => ({
  id: u.id, role: u.role, status: u.status, email: u.email, studentId: u.student_id, phone: u.phone, preferredLanguage: u.preferred_language,
});

const SELECT_USER = `SELECT u.id, u.role, u.student_id, u.email, u.phone, u.password_hash, u.status, u.preferred_language,
  u.failed_login_count, u.locked_until, COALESCE(sp.name, ep.contact_name, '') AS display_name
  FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN employer_profiles ep ON ep.user_id = u.id`;

/** Students are addressed by Student ID; employers (and the seeded admin) by email. */
export async function findUserByIdentifier(db: Queryable, role: 'student' | 'employer', identifier: string): Promise<UserRow | null> {
  const { rows } =
    role === 'student'
      ? await db.query<UserRow>(`${SELECT_USER} WHERE u.role = 'student' AND u.student_id = $1`, [identifier])
      : await db.query<UserRow>(`${SELECT_USER} WHERE u.role IN ('employer', 'admin') AND u.email = $1`, [identifier]);
  return rows[0] ?? null;
}

/** Personal data used by the "password must not contain …" rule. */
export async function passwordContext(db: Queryable, userId: string) {
  const { rows } = await db.query<{ student_id: string | null; email: string; n: string | null; s: string | null }>(
    `SELECT u.student_id, u.email, COALESCE(sp.name, ep.contact_name) AS n, COALESCE(sp.surname, ep.contact_surname) AS s
     FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN employer_profiles ep ON ep.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  return r ? { studentId: r.student_id ?? undefined, email: r.email, name: r.n ?? undefined, surname: r.s ?? undefined } : {};
}
