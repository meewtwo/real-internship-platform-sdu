import { Hono } from 'hono';
import { validateEmployerProfile, validateStudentProfile } from '@sdu/shared';
import { asDbError, type Queryable } from '../lib/db';
import { apiError, readJson, type AppEnv } from '../lib/http';
import { loadAuth } from '../services/sessions';
import { rateLimit } from '../lib/ratelimit';
import { clientIp } from '../lib/http';
import { verifyPassword } from '../lib/crypto';
import { deleteCookie } from 'hono/cookie';
import { audit, auditStmt } from '../services/audit';
import { replaceSkillsStmts } from '../lib/sql';
import { afterResponse, embedStudent } from '../services/embeddings';
import { removeCvObjects } from '../services/cvStore';

export const profile = new Hono<AppEnv>();

profile.use('*', async (c, next) => {
  const a = await loadAuth(c);
  if (!a) return apiError(c, 401, 'UNAUTHORIZED');
  c.set('auth', a);
  await next();
});

export async function loadProfile(q: Queryable, userId: string, role: string) {
  if (role === 'student') {
    const { rows } = await q.query<Record<string, unknown>>(
      `SELECT sp.name, sp.surname, u.phone, sp.city_key AS city, sp.city_other AS "cityOther", sp.major_key AS major,
              sp.year_of_study AS "yearOfStudy", sp.gpa AS gpa, substr(sp.graduation_date, 1, 7) AS graduation,
              sp.interest_area AS "interestArea", sp.relocation, sp.interests,
              COALESCE((SELECT json_group_array(name) FROM (SELECT s.name AS name FROM student_skills ss JOIN skills s ON s.id = ss.skill_id WHERE ss.user_id = sp.user_id ORDER BY s.name)), '[]') AS skills
       FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }
  if (role === 'employer') {
    const { rows } = await q.query<Record<string, unknown>>(
      `SELECT ep.company_name AS "companyName", ep.bin, ep.industry_key AS industry, ep.size_key AS size, ep.city_key AS city,
              ep.city_other AS "cityOther", ep.contact_name AS "contactName", ep.contact_surname AS "contactSurname", ep.position,
              u.phone, ep.website, ep.description
       FROM employer_profiles ep JOIN users u ON u.id = ep.user_id WHERE ep.user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }
  return null;
}

profile.get('/', async (c) => {
  const a = c.var.auth!;
  return c.json({ user: a.user, profile: await loadProfile(c.var.db, a.user.id, a.user.role) });
});

profile.put('/student', async (c) => {
  const a = c.var.auth!;
  if (a.user.role !== 'student') return apiError(c, 403, 'FORBIDDEN');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateStudentProfile(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const d = v.data;
  try {
    await c.var.db.batch([
      { sql: 'UPDATE users SET phone = $2 WHERE id = $1', params: [a.user.id, d.phone] },
      { sql: `UPDATE student_profiles SET name = $2, surname = $3, city_key = $4, city_other = $5, major_key = $6, year_of_study = $7,
           gpa = $8, graduation_date = $9, interest_area = $10, relocation = $11, interests = $12 WHERE user_id = $1`,
        params: [a.user.id, d.name, d.surname, d.city, d.cityOther, d.major, d.yearOfStudy, d.gpa, `${d.graduation}-01`, d.interestArea, d.relocation, d.interests] },
      ...replaceSkillsStmts('student_skills', 'user_id', a.user.id, d.skills),
    ]);
  } catch (e) {
    const pe = asDbError(e);
    if (pe.code === '23505' && pe.constraint === 'users_phone_uq') return apiError(c, 409, 'VALIDATION_FAILED', { fields: { phone: 'PHONE_TAKEN' } });
    throw e;
  }
  await afterResponse(c, async (db) => { await embedStudent(db, c.env, a.user.id); });
  return c.json({ ok: true, profile: await loadProfile(c.var.db, a.user.id, 'student') });
});

profile.put('/employer', async (c) => {
  const a = c.var.auth!;
  if (a.user.role !== 'employer') return apiError(c, 403, 'FORBIDDEN');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateEmployerProfile(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const d = v.data;
  try {
    await c.var.db.batch([
      { sql: 'UPDATE users SET phone = $2 WHERE id = $1', params: [a.user.id, d.phone] },
      { sql: `UPDATE employer_profiles SET company_name = $2, company_lc = $12, industry_key = $3, size_key = $4, city_key = $5, city_other = $6,
           contact_name = $7, contact_surname = $8, position = $9, website = $10, description = $11 WHERE user_id = $1`,
        params: [a.user.id, d.companyName, d.industry, d.size, d.city, d.cityOther, d.contactName, d.contactSurname, d.position, d.website, d.description, d.companyName.toLocaleLowerCase()] },
    ]);
  } catch (e) {
    const pe = asDbError(e);
    if (pe.code === '23505' && pe.constraint === 'users_phone_uq') return apiError(c, 409, 'VALIDATION_FAILED', { fields: { phone: 'PHONE_TAKEN' } });
    throw e;
  }
  return c.json({ ok: true, profile: await loadProfile(c.var.db, a.user.id, 'employer') });
});

/** Skill autocomplete (prefix matches first). */
profile.get('/skills', async (c) => {
  const rl = await rateLimit(c.var.db, c.env, `skills:${clientIp(c)}`, 120, 60);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const q = (c.req.query('q') ?? '').normalize('NFC').trim().slice(0, 40).toLowerCase();
  if (q.length < 1) return c.json({ skills: [] });
  const esc = q.replace(/[\\%_]/g, (m) => '\\' + m);
  const { rows } = await c.var.db.query<{ name: string }>(
    `SELECT name FROM skills WHERE name_key LIKE $1 ESCAPE '\\' ORDER BY (name_key LIKE $2 ESCAPE '\\') DESC, name LIMIT 10`,
    [`%${esc}%`, `${esc}%`],
  );
  return c.json({ skills: rows.map((r) => r.name) });
});

/**
 * Data portability: everything the platform stores about the signed-in user, as a JSON download.
 * Never includes password hashes, session tokens, other people's personal data (applicants of an employer's vacancies appear only as counts)
 * or the CV file itself (its metadata and extracted skills are included; download the file via GET /api/cv/file).
 */
profile.get('/export', async (c) => {
  const a = c.var.auth!;
  const rl = await rateLimit(c.var.db, c.env, `export:${a.user.id}`, 5, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const db = c.var.db;
  const id = a.user.id;
  const all = async (text: string) => (await db.query<Record<string, unknown>>(text, [id])).rows;
  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    account: (await all('SELECT id, role, student_id AS "studentId", email, phone, status, preferred_language AS "preferredLanguage", created_at AS "createdAt" FROM users WHERE id = $1'))[0],
    profile: await loadProfile(db, id, a.user.role),
    notifications: await all('SELECT kind, params, link, read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id = $1 ORDER BY id'),
  };
  if (a.user.role === 'student') {
    Object.assign(data, {
      cv: (await all('SELECT filename, mime, size_bytes AS "sizeBytes", extracted_skills AS skills, experience_years AS "experienceYears", uploaded_at AS "uploadedAt" FROM cvs WHERE user_id = $1'))[0] ?? null,
      resume: (await all('SELECT source, about, courses, inferred_skills AS "inferredSkills", updated_at AS "updatedAt" FROM resumes WHERE user_id = $1'))[0] ?? null,
      applications: await all(`SELECT a.status, a.match_percent AS "matchPercent", a.cover_note AS "coverNote", a.created_at AS "appliedAt", v.title AS vacancy, ep.company_name AS company,
          COALESCE((SELECT json_group_array(json_object('status', status, 'at', created_at)) FROM (SELECT status, created_at FROM application_events e WHERE e.application_id = a.id ORDER BY e.id)), '[]') AS history
        FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id WHERE a.student_id = $1 ORDER BY a.created_at`),
      favorites: await all('SELECT v.title, v.id AS "vacancyId", f.created_at AS "savedAt" FROM favorites f JOIN vacancies v ON v.id = f.vacancy_id WHERE f.user_id = $1 ORDER BY f.created_at'),
      savedSearches: await all('SELECT name, filters, created_at AS "createdAt" FROM saved_searches WHERE user_id = $1 ORDER BY created_at'),
      invitations: await all('SELECT v.title, i.created_at AS "invitedAt" FROM invitations i JOIN vacancies v ON v.id = i.vacancy_id WHERE i.student_id = $1 ORDER BY i.created_at'),
    });
  } else if (a.user.role === 'employer') {
    Object.assign(data, {
      vacancies: await all(`SELECT v.id, v.title, v.description, v.kind, v.status, v.industry_key AS industry, v.city_key AS city, v.work_format AS "workFormat", v.salary_min AS "salaryMin", v.salary_max AS "salaryMax",
          v.published_at AS "publishedAt", v.created_at AS "createdAt",
          COALESCE((SELECT json_group_array(name) FROM (SELECT s.name AS name FROM vacancy_skills vs JOIN skills s ON s.id = vs.skill_id WHERE vs.vacancy_id = v.id ORDER BY s.name)), '[]') AS "requiredSkills",
          (SELECT count(*) FROM applications x WHERE x.vacancy_id = v.id AND x.status <> 'withdrawn') AS "applicantCount"
        FROM vacancies v WHERE v.employer_id = $1 ORDER BY v.created_at`),
    });
  }
  await audit(db, { id, role: a.user.role }, 'account.export', { type: 'user', id });
  c.header('Content-Disposition', 'attachment; filename="sdu-career-match-my-data.json"');
  return c.json(data);
});

/**
 * Right to erasure. Requires the current password (so a stolen session alone cannot wipe an account) and is rate-limited.
 * Everything owned by the account cascades; the audit row survives without the actor (actor_id → NULL).
 */
profile.delete('/', async (c) => {
  const a = c.var.auth!;
  if (a.user.role === 'admin') return apiError(c, 403, 'FORBIDDEN');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { password: 'REQUIRED' } });
  if (Object.keys(o).some((k) => k !== 'password')) return apiError(c, 400, 'UNKNOWN_FIELDS');
  const pw = (o as Record<string, unknown>).password;
  if (typeof pw !== 'string' || pw === '' || pw.length > 128) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { password: 'REQUIRED' } });
  const rl = await rateLimit(c.var.db, c.env, `delacct:${a.user.id}`, 5, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const hash = (await c.var.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [a.user.id])).rows[0]?.password_hash;
  if (!hash || !(await verifyPassword(pw, hash))) return apiError(c, 401, 'INVALID_CREDENTIALS');
  const cvKeys = (await c.var.db.query<{ storage_key: string | null }>('SELECT storage_key FROM cvs WHERE user_id = $1', [a.user.id])).rows.map((r) => r.storage_key);
  const counts = a.user.role === 'employer'
    ? (await c.var.db.query<{ v: number; a: number }>('SELECT count(*) AS v, (SELECT count(*) FROM applications x JOIN vacancies y ON y.id = x.vacancy_id WHERE y.employer_id = $1) AS a FROM vacancies WHERE employer_id = $1', [a.user.id])).rows[0]
    : { v: 0, a: 0 };
  // the audit row and the erasure commit together (the row survives with actor_id → NULL through the FK action)
  await c.var.db.batch([
    auditStmt({ id: a.user.id, role: a.user.role }, 'account.delete', { type: 'user', id: a.user.id }, { role: a.user.role, vacancies: counts.v, applications: counts.a }),
    { sql: 'DELETE FROM users WHERE id = $1', params: [a.user.id] },
  ]);
  await removeCvObjects(c.env, cvKeys); // after the commit: the account is gone, now remove its files
  deleteCookie(c, 'sid', { path: '/' });
  deleteCookie(c, 'sid', { path: '/', secure: true, prefix: 'host' });
  return c.json({ ok: true });
});
