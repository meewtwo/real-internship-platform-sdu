import { Hono } from 'hono';
import {
  validateEmployerRegistration, validateIdentifierPayload, validateLanguagePayload, validateLogin, validateReset,
  validateStudentRegistration, validateVerify, type FieldErrors, type Language,
} from '@sdu/shared';
import { isProd } from '../env';
import { fakeVerify, hashPassword, randomToken, verifyPassword } from '../lib/crypto';
import { asDbError, type Queryable } from '../lib/db';
import { apiError, clientIp, isHttps, readJson, type AppEnv, type Ctx } from '../lib/http';
import { domainAcceptsMail } from '../lib/mx';
import { rateLimit, rateReset } from '../lib/ratelimit';
import { iso, secondsUntil } from '../lib/sql';
import { checkCode, issueCode } from '../services/codes';
import { destroyAllSessions, endSession, loadAuth, startSession } from '../services/sessions';
import { findUserByIdentifier, passwordContext, toPublicUser } from '../services/users';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export const auth = new Hono<AppEnv>();

const MAX_FAILED = 5;
const LOCK_MIN = 15;

// ───────────────────────── CSRF token ─────────────────────────
export const CSRF_COOKIE = 'csrf';
auth.get('/csrf', (c) => {
  let token = getCookie(c, CSRF_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    token = randomToken(32);
    setCookie(c, CSRF_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'Strict', secure: isHttps(c) });
  }
  return c.json({ token });
});

async function limited(c: Ctx, name: string, limit: number, windowSec: number) {
  const r = await rateLimit(c.var.db, c.env, `${name}:${clientIp(c)}`, limit, windowSec);
  return r.allowed ? null : apiError(c, 429, 'RATE_LIMITED', { retryAfter: r.retryAfter });
}

const CONSTRAINT_FIELD: Record<string, [string, FieldErrors[string]]> = {
  users_student_id_uq: ['studentId', 'STUDENT_ID_TAKEN'],
  users_email_uq: ['email', 'EMAIL_TAKEN'],
  users_phone_uq: ['phone', 'PHONE_TAKEN'],
  employer_bin_uq: ['bin', 'BIN_TAKEN'],
};

/** Unverified accounts older than 15 min (> code TTL) are unproven claims: they may be re-registered. */
async function purgeStaleUnverified(q: Queryable, k: { studentId: string | null; email: string; phone: string; bin: string | null }) {
  await q.query(
    `DELETE FROM users WHERE status = 'unverified' AND created_at < $5
       AND (student_id = $1 OR email = $2 OR phone = $3 OR id IN (SELECT user_id FROM employer_profiles WHERE bin = $4))`,
    [k.studentId, k.email, k.phone, k.bin, iso(-15 * 60_000)],
  );
}

async function findConflicts(q: Queryable, k: { studentId: string | null; email: string; phone: string; bin: string | null }): Promise<FieldErrors> {
  const fields: FieldErrors = {};
  const { rows } = await q.query<{ student_id: string | null; email: string; phone: string | null; bin: string | null }>(
    `SELECT u.student_id, u.email, u.phone, ep.bin FROM users u LEFT JOIN employer_profiles ep ON ep.user_id = u.id
     WHERE u.student_id = $1 OR u.email = $2 OR u.phone = $3 OR ep.bin = $4`,
    [k.studentId, k.email, k.phone, k.bin],
  );
  for (const r of rows) {
    if (k.studentId && r.student_id === k.studentId) fields.studentId = 'STUDENT_ID_TAKEN';
    if (r.email === k.email) fields.email = 'EMAIL_TAKEN';
    if (r.phone === k.phone) fields.phone = 'PHONE_TAKEN';
    if (k.bin && r.bin === k.bin) fields.bin = 'BIN_TAKEN';
  }
  return fields;
}

function conflictFromError(e: unknown): FieldErrors | null {
  const pe = asDbError(e);
  if (pe.code === '23505' && pe.constraint && CONSTRAINT_FIELD[pe.constraint]) {
    const [f, code] = CONSTRAINT_FIELD[pe.constraint];
    return { [f]: code };
  }
  return null;
}

// ───────────────────────── Registration ─────────────────────────
auth.post('/register/student', async (c) => {
  const lim = await limited(c, 'register', 10, 3600);
  if (lim) return lim;
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateStudentRegistration(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const d = v.data;
  const domain = d.email.split('@')[1];
  if ((await domainAcceptsMail(c.env, domain)) === false) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { email: 'EMAIL_DOMAIN_NO_MX' } });
  const hash = await hashPassword(d.password);
  const key = { studentId: d.studentId, email: d.email, phone: d.phone, bin: null };
  let userId: string;
  try {
    await purgeStaleUnverified(c.var.db, key);
    const dup = await findConflicts(c.var.db, key);
    if (Object.keys(dup).length) return apiError(c, 409, 'VALIDATION_FAILED', { fields: dup });
    // user + profile in one atomic batch; UNIQUE constraints catch a registration that races this one (mapped to the same field errors)
    const id = crypto.randomUUID();
    await c.var.db.batch([
      { sql: `INSERT INTO users (id, role, student_id, email, phone, password_hash, status, preferred_language) VALUES ($1, 'student', $2, $3, $4, $5, 'unverified', $6)`, params: [id, d.studentId, d.email, d.phone, hash, d.language] },
      { sql: `INSERT INTO student_profiles (user_id, name, surname, city_key, city_other, major_key, year_of_study, gpa, graduation_date, interest_area, relocation)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        params: [id, d.name, d.surname, d.city, d.cityOther, d.major, d.yearOfStudy, d.gpa, `${d.graduation}-01`, d.interestArea, d.relocation] },
    ]);
    const res = { id };
    userId = res.id;
  } catch (e) {
    const f = conflictFromError(e);
    if (f) return apiError(c, 409, 'VALIDATION_FAILED', { fields: f });
    throw e;
  }
  await issueCode(c.var.db, c.env, { id: userId, email: d.email, display_name: d.name }, 'register', d.language);
  return c.json({ ok: true, role: 'student', identifier: d.studentId, email: d.email, resendAfter: 60 }, 201);
});

auth.post('/register/employer', async (c) => {
  const lim = await limited(c, 'register', 10, 3600);
  if (lim) return lim;
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateEmployerRegistration(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const d = v.data;
  if ((await domainAcceptsMail(c.env, d.email.split('@')[1])) === false) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { email: 'EMAIL_DOMAIN_NO_MX' } });
  const hash = await hashPassword(d.password);
  const key = { studentId: null, email: d.email, phone: d.phone, bin: d.bin };
  let userId: string;
  try {
    await purgeStaleUnverified(c.var.db, key);
    const dup = await findConflicts(c.var.db, key);
    if (Object.keys(dup).length) return apiError(c, 409, 'VALIDATION_FAILED', { fields: dup });
    const id = crypto.randomUUID();
    await c.var.db.batch([
      { sql: `INSERT INTO users (id, role, email, phone, password_hash, status, preferred_language) VALUES ($1, 'employer', $2, $3, $4, 'unverified', $5)`, params: [id, d.email, d.phone, hash, d.language] },
      { sql: `INSERT INTO employer_profiles (user_id, company_name, company_lc, bin, industry_key, size_key, city_key, city_other, contact_name, contact_surname, position, website, description)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        params: [id, d.companyName, d.companyName.toLocaleLowerCase(), d.bin, d.industry, d.size, d.city, d.cityOther, d.contactName, d.contactSurname, d.position, d.website, d.description] },
    ]);
    const res = { id };
    userId = res.id;
  } catch (e) {
    const f = conflictFromError(e);
    if (f) return apiError(c, 409, 'VALIDATION_FAILED', { fields: f });
    throw e;
  }
  await issueCode(c.var.db, c.env, { id: userId, email: d.email, display_name: d.contactName }, 'register', d.language);
  return c.json({ ok: true, role: 'employer', identifier: d.email, email: d.email, resendAfter: 60 }, 201);
});

// ───────────────────────── Verify / resend ─────────────────────────
auth.post('/verify', async (c) => {
  const lim = await limited(c, 'verify', 30, 600);
  if (lim) return lim;
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateVerify(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const user = await findUserByIdentifier(c.var.db, v.data.role, v.data.identifier);
  if (!user || user.status !== 'unverified') return apiError(c, 400, 'CODE_INVALID');
  const r = await checkCode(c.var.db, c.env, user.id, 'register', v.data.code);
  if (r === 'invalid') return apiError(c, 400, 'CODE_INVALID');
  if (r === 'expired') return apiError(c, 400, 'CODE_EXPIRED');
  if (r === 'too_many') return apiError(c, 429, 'CODE_TOO_MANY_ATTEMPTS');
  const status = user.role === 'employer' ? 'pending' : 'active';
  await c.var.db.query(`UPDATE users SET status = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1 AND status = 'unverified'`, [user.id, status]);
  await startSession(c, user.id, false);
  return c.json({ user: toPublicUser({ ...user, status }) });
});

auth.post('/resend-code', async (c) => {
  const lim = await limited(c, 'resend', 20, 3600);
  if (lim) return lim;
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateIdentifierPayload(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const user = await findUserByIdentifier(c.var.db, v.data.role, v.data.identifier);
  if (!user || user.status !== 'unverified') return c.json({ ok: true, resendAfter: 60 }); // generic
  const lang: Language = v.data.language ?? user.preferred_language;
  if (v.data.language && v.data.language !== user.preferred_language)
    await c.var.db.query('UPDATE users SET preferred_language = $2 WHERE id = $1', [user.id, v.data.language]);
  const r = await issueCode(c.var.db, c.env, user, 'register', lang);
  if (!r.ok) return apiError(c, 429, r.code, { retryAfter: r.retryAfter });
  return c.json({ ok: true, resendAfter: 60 });
});

// ───────────────────────── Login / logout / me ─────────────────────────
auth.post('/login', async (c) => {
  const lim = await limited(c, 'login', 30, 900);
  if (lim) return lim;
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateLogin(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const { role, identifier, password, remember } = v.data;
  const db = c.var.db;
  const user = await findUserByIdentifier(db, role, identifier);
  const ghostKey = `lockfail:${role}:${identifier}`;

  // lockout (identical response for existing and non-existing accounts)
  if (user) {
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const left = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 1000));
      await fakeVerify(password);
      return apiError(c, 423, 'ACCOUNT_LOCKED', { retryAfter: left });
    }
  } else {
    const st = await db.query<{ reset_at: string }>('SELECT reset_at FROM rate_limits WHERE key = $1 AND reset_at > $3 AND count >= $2', [ghostKey, MAX_FAILED, iso()]);
    if (st.rows[0]) { await fakeVerify(password); return apiError(c, 423, 'ACCOUNT_LOCKED', { retryAfter: secondsUntil(st.rows[0].reset_at) }); }
  }

  const okPw = user ? await verifyPassword(password, user.password_hash) : (await fakeVerify(password), false);
  if (!user || !okPw) {
    if (user) {
      const r = await db.query<{ locked: boolean }>(
        `UPDATE users SET
           failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN $3 ELSE locked_until END
         WHERE id = $1 RETURNING (locked_until IS NOT NULL AND locked_until > $4) AS locked`,
        [user.id, MAX_FAILED, iso(LOCK_MIN * 60_000), iso()],
      );
      if (r.rows[0]?.locked) return apiError(c, 423, 'ACCOUNT_LOCKED', { retryAfter: LOCK_MIN * 60 });
    } else {
      const g = await rateLimit(db, { ...c.env, RATE_LIMIT_MULTIPLIER: '1' }, ghostKey, MAX_FAILED - 1, LOCK_MIN * 60);
      if (!g.allowed) return apiError(c, 423, 'ACCOUNT_LOCKED', { retryAfter: g.retryAfter });
    }
    return apiError(c, 401, 'INVALID_CREDENTIALS');
  }

  if (user.status === 'unverified') return apiError(c, 403, 'EMAIL_NOT_VERIFIED');
  if (user.status === 'blocked') return apiError(c, 403, 'ACCOUNT_BLOCKED');
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
  await rateReset(db, ghostKey);
  await startSession(c, user.id, remember);
  return c.json({ user: toPublicUser(user) });
});

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const a = await loadAuth(c);
  if (!a) return apiError(c, 401, 'UNAUTHORIZED');
  return c.json({ user: a.user });
});

auth.patch('/language', async (c) => {
  const a = await loadAuth(c);
  if (!a) return apiError(c, 401, 'UNAUTHORIZED');
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateLanguagePayload(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  await c.var.db.query('UPDATE users SET preferred_language = $2 WHERE id = $1', [a.user.id, v.data.language]);
  return c.json({ ok: true });
});

// ───────────────────────── Password recovery ─────────────────────────
auth.post('/forgot', async (c) => {
  const lim = await limited(c, 'forgot', 10, 3600);
  if (lim) return lim;
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const v = validateIdentifierPayload(body.body);
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  const user = await findUserByIdentifier(c.var.db, v.data.role, v.data.identifier);
  if (user && (user.status === 'active' || user.status === 'pending')) {
    await issueCode(c.var.db, c.env, user, 'reset', v.data.language ?? user.preferred_language); // cooldown/limit handled silently
  }
  return c.json({ ok: true }); // always generic
});

auth.post('/reset', async (c) => {
  const lim = await limited(c, 'reset', 20, 3600);
  if (lim) return lim;
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const probe = validateIdentifierPayload(
    typeof body.body === 'object' && body.body ? { role: (body.body as Record<string, unknown>).role, identifier: (body.body as Record<string, unknown>).identifier } : null,
  );
  const user = probe.ok ? await findUserByIdentifier(c.var.db, probe.data.role, probe.data.identifier) : null;
  const eligible = user && (user.status === 'active' || user.status === 'pending') ? user : null;
  const v = validateReset(body.body, eligible ? await passwordContext(c.var.db, eligible.id) : {});
  if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
  if (!eligible) return apiError(c, 400, 'CODE_INVALID');
  const r = await checkCode(c.var.db, c.env, eligible.id, 'reset', v.data.code);
  if (r === 'invalid') return apiError(c, 400, 'CODE_INVALID');
  if (r === 'expired') return apiError(c, 400, 'CODE_EXPIRED');
  if (r === 'too_many') return apiError(c, 429, 'CODE_TOO_MANY_ATTEMPTS');
  const hash = await hashPassword(v.data.password);
  await c.var.db.batch([
    { sql: 'UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1', params: [eligible.id, hash] },
    { sql: 'DELETE FROM sessions WHERE user_id = $1', params: [eligible.id] },
  ]);
  deleteCookie(c, 'sid'); // current browser (if any) is signed out too
  return c.json({ ok: true });
});

void isProd;
