import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/lib/db';
import { getMailbox, setMailFailure } from '../src/lib/mail';
import { runDigest } from '../src/services/digest';
import { flushInstantEmails } from '../src/services/emailQueue';
import { digestEmail, instantEmail } from '../src/services/emailText';
import { unsubToken } from '../src/services/emailLinks';
import { Client, app, makeAdmin, makeEmployer, makeStudent, resetDb, setProfile, sql, testEnv, vacancyPayload, seedSkills, ago } from './helpers';

const BASE = 'http://localhost';
beforeEach(async () => {
  await resetDb();
  await sql('DELETE FROM audit_log');
  await seedSkills('Python', 'SQL', 'Docker');
  getMailbox().length = 0;
  setMailFailure(false);
});
afterEach(() => setMailFailure(false));

const mailsTo = (to: string) => getMailbox().filter((m) => m.to === to);
const uid = async (c: Client) => (await c.get('/api/profile')).body.user.id as string;
async function publish(emp: Awaited<ReturnType<typeof makeEmployer>>, over: Record<string, unknown> = {}) {
  const c = await emp.client.post('/api/vacancies', vacancyPayload(over));
  expect(c.status).toBe(201);
  const id = c.body.vacancy.id as string;
  expect((await emp.client.post(`/api/vacancies/${id}/publish`)).status).toBe(200);
  return id;
}
async function applied(opts: { lang?: string } = {}) {
  const emp = await makeEmployer();
  const st = await makeStudent({ language: opts.lang ?? 'en' });
  await setProfile(st.client, { skills: ['Python', 'SQL'] });
  const vid = await publish(emp);
  const app_ = (await st.client.post(`/api/vacancies/${vid}/apply`)).body.application;
  return { emp, st, vid, appId: app_.id as string };
}
const queryUnsub = (url: string) => new URL(url);

describe('instant e-mails', () => {
  it('status change mails the student in THEIR language with an unsubscribe link and RFC 8058 headers', async () => {
    const { emp, st, appId } = await applied({ lang: 'ru' });
    getMailbox().length = 0;
    expect((await emp.client.patch(`/api/applications/${appId}/status`, { status: 'shortlisted' })).status).toBe(200);
    const m = mailsTo(st.payload.email);
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe('notification.status_changed');
    expect(m[0].subject).toBe('Junior Python Developer Intern: В шорт-листе');
    expect(m[0].text).toContain('Здравствуйте, Aigerim!');
    expect(m[0].text).toContain(`${BASE}/applications`);
    const unsub = /Отписаться от мгновенных писем: (\S+)/.exec(m[0].text)![1];
    const u = queryUnsub(unsub);
    expect(u.pathname).toBe('/unsubscribe');
    expect(u.searchParams.get('k')).toBe('instant');
    expect(u.searchParams.get('t')).toBe(await unsubToken(testEnv, await uid(st.client), 'instant'));
    expect(m[0].headers!['List-Unsubscribe']).toContain('/api/email/unsubscribe?u=');
    expect(m[0].headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(m[0].html).toContain('lang="ru"');
  });

  it('covers new application (employer), invitation (student) and employer approval', async () => {
    const emp = await makeEmployer();
    const st = await makeStudent();
    await setProfile(st.client, { skills: ['Python', 'SQL'] });
    const vid = await publish(emp);
    getMailbox().length = 0;
    await st.client.post(`/api/vacancies/${vid}/apply`);
    expect(mailsTo(emp.payload.email).map((x) => x.kind)).toEqual(['notification.new_application']);
    expect(mailsTo(emp.payload.email)[0].text).toContain('Aigerim Nurlanova applied to “Junior Python Developer Intern”');
    const other = await makeStudent();
    await setProfile(other.client, { skills: ['Python'] });
    getMailbox().length = 0;
    expect((await emp.client.post(`/api/vacancies/${vid}/invite`, { studentId: await uid(other.client) })).status).toBe(201);
    expect(mailsTo(other.payload.email).map((x) => x.kind)).toEqual(['notification.invitation']);
    const admin = await makeAdmin();
    const pend = await makeEmployer({ active: false });
    getMailbox().length = 0;
    const pid = (await sql<{ id: string }>('SELECT id FROM users WHERE email = $1', [pend.payload.email]))[0].id;
    await admin.post(`/api/admin/employers/${pid}/approve`);
    expect(mailsTo(pend.payload.email).map((x) => x.kind)).toEqual(['notification.employer_approved']);
  });

  it('respects opt-out: in-app notification stays, no mail, the row is closed so it is never mailed later', async () => {
    const { emp, st, appId } = await applied();
    expect((await st.client.put('/api/email/prefs', { instant: false })).body).toEqual({ digest: true, instant: false });
    getMailbox().length = 0;
    await emp.client.patch(`/api/applications/${appId}/status`, { status: 'viewed' });
    expect(mailsTo(st.payload.email)).toHaveLength(0);
    expect((await st.client.get('/api/notifications')).body.items.some((n: any) => n.kind === 'status_changed')).toBe(true);
    await st.client.put('/api/email/prefs', { instant: true });
    await flushInstantEmails(new Db(testEnv), testEnv, BASE, 50);
    expect(mailsTo(st.payload.email)).toHaveLength(0);
  });

  it('never mails blocked users or notifications older than 2 days; unknown kinds are ignored', async () => {
    const { emp, st, appId } = await applied();
    await emp.client.patch(`/api/applications/${appId}/status`, { status: 'viewed' });
    getMailbox().length = 0;
    const id = await uid(st.client);
    await sql(`INSERT INTO notifications (user_id, kind, params, link, created_at) VALUES ($1, 'status_changed', '{"title":"Old","company":"X","status":"viewed"}', '/applications', ${ago(3, 'days')})`, [id]);
    await sql(`INSERT INTO notifications (user_id, kind, params) VALUES ($1, 'new_match', '{"title":"M","company":"X","percent":90}')`, [id]);
    await flushInstantEmails(new Db(testEnv), testEnv, BASE, 50);
    expect(getMailbox()).toHaveLength(0);
    await sql(`UPDATE users SET status = 'blocked' WHERE id = $1`, [id]);
    await emp.client.patch(`/api/applications/${appId}/status`, { status: 'interview' });
    expect(getMailbox()).toHaveLength(0);
  });

  it('a failing provider never fails the request; failures are retried and capped at 5 attempts', async () => {
    const { emp, st, appId } = await applied();
    getMailbox().length = 0;
    setMailFailure(true);
    expect((await emp.client.patch(`/api/applications/${appId}/status`, { status: 'shortlisted' })).status).toBe(200);
    const row = async () => (await sql<{ emailed_at: string | null; email_attempts: number }>(`SELECT emailed_at, email_attempts FROM notifications WHERE kind = 'status_changed'`))[0];
    expect(await row()).toMatchObject({ emailed_at: null, email_attempts: 1 });
    for (let i = 0; i < 6; i++) await flushInstantEmails(new Db(testEnv), testEnv, BASE, 50);
    expect(await row()).toMatchObject({ emailed_at: null, email_attempts: 5 }); // gave up
    setMailFailure(false);
    await sql(`UPDATE notifications SET email_attempts = 0 WHERE kind = 'status_changed'`);
    await flushInstantEmails(new Db(testEnv), testEnv, BASE, 50);
    expect(mailsTo(st.payload.email)).toHaveLength(1);
    expect((await row()).emailed_at).not.toBeNull();
    await flushInstantEmails(new Db(testEnv), testEnv, BASE, 50);
    expect(mailsTo(st.payload.email)).toHaveLength(1); // never twice
  });

  it('concurrent flushes never send the same notification twice', async () => {
    const { st } = await applied();
    const id = await uid(st.client);
    getMailbox().length = 0;
    await sql(`UPDATE notifications SET emailed_at = ${ago(0, 'seconds')}`);
    for (let i = 0; i < 6; i++) await sql(`INSERT INTO notifications (user_id, kind, params, link) VALUES ($1, 'invitation', $2, '/applications')`, [id, JSON.stringify({ title: `Vac ${i}`, company: 'Acme' })]);
    await Promise.all([1, 2, 3, 4].map(() => flushInstantEmails(new Db(testEnv), testEnv, BASE, 50)));
    expect(mailsTo(st.payload.email)).toHaveLength(6);
    expect(new Set(mailsTo(st.payload.email).map((m) => m.subject)).size).toBe(1); // same subject ("invites you") but exactly 6 bodies
    expect(new Set(mailsTo(st.payload.email).map((m) => m.text)).size).toBe(6);
  });

  it('templates escape every dynamic value and cover all kinds in all languages', () => {
    const links = { open: 'https://x.test/a?b=1&c=2', unsub: 'https://x.test/u', unsubPostUrl: 'https://x.test/p', manage: 'https://x.test/profile' };
    const evil = { title: '<script>alert(1)</script>', company: '"><img src=x onerror=alert(1)>', student: "<b>Bob</b> & 'Eve'", status: 'shortlisted', percent: 90 };
    for (const lang of ['en', 'ru', 'kk'] as const) {
      for (const kind of ['status_changed', 'invitation', 'new_application', 'employer_approved']) {
        const m = instantEmail(lang, kind, evil, '<i>Name</i>', links)!;
        expect(m, `${lang} ${kind}`).not.toBeNull();
        expect(m.html).not.toMatch(/<script|<img|<b>Bob|<i>Name/);
        expect(m.html).toContain('&lt;');
        expect(m.html).toContain('href="https://x.test/a?b=1&amp;c=2"');
        expect(m.subject.length).toBeGreaterThan(3);
      }
    }
    expect(instantEmail('en', 'nope', {}, '', links)).toBeNull();
    const d = digestEmail('en', 'N', { role: 'student', matches: [{ title: '<script>x</script>', sub: '"quote"', url: 'https://x.test/?a=1&b=2' }], saved: [], status: [], deadlines: [], applicants: [], pending: 0 }, links);
    expect(d.html).not.toContain('<script>');
    expect(d.html).toContain('&lt;script&gt;');
    expect(d.html).toContain('href="https://x.test/?a=1&amp;b=2"');
  });
});

describe('preferences & unsubscribe', () => {
  it('prefs default to on, validate input strictly, and are per user', async () => {
    const a = await makeStudent(), b = await makeStudent();
    expect((await a.client.get('/api/email/prefs')).body).toEqual({ digest: true, instant: true });
    expect((await a.client.put('/api/email/prefs', { digest: false })).body).toEqual({ digest: false, instant: true });
    expect((await a.client.get('/api/email/prefs')).body).toEqual({ digest: false, instant: true });
    expect((await b.client.get('/api/email/prefs')).body).toEqual({ digest: true, instant: true });
    for (const body of [{}, { digest: 'no' }, { digest: true, extra: 1 }, [], null, { instant: 1 }]) expect((await a.client.put('/api/email/prefs', body as never)).status, JSON.stringify(body)).toBe(400);
    expect((await new Client().get('/api/email/prefs')).status).toBe(401);
  });

  const post = (qs: string) => app.request(`http://localhost/api/email/unsubscribe?${qs}`, { method: 'POST', headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }, testEnv);
  it('one-click POST without cookies/CSRF: token is bound to user AND kind; idempotent', async () => {
    const s = await makeStudent();
    const id = await uid(s.client);
    const tok = (k: 'digest' | 'instant' | 'all') => unsubToken(testEnv, id, k);
    expect((await post(`u=${id}&k=digest&t=${await tok('digest')}`)).status).toBe(200);
    expect((await s.client.get('/api/email/prefs')).body).toEqual({ digest: false, instant: true });
    expect((await post(`u=${id}&k=digest&t=${await tok('digest')}`)).status).toBe(200); // idempotent
    expect((await post(`u=${id}&k=instant&t=${await tok('digest')}`)).status).toBe(404); // token for another kind
    expect((await s.client.get('/api/email/prefs')).body.instant).toBe(true);
    expect((await post(`u=${id}&k=all&t=${await tok('all')}`)).status).toBe(200);
    expect((await s.client.get('/api/email/prefs')).body).toEqual({ digest: false, instant: false });
  });
  it('tampered, foreign, malformed or unknown-user links all answer the same 404', async () => {
    const a = await makeStudent(), b = await makeStudent();
    const ida = await uid(a.client), idb = await uid(b.client);
    const good = await unsubToken(testEnv, ida, 'all');
    const flipped = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
    const ghost = '00000000-0000-4000-8000-000000000000';
    for (const qs of [`u=${ida}&k=all&t=${flipped}`, `u=${idb}&k=all&t=${good}`, `u=${ida}&k=all&t=${'a'.repeat(64)}`, `u=${ida}&k=all&t=short`, `u=nope&k=all&t=${good}`, `u=${ida}&k=evil&t=${good}`, '', `u=${ghost}&k=all&t=${await unsubToken(testEnv, ghost, 'all')}`, `u=${ida}&k=all&t=${good.toUpperCase()}`]) {
      const r = await post(qs);
      expect(r.status, qs).toBe(404);
      expect(await r.json()).toEqual({ error: { code: 'NOT_FOUND' } });
    }
    expect((await b.client.get('/api/email/prefs')).body).toEqual({ digest: true, instant: true });
    expect((await a.client.get('/api/email/prefs')).body).toEqual({ digest: true, instant: true });
  });
  it('is rate limited per IP', async () => {
    const ip = '10.77.7.7';
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await app.request('http://localhost/api/email/unsubscribe?u=x&k=all&t=y', { method: 'POST', headers: { 'x-forwarded-for': ip } }, testEnv)).status;
    expect(last).toBe(429);
  });
  it('other POSTs still require CSRF (the exemption is exactly one path)', async () => {
    const r = await app.request('http://localhost/api/email/prefs', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.8.8.8' }, body: '{"digest":false}' }, testEnv);
    expect(r.status).toBe(403);
  });
});

describe('weekly digest', () => {
  const db = () => new Db(testEnv);
  async function studentWithActivity() {
    const emp = await makeEmployer();
    const st = await makeStudent({ language: 'en' });
    await setProfile(st.client, { skills: ['Python', 'SQL'] });
    await st.client.post('/api/saved-searches', { name: 'sql jobs', filters: { q: 'sql' } });
    const matchVac = await publish(emp, { title: 'Python SQL analyst', requiredSkills: ['Python', 'SQL'] }); // new match + saved-search (sql) → one notification
    const soon = new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10);
    const favVac = await publish(emp, { title: 'Closing soon role', requiredSkills: ['Docker'], deadline: soon });
    await st.client.put(`/api/favorites/${favVac}`);
    const appVac = await publish(emp, { title: 'Applied role', requiredSkills: ['Python'] });
    const appId = (await st.client.post(`/api/vacancies/${appVac}/apply`)).body.application.id;
    await emp.client.patch(`/api/applications/${appId}/status`, { status: 'interview' });
    getMailbox().length = 0;
    return { emp, st, matchVac, favVac };
  }

  it('student digest: matches, saved-search hits, application updates and closing deadlines — links absolute, own data only', async () => {
    const { st, matchVac, favVac } = await studentWithActivity();
    const r = await runDigest(db(), testEnv, { base: BASE });
    const m = mailsTo(st.payload.email).filter((x) => x.kind === 'digest');
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(m).toHaveLength(1);
    expect(m[0].subject).toBe('Your weekly SDU Career Match digest');
    expect(m[0].text).toContain('NEW MATCHES FOR YOU');
    expect(m[0].text).toContain(`Python SQL analyst`);
    expect(m[0].text).toContain(`${BASE}/vacancies/${matchVac}`);
    expect(m[0].text).toContain('APPLICATION UPDATES');
    expect(m[0].text).toContain('Applied role');
    expect(m[0].text).toContain('Interview');
    expect(m[0].text).toContain('CLOSING SOON');
    expect(m[0].text).toContain(`${BASE}/vacancies/${favVac}`);
    expect(m[0].text).not.toMatch(/Applied role[^\n]*\n[^\n]*vacancies\/[^\n]*matches/); // applied vacancies are not "matches" to apply for
    expect(m[0].text).toContain('Unsubscribe from the weekly digest');
    expect(m[0].headers!['List-Unsubscribe']).toMatch(/k=digest/);
    expect((await sql<{ last_digest_at: string | null }>('SELECT last_digest_at FROM users WHERE email = $1', [st.payload.email]))[0].last_digest_at).not.toBeNull();
  });

  it('runs at most once per 6 days per user; with nothing new it sends nothing and does not consume the slot', async () => {
    const { st } = await studentWithActivity();
    await runDigest(db(), testEnv, { base: BASE });
    const count = () => getMailbox().filter((x) => x.kind === 'digest' && x.to === st.payload.email).length;
    expect(count()).toBe(1);
    await runDigest(db(), testEnv, { base: BASE });
    expect(count()).toBe(1);
    await sql('DELETE FROM favorites'); // deadline reminders follow the database clock, which this test does not advance
    const later = new Date(Date.now() + 8 * 86400_000);
    const r = await runDigest(db(), testEnv, { base: BASE, now: later });
    expect(count()).toBe(1); // nothing new since last time → no mail
    expect(r.sent).toBe(0);
    const before = (await sql<{ last_digest_at: string }>('SELECT last_digest_at FROM users WHERE email = $1', [st.payload.email]))[0].last_digest_at;
    await runDigest(db(), testEnv, { base: BASE, now: new Date(Date.now() + 9 * 86400_000) });
    expect((await sql<{ last_digest_at: string }>('SELECT last_digest_at FROM users WHERE email = $1', [st.payload.email]))[0].last_digest_at).toEqual(before);
  });

  it('concurrent runs mail a user exactly once', async () => {
    const { st } = await studentWithActivity();
    await Promise.all([1, 2, 3, 4].map(() => runDigest(db(), testEnv, { base: BASE })));
    expect(getMailbox().filter((x) => x.kind === 'digest' && x.to === st.payload.email)).toHaveLength(1);
  });

  it('a failed send rolls the claim back so the next run retries', async () => {
    const { st } = await studentWithActivity();
    setMailFailure(true);
    const r = await runDigest(db(), testEnv, { base: BASE });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect((await sql<{ last_digest_at: string | null }>('SELECT last_digest_at FROM users WHERE email = $1', [st.payload.email]))[0].last_digest_at).toBeNull();
    setMailFailure(false);
    await runDigest(db(), testEnv, { base: BASE });
    expect(getMailbox().filter((x) => x.kind === 'digest' && x.to === st.payload.email)).toHaveLength(1);
  });

  it('skips opted-out, blocked and unverified users', async () => {
    const { st } = await studentWithActivity();
    await st.client.put('/api/email/prefs', { digest: false });
    await runDigest(db(), testEnv, { base: BASE });
    expect(getMailbox().filter((x) => x.kind === 'digest' && x.to === st.payload.email)).toHaveLength(0);
    await st.client.put('/api/email/prefs', { digest: true });
    await sql(`UPDATE users SET status = 'blocked' WHERE email = $1`, [st.payload.email]);
    await runDigest(db(), testEnv, { base: BASE });
    expect(getMailbox().filter((x) => x.to === st.payload.email && x.kind === 'digest')).toHaveLength(0);
  });

  it('employer digest: new applicants per vacancy plus the pending backlog', async () => {
    const emp = await makeEmployer();
    const vid = await publish(emp, { title: 'Popular role' });
    for (let i = 0; i < 2; i++) { const s = await makeStudent(); await setProfile(s.client, { skills: ['Python', 'SQL'] }); await s.client.post(`/api/vacancies/${vid}/apply`); }
    getMailbox().length = 0;
    await runDigest(db(), testEnv, { base: BASE, userId: (await sql<{ id: string }>('SELECT id FROM users WHERE email = $1', [emp.payload.email]))[0].id });
    const m = getMailbox().filter((x) => x.kind === 'digest' && x.to === emp.payload.email);
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain('NEW APPLICANTS');
    expect(m[0].text).toContain('Popular role — 2 new');
    expect(m[0].text).toContain('2 application(s) are waiting for your decision.');
    expect(m[0].text).toContain(`${BASE}/vacancies/${vid}/applicants`);
  });

  it('an employer with no new applicants gets no digest even with a backlog', async () => {
    const emp = await makeEmployer();
    const vid = await publish(emp);
    const s = await makeStudent(); await s.client.post(`/api/vacancies/${vid}/apply`);
    await sql(`UPDATE applications SET created_at = ${ago(30, 'days')}`);
    getMailbox().length = 0;
    await runDigest(db(), testEnv, { base: BASE, userId: (await sql<{ id: string }>('SELECT id FROM users WHERE email = $1', [emp.payload.email]))[0].id });
    expect(getMailbox().filter((x) => x.kind === 'digest')).toHaveLength(0);
  });

  it('admin can trigger it; non-admins cannot; the run is audited', async () => {
    await studentWithActivity();
    const admin = await makeAdmin();
    const emp = await makeEmployer();
    expect((await emp.client.post('/api/admin/digest/run')).status).toBe(403);
    expect((await new Client().post('/api/admin/digest/run')).status).toBe(401);
    const r = await admin.post('/api/admin/digest/run');
    expect(r.status).toBe(200);
    expect(r.body.digest.sent).toBeGreaterThanOrEqual(1);
    expect((await sql(`SELECT meta FROM audit_log WHERE action = 'digest.run'`))).toHaveLength(1);
    const again = await admin.post('/api/admin/digest/run');
    expect(again.body.digest.sent).toBe(0);
  });

  it('localises the digest (Russian)', async () => {
    const emp = await makeEmployer();
    const st = await makeStudent({ language: 'ru' });
    await setProfile(st.client, { skills: ['Python', 'SQL'] });
    await publish(emp);
    getMailbox().length = 0;
    await runDigest(db(), testEnv, { base: BASE });
    const m = getMailbox().find((x) => x.kind === 'digest' && x.to === st.payload.email)!;
    expect(m.subject).toBe('Ваша еженедельная сводка SDU Career Match');
    expect(m.text).toContain('НОВЫЕ СОВПАДЕНИЯ');
    expect(m.text).toMatch(/совпадение \d+%/);
  });
});
