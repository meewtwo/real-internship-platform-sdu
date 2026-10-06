import { beforeEach, describe, expect, it } from 'vitest';
import { buildCodeEmail } from '../src/lib/mail';
import { Client, employerPayload, gradIn, lastCode, makeStudent, resetDb, sql, studentPayload, ago } from './helpers';

beforeEach(resetDb);

const err = (r: { body: any }) => r.body?.error;

describe('transport hardening', () => {
  it('rejects state-changing requests without CSRF token / with a wrong token / cross-origin', async () => {
    const c = new Client();
    await c.ensureCsrf();
    const p = studentPayload();
    expect(err(await c.json('POST', '/api/auth/register/student', p, { csrf: null })).code).toBe('CSRF_INVALID');
    expect(err(await c.json('POST', '/api/auth/register/student', p, { csrf: 'x'.repeat(43) })).code).toBe('CSRF_INVALID');
    const evil = await c.json('POST', '/api/auth/register/student', p, { headers: { origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    expect(err(evil).code).toBe('CSRF_INVALID');
    const noCookie = new Client(c.ip);
    const t = await c.ensureCsrf();
    expect(err(await noCookie.json('POST', '/api/auth/register/student', p, { csrf: t })).code).toBe('CSRF_INVALID');
    expect(await sql('SELECT 1 FROM users')).toHaveLength(0);
  });
  it('oversized JSON → 413, bad JSON → 400, wrong content-type → 415', async () => {
    const c = new Client();
    const big = await c.json('POST', '/api/auth/login', undefined, { rawBody: JSON.stringify({ role: 'student', identifier: 'x', password: 'a'.repeat(200_000) }) });
    expect(big.status).toBe(413);
    expect(err(big).code).toBe('PAYLOAD_TOO_LARGE');
    expect(err(await c.json('POST', '/api/auth/login', undefined, { rawBody: '{nope' })).code).toBe('INVALID_JSON');
    const t = await c.ensureCsrf();
    const ct = await c.raw('POST', '/api/auth/login', { body: 'a=b', headers: { 'content-type': 'text/plain', 'x-csrf-token': t } });
    expect(ct.status).toBe(415);
  });
  it('sets security headers and never caches API responses', async () => {
    const r = await new Client().get('/api/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
  it('unknown API route → JSON 404', async () => {
    const r = await new Client().get('/api/nope');
    expect(r.status).toBe(404);
    expect(err(r).code).toBe('NOT_FOUND');
  });
});

describe('student registration', () => {
  it('QA: valid data creates an unverified account, password hashed, code emailed', async () => {
    const c = new Client();
    const p = studentPayload({ studentId: '000123456', email: 'Ali.Test@SDU.EDU.KZ', name: 'ali', language: 'ru' });
    const r = await c.post('/api/auth/register/student', p);
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i);
    const [u] = await sql('SELECT * FROM users WHERE student_id = $1', ['000123456']);
    expect(u.status).toBe('unverified');
    expect(u.email).toBe('ali.test@sdu.edu.kz');
    expect(u.password_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(u.password_hash).not.toContain(p.password);
    expect(u.preferred_language).toBe('ru');
    const [sp] = await sql('SELECT * FROM student_profiles WHERE user_id = $1', [u.id]);
    expect(sp.name).toBe('Ali');
    expect(sp.gpa).toBe('3.65');
    const mails = (await c.get('/api/auth/csrf')) && (await c.get(`/api/__test/outbox?to=ali.test@sdu.edu.kz`)).body.mails;
    expect(mails).toHaveLength(1);
    expect(mails[0].lang).toBe('ru');
    expect(mails[0].subject).toMatch(/[А-Яа-я]/);
    const [ev] = await sql('SELECT * FROM email_verifications WHERE user_id = $1', [u.id]);
    expect(ev.code_hash).not.toContain(mails[0].code); // stored hashed
    expect(ev.code_hash).toHaveLength(64);
  });

  const bad: [string, Record<string, unknown>, string, string][] = [
    ['ID with letters', { studentId: '23010701a' }, 'studentId', 'STUDENT_ID_INVALID'],
    ['ID 8 digits', { studentId: '12345678' }, 'studentId', 'STUDENT_ID_INVALID'],
    ['ID 10 digits', { studentId: '1234567890' }, 'studentId', 'STUDENT_ID_INVALID'],
    ['ID with spaces', { studentId: '123 456 789' }, 'studentId', 'STUDENT_ID_INVALID'],
    ['ID dashes', { studentId: '123-456-789' }, 'studentId', 'STUDENT_ID_INVALID'],
    ['ID Arabic-Indic digits', { studentId: '٢٣٠١٠٧٠١٠' }, 'studentId', 'STUDENT_ID_INVALID'],
    ['ID as number', { studentId: 230107010 }, 'studentId', 'STUDENT_ID_INVALID'],
    ['ID SQLi', { studentId: "' OR 1=1 --" }, 'studentId', 'STUDENT_ID_INVALID'],
    ['empty name', { name: '' }, 'name', 'REQUIRED'],
    ['whitespace name', { name: '   ' }, 'name', 'REQUIRED'],
    ['name 10k chars', { name: 'A'.repeat(10_000) }, 'name', 'NAME_TOO_LONG'],
    ['name digits', { name: 'Ali2' }, 'name', 'NAME_INVALID_CHARS'],
    ['name emoji', { surname: 'Ali😀' }, 'surname', 'NAME_INVALID_CHARS'],
    ['name XSS script', { name: '<script>alert(1)</script>' }, 'name', 'NAME_INVALID_CHARS'],
    ['name XSS img', { surname: '<img src=x onerror=alert(1)>' }, 'surname', 'NAME_INVALID_CHARS'],
    ['name SQLi', { name: "Robert'); DROP TABLE users;--" }, 'name', 'NAME_INVALID_CHARS'],
    ['name zero-width', { name: 'Al​i' }, 'name', 'NAME_INVALID_CHARS'],
    ['name RTL', { name: '‮ilа' }, 'name', 'NAME_INVALID_CHARS'],
    ['name lookalike mix', { name: 'Аli' }, 'name', 'NAME_INVALID_CHARS'],
    ['email gmail', { email: 'a@gmail.com' }, 'email', 'EMAIL_DOMAIN_NOT_SDU'],
    ['email lookalike', { email: 'a@sdu.edu.kz.evil.com' }, 'email', 'EMAIL_DOMAIN_NOT_SDU'],
    ['email sdu-edu.kz', { email: 'a@sdu-edu.kz' }, 'email', 'EMAIL_DOMAIN_NOT_SDU'],
    ['email subdomain', { email: 'a@mail.sdu.edu.kz' }, 'email', 'EMAIL_DOMAIN_NOT_SDU'],
    ['email xsdu', { email: 'a@xsdu.edu.kz' }, 'email', 'EMAIL_DOMAIN_NOT_SDU'],
    ['email double @', { email: 'a@@sdu.edu.kz' }, 'email', 'EMAIL_INVALID'],
    ['email space', { email: 'a b@sdu.edu.kz' }, 'email', 'EMAIL_INVALID'],
    ['email trailing dot', { email: 'a@sdu.edu.kz.' }, 'email', 'EMAIL_INVALID'],
    ['email quoted local', { email: '"a b"@sdu.edu.kz' }, 'email', 'EMAIL_INVALID'],
    ['email no local', { email: '@sdu.edu.kz' }, 'email', 'EMAIL_INVALID'],
    ['email >254', { email: `${'a'.repeat(250)}@sdu.edu.kz` }, 'email', 'EMAIL_TOO_LONG'],
    ['phone short', { phone: '+7701123456' }, 'phone', 'PHONE_INVALID'],
    ['phone letters', { phone: '+7701abc4567' }, 'phone', 'PHONE_INVALID'],
    ['phone 8-prefix', { phone: '87011234567' }, 'phone', 'PHONE_INVALID'],
    ['bad city', { city: 'atlantis' }, 'city', 'CITY_INVALID'],
    ['other city without text', { city: 'other' }, 'cityOther', 'REQUIRED'],
    ['other city digits', { city: 'other', cityOther: 'Ala2ty' }, 'cityOther', 'CITY_OTHER_INVALID'],
    ['bad major', { major: 'witchcraft' }, 'major', 'MAJOR_INVALID'],
    ['bad year', { yearOfStudy: '5' }, 'yearOfStudy', 'YEAR_INVALID'],
    ['GPA 4.01', { gpa: '4.01' }, 'gpa', 'GPA_OUT_OF_RANGE'],
    ['GPA -1', { gpa: '-1' }, 'gpa', 'GPA_INVALID'],
    ['GPA -0', { gpa: '-0' }, 'gpa', 'GPA_INVALID'],
    ['GPA 1e2', { gpa: '1e2' }, 'gpa', 'GPA_INVALID'],
    ['GPA 3.999', { gpa: '3.999' }, 'gpa', 'GPA_TOO_MANY_DECIMALS'],
    ['GPA letters', { gpa: 'abc' }, 'gpa', 'GPA_INVALID'],
    ['GPA empty', { gpa: '' }, 'gpa', 'REQUIRED'],
    ['graduation past', { graduation: '2020-06' }, 'graduation', 'GRADUATION_PAST'],
    ['graduation 20y ahead', { graduation: `${new Date().getFullYear() + 20}-06` }, 'graduation', 'GRADUATION_TOO_FAR'],
    ['graduation inconsistent with year', { yearOfStudy: '4', graduation: gradIn(60) }, 'graduation', 'GRADUATION_INCONSISTENT'],
    ['graduation malformed', { graduation: '2028-13' }, 'graduation', 'GRADUATION_INVALID'],
    ['bad interest', { interestArea: 'x' }, 'interestArea', 'INTEREST_INVALID'],
    ['bad relocation', { relocation: 'maybe' }, 'relocation', 'RELOCATION_INVALID'],
    ['password mismatch', { confirmPassword: 'Different1!x' }, 'confirmPassword', 'PASSWORD_MISMATCH'],
    ['password weak', { password: 'password', confirmPassword: 'password' }, 'password', 'PASSWORD_NO_UPPER'],
    ['password common', { password: 'Password1!', confirmPassword: 'Password1!' }, 'password', 'PASSWORD_COMMON'],
    ['password = ID', { studentId: '230107010', password: 'Zq#230107010a', confirmPassword: 'Zq#230107010a' }, 'password', 'PASSWORD_CONTAINS_PERSONAL'],
    ['terms not accepted', { acceptTerms: false }, 'acceptTerms', 'TERMS_REQUIRED'],
    ['bad language', { language: 'fr' }, 'language', 'LANGUAGE_INVALID'],
  ];
  it.each(bad)('rejects: %s', async (_name, over, field, code) => {
    const c = new Client();
    const r = await c.post('/api/auth/register/student', studentPayload(over));
    expect(r.status).toBe(400);
    expect(err(r).code).toBe('VALIDATION_FAILED');
    expect(err(r).fields[field]).toBe(code);
    expect(await sql('SELECT 1 FROM users')).toHaveLength(0);
  });

  it('mass assignment: role/status/id/extra fields are rejected', async () => {
    for (const extra of [{ role: 'admin' }, { status: 'active' }, { id: '1' }, { failed_login_count: 0 }, { __proto__: { admin: true }, isAdmin: true }]) {
      const r = await new Client().post('/api/auth/register/student', { ...studentPayload(), ...extra });
      expect(r.status).toBe(400);
      expect(err(r).code).toBe('UNKNOWN_FIELDS');
    }
    expect(await sql('SELECT 1 FROM users')).toHaveLength(0);
  });
  it('non-object bodies', async () => {
    for (const body of ['null', '[]', '"x"', '5']) {
      const r = await new Client().json('POST', '/api/auth/register/student', undefined, { rawBody: body });
      expect(r.status).toBe(400);
      expect(err(r).code).toBe('VALIDATION_FAILED');
    }
  });
  it('empty payload reports every required field', async () => {
    const r = await new Client().post('/api/auth/register/student', {});
    expect(r.status).toBe(400);
    expect(Object.keys(err(r).fields).length).toBeGreaterThanOrEqual(15);
  });

  it('duplicates: ID, email (case-insensitive) and phone → clean 409 with codes', async () => {
    const first = studentPayload();
    expect((await new Client().post('/api/auth/register/student', first)).status).toBe(201);
    const dupAll = await new Client().post('/api/auth/register/student', { ...studentPayload(), studentId: first.studentId, email: first.email.toUpperCase(), phone: first.phone });
    expect(dupAll.status).toBe(409);
    expect(err(dupAll).fields).toMatchObject({ studentId: 'STUDENT_ID_TAKEN', email: 'EMAIL_TAKEN', phone: 'PHONE_TAKEN' });
    expect(await sql('SELECT 1 FROM users')).toHaveLength(1);
  });
  it('race: two parallel identical registrations → exactly one succeeds', async () => {
    const p = studentPayload();
    const results = await Promise.all([new Client(), new Client()].map((c) => c.post('/api/auth/register/student', p)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(err(loser).code).toBe('VALIDATION_FAILED');
    expect(Object.values(err(loser).fields).every((v) => String(v).endsWith('_TAKEN'))).toBe(true);
    expect(await sql('SELECT 1 FROM users')).toHaveLength(1);
  });
  it('double-click: 8 parallel identical submits → one account', async () => {
    const p = studentPayload();
    const c = new Client();
    await c.ensureCsrf();
    const rs = await Promise.all(Array.from({ length: 8 }, () => c.post('/api/auth/register/student', p)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await sql('SELECT 1 FROM users')).toHaveLength(1);
    expect(await sql('SELECT 1 FROM email_verifications')).toHaveLength(1);
  });
  it('a stale (>15 min) unverified claim can be re-registered; a fresh one cannot', async () => {
    const p = studentPayload();
    await new Client().post('/api/auth/register/student', p);
    expect((await new Client().post('/api/auth/register/student', p)).status).toBe(409);
    await sql(`UPDATE users SET created_at = ${ago(20, 'minutes')}`);
    expect((await new Client().post('/api/auth/register/student', { ...p, name: 'Other' })).status).toBe(201);
    expect(await sql('SELECT 1 FROM users')).toHaveLength(1);
  });
  it('registration is rate limited per IP', async () => {
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await c.post('/api/auth/register/student', studentPayload({ name: '' }))).status;
    expect(last).toBe(429);
  });
});

describe('email verification', () => {
  const reg = async () => {
    const c = new Client();
    const p = studentPayload();
    await c.post('/api/auth/register/student', p);
    return { c, p, v: (code: string) => c.post('/api/auth/verify', { role: 'student', identifier: p.studentId, code }) };
  };
  const wrong = (real: string) => (real === '000000' ? '111111' : '000000');

  it('correct code activates the account and logs in; reuse fails', async () => {
    const { c, p, v } = await reg();
    const code = await lastCode(c, p.email);
    const ok = await v(code);
    expect(ok.status).toBe(200);
    expect(ok.body.user.status).toBe('active');
    expect((await c.get('/api/auth/me')).body.user.email).toBe(p.email);
    const again = await v(code);
    expect(err(again).code).toBe('CODE_INVALID');
    expect((await sql('SELECT status FROM users'))[0].status).toBe('active');
  });
  it('wrong code → CODE_INVALID; 5 wrong attempts lock the code even for the right one', async () => {
    const { c, p, v } = await reg();
    const code = await lastCode(c, p.email);
    for (let i = 0; i < 4; i++) expect(err(await v(wrong(code))).code).toBe('CODE_INVALID');
    expect(err(await v(wrong(code))).code).toBe('CODE_TOO_MANY_ATTEMPTS');
    expect(err(await v(code)).code).toBe('CODE_TOO_MANY_ATTEMPTS');
    expect((await sql('SELECT status FROM users'))[0].status).toBe('unverified');
  });
  it('expired code → CODE_EXPIRED', async () => {
    const { c, p, v } = await reg();
    const code = await lastCode(c, p.email);
    await sql(`UPDATE email_verifications SET expires_at = ${ago(1, 'seconds')}`);
    expect(err(await v(code)).code).toBe('CODE_EXPIRED');
  });
  it('format errors and unknown accounts are generic', async () => {
    const { c, p } = await reg();
    expect(err(await c.post('/api/auth/verify', { role: 'student', identifier: p.studentId, code: '12345' })).fields.code).toBe('CODE_FORMAT_INVALID');
    expect(err(await c.post('/api/auth/verify', { role: 'student', identifier: p.studentId, code: 'abcdef' })).fields.code).toBe('CODE_FORMAT_INVALID');
    expect(err(await c.post('/api/auth/verify', { role: 'student', identifier: '999999999', code: '123456' })).code).toBe('CODE_INVALID');
  });
  it('resend: 60 s cooldown, invalidates old code, max 5/hour', async () => {
    const { c, p, v } = await reg();
    const old = await lastCode(c, p.email);
    const body = { role: 'student', identifier: p.studentId };
    const cd = await c.post('/api/auth/resend-code', body);
    expect(cd.status).toBe(429);
    expect(err(cd).code).toBe('RESEND_COOLDOWN');
    expect(err(cd).retryAfter).toBeGreaterThan(0);
    const backdate = () => sql(`UPDATE email_verifications SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-61 seconds')`);
    await backdate();
    expect((await c.post('/api/auth/resend-code', { ...body, language: 'kk' })).status).toBe(200);
    const fresh = await lastCode(c, p.email);
    expect((await c.get(`/api/__test/outbox?to=${p.email}`)).body.mails.at(-1).lang).toBe('kk');
    if (fresh !== old) expect(err(await v(old)).code).toBe('CODE_INVALID'); // old code invalidated
    for (let i = 0; i < 3; i++) { await backdate(); expect((await c.post('/api/auth/resend-code', body)).status).toBe(200); }
    await backdate();
    const limited = await c.post('/api/auth/resend-code', body); // 6th send within the hour
    expect(err(limited).code).toBe('RESEND_LIMIT');
  });
  it('unverified accounts cannot log in', async () => {
    const { c, p } = await reg();
    const r = await c.post('/api/auth/login', { role: 'student', identifier: p.studentId, password: p.password });
    expect(r.status).toBe(403);
    expect(err(r).code).toBe('EMAIL_NOT_VERIFIED');
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });
});

describe('login', () => {
  it('logs in, sets httpOnly cookie, never leaks the hash, logout kills the session', async () => {
    const { client, payload } = await makeStudent();
    const c = new Client();
    const r = await c.post('/api/auth/login', { role: 'student', identifier: payload.studentId, password: payload.password, remember: true });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/hash|password/i);
    const sc = r.headers.getSetCookie().find((x) => x.startsWith('sid='))!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Max-Age=2592000/i);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(200); // other session unaffected
    const noRemember = await new Client().post('/api/auth/login', { role: 'student', identifier: payload.studentId, password: payload.password });
    expect(noRemember.headers.getSetCookie().find((x) => x.startsWith('sid='))!).not.toMatch(/Max-Age/i);
  });
  it('wrong password and unknown account produce identical responses', async () => {
    const { payload } = await makeStudent();
    const a = await new Client().post('/api/auth/login', { role: 'student', identifier: payload.studentId, password: 'Wrong#Pass123' });
    const b = await new Client().post('/api/auth/login', { role: 'student', identifier: '999999999', password: 'Wrong#Pass123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(err(a).code).toBe('INVALID_CREDENTIALS');
  });
  it('lockout after 5 failures for 15 min, even with the right password; same for unknown IDs', async () => {
    const { payload } = await makeStudent();
    const c = new Client();
    const login = (pw: string) => c.post('/api/auth/login', { role: 'student', identifier: payload.studentId, password: pw });
    for (let i = 0; i < 4; i++) expect((await login('Wrong#Pass123')).status).toBe(401);
    const fifth = await login('Wrong#Pass123');
    expect(fifth.status).toBe(423);
    expect(err(fifth).code).toBe('ACCOUNT_LOCKED');
    const rightWhileLocked = await login(payload.password);
    expect(rightWhileLocked.status).toBe(423);
    expect(err(rightWhileLocked).retryAfter).toBeGreaterThan(800);
    await sql(`UPDATE users SET locked_until = ${ago(1, 'seconds')}`);
    expect((await login(payload.password)).status).toBe(200);
    // unknown ID behaves the same
    const ghost = (pw: string) => c.post('/api/auth/login', { role: 'student', identifier: '888888888', password: pw });
    for (let i = 0; i < 4; i++) expect((await ghost('x')).status).toBe(401);
    expect((await ghost('x')).status).toBe(423);
    expect((await ghost('x')).status).toBe(423);
  });
  it('injection attempts in credentials never authenticate', async () => {
    await makeStudent();
    const c = new Client();
    const r1 = await c.post('/api/auth/login', { role: 'student', identifier: "' OR 1=1 --", password: 'x' });
    expect(err(r1).fields.identifier).toBe('IDENTIFIER_INVALID');
    const r2 = await c.post('/api/auth/login', { role: 'employer', identifier: "admin@careermatch.kz' OR '1'='1", password: "' OR 1=1 --" });
    expect(r2.status).toBe(400);
    const r3 = await c.post('/api/auth/login', { role: 'student', identifier: '123456789', password: "'); DROP TABLE users;--" });
    expect(r3.status).toBe(401);
    expect(Number((await sql('SELECT count(*) AS n FROM users'))[0].n)).toBe(1);
  });
  it('students cannot log in through the employer tab and vice versa', async () => {
    const { payload } = await makeStudent();
    const r = await new Client().post('/api/auth/login', { role: 'employer', identifier: payload.email, password: payload.password });
    expect(r.status).toBe(401);
  });
  it('login is rate limited per IP', async () => {
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 33; i++) last = (await c.post('/api/auth/login', { role: 'student', identifier: String(100000000 + i), password: 'x' })).status;
    expect(last).toBe(429);
  });
});

describe('forgot / reset password', () => {
  it('generic response; code → new password; old password and all sessions die', async () => {
    const { client, payload } = await makeStudent();
    const c = new Client();
    const known = await c.post('/api/auth/forgot', { role: 'student', identifier: payload.studentId, language: 'kk' });
    const unknown = await c.post('/api/auth/forgot', { role: 'student', identifier: '999999999' });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect((await c.get(`/api/__test/outbox?to=${payload.email}`)).body.mails.filter((m: any) => m.purpose === 'reset')).toHaveLength(1);
    const code = (await c.get(`/api/__test/outbox?to=${payload.email}`)).body.mails.filter((m: any) => m.purpose === 'reset')[0].code;
    const body = { role: 'student', identifier: payload.studentId, code };
    // weak / personal / mismatch rejected before the code is spent
    expect(err(await c.post('/api/auth/reset', { ...body, password: 'short', confirmPassword: 'short' })).fields.password).toBe('PASSWORD_TOO_SHORT');
    expect(err(await c.post('/api/auth/reset', { ...body, password: `Zz#${payload.studentId}x`, confirmPassword: `Zz#${payload.studentId}x` })).fields.password).toBe('PASSWORD_CONTAINS_PERSONAL');
    expect(err(await c.post('/api/auth/reset', { ...body, password: 'Nw7$kTq9!vBn', confirmPassword: 'nope' })).fields.confirmPassword).toBe('PASSWORD_MISMATCH');
    expect(err(await c.post('/api/auth/reset', { ...body, code: code === '000000' ? '111111' : '000000', password: 'Nw7$kTq9!vBn', confirmPassword: 'Nw7$kTq9!vBn' })).code).toBe('CODE_INVALID');
    const ok = await c.post('/api/auth/reset', { ...body, password: 'Nw7$kTq9!vBn', confirmPassword: 'Nw7$kTq9!vBn' });
    expect(ok.status).toBe(200);
    expect((await client.get('/api/auth/me')).status).toBe(401); // existing session invalidated
    expect((await c.post('/api/auth/login', { role: 'student', identifier: payload.studentId, password: payload.password })).status).toBe(401);
    expect((await c.post('/api/auth/login', { role: 'student', identifier: payload.studentId, password: 'Nw7$kTq9!vBn' })).status).toBe(200);
    expect(err(await c.post('/api/auth/reset', { ...body, password: 'Nw7$kTq9!vBn', confirmPassword: 'Nw7$kTq9!vBn' })).code).toBe('CODE_INVALID'); // reuse
  });
  it('reset for unknown account gives the same CODE_INVALID', async () => {
    const r = await new Client().post('/api/auth/reset', { role: 'student', identifier: '999999999', code: '123456', password: 'Nw7$kTq9!vBn', confirmPassword: 'Nw7$kTq9!vBn' });
    expect(err(r).code).toBe('CODE_INVALID');
  });
  it('forgot does not email unverified accounts', async () => {
    const c = new Client();
    const p = studentPayload();
    await c.post('/api/auth/register/student', p);
    await c.post('/api/auth/forgot', { role: 'student', identifier: p.studentId });
    expect((await c.get(`/api/__test/outbox?to=${p.email}`)).body.mails.filter((m: any) => m.purpose === 'reset')).toHaveLength(0);
  });
});

describe('student profile', () => {
  it('update persists (DB + reload), skills deduped and autocomplete works', async () => {
    const { client, payload } = await makeStudent();
    const before = (await client.get('/api/profile')).body;
    expect(before.profile.name).toBe('Aigerim');
    const upd = {
      name: 'Dana', surname: 'Akhmetova', phone: '+7 (777) 000-11-22', city: 'other', cityOther: 'Мариуполь', major: 'finance', yearOfStudy: '4',
      gpa: '3,9', graduation: gradIn(12), interestArea: 'finance_banking', relocation: 'remote', skills: ['Python', 'python', 'Machine Learning', 'C++'], interests: ['Fintech'],
    };
    const r = await client.put('/api/profile/student', upd);
    expect(r.status).toBe(200);
    const after = (await client.get('/api/profile')).body.profile;
    expect(after).toMatchObject({ name: 'Dana', phone: '+77770001122', city: 'other', cityOther: 'Мариуполь', gpa: '3.90', relocation: 'remote', interests: ['Fintech'] });
    expect(after.skills).toEqual(['C++', 'Machine Learning', 'Python']);
    const [row] = await sql('SELECT sp.gpa AS gpa, u.phone, u.student_id, u.email FROM student_profiles sp JOIN users u ON u.id = sp.user_id');
    expect(row).toMatchObject({ gpa: '3.90', phone: '+77770001122', student_id: payload.studentId, email: payload.email });
    const ac = await client.get('/api/profile/skills?q=pyth');
    expect(ac.body.skills).toContain('Python');
    expect((await client.get('/api/profile/skills?q=%25')).body.skills).toEqual([]); // LIKE wildcards are escaped
  });
  it('cannot change Student ID, email, role, status (mass assignment)', async () => {
    const { client } = await makeStudent();
    const cur = (await client.get('/api/profile')).body.profile;
    const base = { ...cur, skills: [], interests: [] };
    delete base.skills;
    for (const extra of [{ studentId: '111111111' }, { email: 'x@sdu.edu.kz' }, { role: 'admin' }, { status: 'active' }]) {
      const r = await client.put('/api/profile/student', { ...cur, ...extra });
      expect(r.status).toBe(400);
      expect(err(r).code).toBe('UNKNOWN_FIELDS');
    }
  });
  it('same validators as registration; invalid update leaves data untouched', async () => {
    const { client, payload } = await makeStudent();
    const cur = (await client.get('/api/profile')).body.profile;
    const r = await client.put('/api/profile/student', { ...cur, gpa: '4.5', name: '<b>x</b>', phone: '123' });
    expect(err(r).fields).toMatchObject({ gpa: 'GPA_OUT_OF_RANGE', name: 'NAME_INVALID_CHARS', phone: 'PHONE_INVALID' });
    expect((await client.get('/api/profile')).body.profile.name).toBe('Aigerim');
    void payload;
  });
  it('max 30 skills (each 2–40 chars)', async () => {
    const { client } = await makeStudent();
    const cur = (await client.get('/api/profile')).body.profile;
    const many = Array.from({ length: 31 }, (_, i) => `Skill number ${i}`);
    expect(err(await client.put('/api/profile/student', { ...cur, skills: many })).fields.skills).toBe('TAGS_TOO_MANY');
    expect(err(await client.put('/api/profile/student', { ...cur, skills: ['x'] })).fields.skills).toBe('TAG_INVALID');
    expect(err(await client.put('/api/profile/student', { ...cur, skills: ['y'.repeat(41)] })).fields.skills).toBe('TAG_INVALID');
    expect(err(await client.put('/api/profile/student', { ...cur, skills: ['<script>alert(1)</script>'] })).fields.skills).toBe('TAG_INVALID');
    expect((await client.put('/api/profile/student', { ...cur, skills: many.slice(0, 30) })).status).toBe(200);
  });
  it('phone must stay unique; auth and role guards', async () => {
    const a = await makeStudent();
    const b = await makeStudent();
    const cur = (await b.client.get('/api/profile')).body.profile;
    const r = await b.client.put('/api/profile/student', { ...cur, phone: a.payload.phone });
    expect(r.status).toBe(409);
    expect(err(r).fields.phone).toBe('PHONE_TAKEN');
    expect((await new Client().get('/api/profile')).status).toBe(401);
    expect(err(await a.client.put('/api/profile/employer', {})).code).toBe('FORBIDDEN');
  });
  it('profile PUT requires CSRF', async () => {
    const { client } = await makeStudent();
    const cur = (await client.get('/api/profile')).body.profile;
    expect(err(await client.json('PUT', '/api/profile/student', cur, { csrf: null })).code).toBe('CSRF_INVALID');
  });
});

describe('employer flow', () => {
  const regEmployer = async (over: Record<string, unknown> = {}) => {
    const c = new Client();
    const p = employerPayload(over);
    const r = await c.post('/api/auth/register/employer', p);
    return { c, p, r };
  };
  it('registers, verifies by code, becomes "pending", can edit profile', async () => {
    const { c, p, r } = await regEmployer();
    expect(r.status).toBe(201);
    expect((await c.post('/api/auth/login', { role: 'employer', identifier: p.email, password: p.password })).status).toBe(403);
    const v = await c.post('/api/auth/verify', { role: 'employer', identifier: p.email, code: await lastCode(c, p.email) });
    expect(v.status).toBe(200);
    expect(v.body.user.status).toBe('pending');
    const prof = (await c.get('/api/profile')).body.profile;
    expect(prof.companyName).toBe(p.companyName);
    const upd = { ...prof }; delete upd.bin; upd.companyName = 'New Name LLP'; upd.description = 'Updated <b>text</b>'; upd.phone = '+7 (702) 999-88-77';
    expect((await c.put('/api/profile/employer', upd)).status).toBe(200);
    const after = (await c.get('/api/profile')).body.profile;
    expect(after).toMatchObject({ companyName: 'New Name LLP', phone: '+77029998877', bin: p.bin });
    expect(err(await c.put('/api/profile/employer', { ...upd, bin: '123456789012' })).code).toBe('UNKNOWN_FIELDS');
    expect(err(await c.put('/api/profile/student', {})).code).toBe('FORBIDDEN');
  });
  const bad: [string, Record<string, unknown>, string, string][] = [
    ['gmail', { email: 'boss@gmail.com' }, 'email', 'EMAIL_NOT_CORPORATE'],
    ['mail.ru', { email: 'boss@mail.ru' }, 'email', 'EMAIL_NOT_CORPORATE'],
    ['yandex.kz', { email: 'boss@yandex.kz' }, 'email', 'EMAIL_NOT_CORPORATE'],
    ['disposable', { email: 'boss@mailinator.com' }, 'email', 'EMAIL_DISPOSABLE'],
    ['sdu domain', { email: 'boss@sdu.edu.kz' }, 'email', 'EMAIL_DOMAIN_NOT_ALLOWED'],
    ['BIN 11 digits', { bin: '12345678901' }, 'bin', 'BIN_INVALID'],
    ['BIN letters', { bin: '12345678901a' }, 'bin', 'BIN_INVALID'],
    ['bad size', { size: '5000' }, 'size', 'SIZE_INVALID'],
    ['bad industry', { industry: 'x' }, 'industry', 'INDUSTRY_INVALID'],
    ['website js', { website: 'javascript:alert(1)' }, 'website', 'WEBSITE_INVALID'],
    ['description 501', { description: 'a'.repeat(501) }, 'description', 'DESCRIPTION_TOO_LONG'],
    ['contact name digits', { contactName: 'T1mur' }, 'contactName', 'NAME_INVALID_CHARS'],
    ['company XSS', { companyName: '<script>alert(1)</script>' }, 'companyName', 'COMPANY_NAME_INVALID'],
    ['terms', { acceptTerms: false }, 'acceptTerms', 'TERMS_REQUIRED'],
  ];
  it.each(bad)('rejects: %s', async (_n, over, field, code) => {
    const { r } = await regEmployer(over);
    expect(r.status).toBe(400);
    expect(err(r).fields[field]).toBe(code);
  });
  it('optional website/description may be omitted', async () => {
    const p: any = employerPayload();
    delete p.website; delete p.description;
    expect((await new Client().post('/api/auth/register/employer', p)).status).toBe(201);
  });
  it('duplicate BIN / email / phone → 409', async () => {
    const { p } = await regEmployer();
    const r = await new Client().post('/api/auth/register/employer', { ...employerPayload(), bin: p.bin, email: p.email, phone: p.phone });
    expect(r.status).toBe(409);
    expect(err(r).fields).toMatchObject({ bin: 'BIN_TAKEN', email: 'EMAIL_TAKEN', phone: 'PHONE_TAKEN' });
  });
  it('race on BIN: one wins', async () => {
    const bin = '700000000001';
    const rs = await Promise.all(Array.from({ length: 4 }, () => new Client().post('/api/auth/register/employer', employerPayload({ bin }))));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
  });
  it('admin approval via API; non-admins are refused', async () => {
    const { c, p } = await regEmployer();
    await c.post('/api/auth/verify', { role: 'employer', identifier: p.email, code: await lastCode(c, p.email) });
    const [{ id }] = await sql('SELECT id FROM users WHERE email = $1', [p.email]);
    expect((await c.post(`/api/admin/employers/${id}/approve`)).status).toBe(403);
    expect((await new Client().post(`/api/admin/employers/${id}/approve`)).status).toBe(401);
    // seed an admin directly
    const { hashPassword } = await import('../src/lib/crypto');
    await sql(`INSERT INTO users (role, email, password_hash, status) VALUES ('admin', 'admin@careermatch.kz', $1, 'active')`, [await hashPassword('Cm!Root2026#Safe')]);
    const adm = new Client();
    expect((await adm.post('/api/auth/login', { role: 'employer', identifier: 'admin@careermatch.kz', password: 'Cm!Root2026#Safe' })).status).toBe(200);
    expect((await adm.get('/api/admin/employers?status=pending')).body.employers).toHaveLength(1);
    expect((await adm.post(`/api/admin/employers/not-a-uuid/approve`)).status).toBe(404);
    expect((await adm.post(`/api/admin/employers/${id}/approve`)).body.status).toBe('active');
    expect((await sql('SELECT status FROM users WHERE id = $1', [id]))[0].status).toBe('active');
    expect((await adm.post(`/api/admin/employers/${id}/approve`)).status).toBe(404); // already approved
  });
  it('admin cannot be created through registration', async () => {
    const r = await new Client().post('/api/auth/register/employer', { ...employerPayload(), role: 'admin' });
    expect(err(r).code).toBe('UNKNOWN_FIELDS');
    expect(await sql(`SELECT 1 FROM users WHERE role = 'admin'`)).toHaveLength(0);
  });
});

describe('database constraints hold even when the API is bypassed', () => {
  const insertUser = (role: string, sid: string | null, email: string, phone: string | null, status = 'unverified') =>
    sql(`INSERT INTO users (role, student_id, email, phone, password_hash, status) VALUES ($1,$2,$3,$4,'x',$5)`, [role, sid, email, phone, status]);
  it('student id / email / phone / status checks', async () => {
    await expect(insertUser('student', '12345678', 'a@sdu.edu.kz', null)).rejects.toThrow(/users_student_id_format_chk/);
    await expect(insertUser('student', '123456789', 'a@gmail.com', null)).rejects.toThrow(/users_student_rules_chk/);
    await expect(insertUser('student', '123456789', 'a@sdu.edu.kz.evil.com', null)).rejects.toThrow(/users_student_rules_chk/);
    await expect(insertUser('student', '123456789', 'A@sdu.edu.kz', null)).rejects.toThrow(/users_email_lower_chk/);
    await expect(insertUser('student', null, 'a@sdu.edu.kz', null)).rejects.toThrow(/users_student_rules_chk/);
    await expect(insertUser('student', '123456789', 'a@sdu.edu.kz', '+7701123')).rejects.toThrow(/users_phone_format_chk/);
    await expect(insertUser('student', '123456789', 'a@sdu.edu.kz', null, 'pending')).rejects.toThrow(/users_student_rules_chk/);
    await expect(insertUser('hacker', null, 'a@x.com', null)).rejects.toThrow(/users_role_chk/);
    await expect(insertUser('employer', null, 'a@x.com', null, 'superuser')).rejects.toThrow(/users_status_chk/);
    await insertUser('student', '123456789', 'ok@sdu.edu.kz', '+77011234567');
    await expect(insertUser('student', '123456789', 'ok2@sdu.edu.kz', null)).rejects.toThrow(/UNIQUE constraint failed: users.student_id/);
    await expect(insertUser('student', '123456780', 'ok@sdu.edu.kz', null)).rejects.toThrow(/UNIQUE constraint failed: users.email/);
    await expect(insertUser('student', '123456781', 'ok3@sdu.edu.kz', '+77011234567')).rejects.toThrow(/UNIQUE constraint failed: users.phone/);
  });
  it('GPA range and graduation day', async () => {
    const { payload } = await makeStudent();
    const [{ id }] = await sql('SELECT id FROM users WHERE student_id = $1', [payload.studentId]);
    await expect(sql('UPDATE student_profiles SET gpa = 4.01 WHERE user_id = $1', [id])).rejects.toThrow(/numeric field overflow|sp_gpa_chk/);
    await expect(sql('UPDATE student_profiles SET gpa = -0.5 WHERE user_id = $1', [id])).rejects.toThrow(/sp_gpa_chk/);
    await expect(sql(`UPDATE student_profiles SET graduation_date = '2029-06-15' WHERE user_id = $1`, [id])).rejects.toThrow(/sp_grad_chk/);
    await expect(sql(`UPDATE student_profiles SET name = 'A' WHERE user_id = $1`, [id])).rejects.toThrow(/sp_name_chk/);
    await expect(sql(`UPDATE student_profiles SET year_of_study = '7' WHERE user_id = $1`, [id])).rejects.toThrow(/sp_year_chk/);
  });
  it('SQL injection strings are stored inertly or rejected; tables survive', async () => {
    const c = new Client();
    await c.post('/api/auth/register/student', studentPayload({ name: "x'); DROP TABLE users;--" }));
    const { client } = await makeStudent();
    const cur = (await client.get('/api/profile')).body.profile;
    await client.put('/api/profile/student', { ...cur, skills: ["Robert'); DROP TABLE skills;--"] });
    expect(Number((await sql('SELECT count(*) AS n FROM users'))[0].n)).toBe(1);
    expect((await sql(`SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'skills'`))[0].t).toBe('skills');
  });
  it('max 30 skills enforced by trigger', async () => {
    const { payload } = await makeStudent();
    const [{ id }] = await sql('SELECT id FROM users WHERE student_id = $1', [payload.studentId]);
    await sql(`WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 31) INSERT INTO skills (name, name_key) SELECT 'bulk skill ' || n, 'bulk skill ' || n FROM g`);
    const ids = (await sql('SELECT id FROM skills ORDER BY id')).map((r) => r.id);
    for (const s of ids.slice(0, 30)) await sql('INSERT INTO student_skills (user_id, skill_id) VALUES ($1, $2)', [id, s]);
    await expect(sql('INSERT INTO student_skills (user_id, skill_id) VALUES ($1, $2)', [id, ids[30]])).rejects.toThrow(/TAGS_TOO_MANY/);
  });
});

describe('emails and output encoding', () => {
  it('verification emails are localized (EN/RU/KK) and HTML-escape user data', () => {
    for (const lang of ['en', 'ru', 'kk'] as const) {
      const m = buildCodeEmail(lang, 'register', '123456', '<script>alert(1)</script>');
      expect(m.html).not.toContain('<script>');
      expect(m.html).toContain('&lt;script&gt;');
      expect(m.text).toContain('123456');
    }
    expect(buildCodeEmail('ru', 'reset', '123456', '').subject).toMatch(/[А-Яа-я]/);
    expect(buildCodeEmail('kk', 'register', '123456', '').text).toMatch(/[ӘәҒғҚқҢңӨөҰұҮүҺһІі]/);
  });
});
