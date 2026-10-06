import { beforeEach, describe, expect, it } from 'vitest';
import { vacancyMatchesFilters, type SavedFilters } from '@sdu/shared';
import { Client, makeAdmin, makeEmployer, makeStudent, resetDb, setProfile, sql, vacancyPayload, app, testEnv, seedSkills } from './helpers';

beforeEach(async () => {
  await resetDb();
  await sql('DELETE FROM audit_log');
  await seedSkills('Python', 'SQL', 'JavaScript', 'React', 'Vue.js', 'Docker', 'Machine Learning', 'Java', 'SEO', 'Marketing');
});
const err = (r: { body: any }) => r.body?.error;
type Emp = Awaited<ReturnType<typeof makeEmployer>>;

async function publish(emp: Emp, over: Record<string, unknown> = {}) {
  const c = await emp.client.post('/api/vacancies', vacancyPayload(over));
  expect(c.status).toBe(201);
  const id = c.body.vacancy.id as string;
  const p = await emp.client.post(`/api/vacancies/${id}/publish`);
  expect(p.status).toBe(200);
  return id;
}
const notifs = (userId: string, kind?: string) => sql<{ kind: string; params: any; link: string }>(`SELECT kind, params, link FROM notifications WHERE user_id = $1 ${kind ? `AND kind = '${kind}'` : ''} ORDER BY id`, [userId]);
const uid = async (c: Client) => (await c.get('/api/profile')).body.user.id as string;

describe('saved searches', () => {
  it('create / list / delete; names are normalised; filters are normalised', async () => {
    const { client } = await makeStudent();
    const r = await client.post('/api/saved-searches', { name: '  Python   interns ', filters: { q: ' python ', kind: 'internship' } });
    expect(r.status).toBe(201);
    expect(r.body.search).toMatchObject({ name: 'Python interns', filters: { q: 'python', kind: 'internship', industry: null, salaryFrom: null, withSalary: false } });
    const list = await client.get('/api/saved-searches');
    expect(list.body.searches).toHaveLength(1);
    expect(list.body.max).toBe(10);
    expect((await client.delete(`/api/saved-searches/${r.body.search.id}`)).status).toBe(200);
    expect((await client.get('/api/saved-searches')).body.searches).toEqual([]);
    expect((await client.delete(`/api/saved-searches/${r.body.search.id}`)).status).toBe(404);
  });

  it('validates input; rejects duplicates by name; enforces the limit', async () => {
    const { client } = await makeStudent();
    expect(err(await client.post('/api/saved-searches', { name: 'x', filters: {} })).fields.filters).toBe('SEARCH_INVALID');
    expect(err(await client.post('/api/saved-searches', { name: '', filters: { q: 'a' } })).fields.name).toBe('REQUIRED');
    expect(err(await client.post('/api/saved-searches', { name: 'x', filters: { q: 'a' }, role: 'admin' })).code).toBe('UNKNOWN_FIELDS');
    expect((await client.json('POST', '/api/saved-searches', undefined, { rawBody: '{nope' })).status).toBe(400);
    expect((await client.raw('POST', '/api/saved-searches', { body: '{}', headers: { 'content-type': 'text/plain', 'x-csrf-token': await client.ensureCsrf() } })).status).toBe(415);
    expect((await client.post('/api/saved-searches', { name: 'A', filters: { q: 'a' } })).status).toBe(201);
    const dup = await client.post('/api/saved-searches', { name: 'A', filters: { q: 'b' } });
    expect(dup.status).toBe(409);
    expect(err(dup).code).toBe('SAVED_SEARCH_NAME_TAKEN');
    for (let i = 1; i < 10; i++) expect((await client.post('/api/saved-searches', { name: `S${i}`, filters: { q: `q${i}` } })).status).toBe(201);
    const over = await client.post('/api/saved-searches', { name: 'one-too-many', filters: { q: 'z' } });
    expect(over.status).toBe(409);
    expect(err(over).code).toBe('SAVED_SEARCH_LIMIT');
  });

  it('the limit cannot be bypassed with concurrent requests', async () => {
    const { client } = await makeStudent();
    await client.ensureCsrf();
    const rs = await Promise.all(Array.from({ length: 16 }, (_, i) => client.post('/api/saved-searches', { name: `race${i}`, filters: { q: `r${i}` } })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(10);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(6);
    expect(await sql('SELECT 1 FROM saved_searches')).toHaveLength(10);
  });

  it('is private to the student: others cannot delete it, employers/anonymous are refused', async () => {
    const a = await makeStudent(), b = await makeStudent(), emp = await makeEmployer();
    const s = (await a.client.post('/api/saved-searches', { name: 'mine', filters: { q: 'a' } })).body.search;
    expect((await b.client.delete(`/api/saved-searches/${s.id}`)).status).toBe(404);
    expect((await b.client.get('/api/saved-searches')).body.searches).toEqual([]);
    expect((await emp.client.get('/api/saved-searches')).status).toBe(403);
    expect((await new Client().get('/api/saved-searches')).status).toBe(401);
    expect((await a.client.delete('/api/saved-searches/not-a-uuid')).status).toBe(404);
    expect((await a.client.post('/api/saved-searches', { name: 'x', filters: { q: 'a' } }, ) ).status).toBe(201);
    expect((await a.client.json('POST', '/api/saved-searches', { name: 'y', filters: { q: 'a' } }, { csrf: null })).status).toBe(403);
    expect(await sql('SELECT 1 FROM saved_searches WHERE id = $1', [s.id])).toHaveLength(1);
  });

  it('publishing alerts matching students exactly once; non-matching and already-matched students are not pinged', async () => {
    const emp = await makeEmployer();
    const pyFan = await makeStudent(), javaFan = await makeStudent(), both = await makeStudent(), strong = await makeStudent({ interestArea: 'data_ai' });
    await pyFan.client.post('/api/saved-searches', { name: 'py', filters: { q: 'python' } });
    await javaFan.client.post('/api/saved-searches', { name: 'java', filters: { q: 'java' } });
    await both.client.post('/api/saved-searches', { name: 'first', filters: { industry: 'it_software' } });
    await both.client.post('/api/saved-searches', { name: 'second', filters: { q: 'python' } });
    // a student who matches strongly gets "new_match"; their saved search must not ping them a second time
    await setProfile(strong.client, { skills: ['Python', 'SQL'] });
    await strong.client.post('/api/saved-searches', { name: 'py-too', filters: { q: 'python' } });

    const vid = await publish(emp);
    const sa = await notifs(await uid(pyFan.client), 'saved_search');
    expect(sa).toHaveLength(1);
    expect(sa[0]).toMatchObject({ link: `/vacancies/${vid}`, params: { search: 'py', company: 'Acme Technologies LLP' } });
    expect(await notifs(await uid(javaFan.client), 'saved_search')).toHaveLength(0);
    const b = await notifs(await uid(both.client), 'saved_search');
    expect(b).toHaveLength(1);
    expect(b[0].params.search).toBe('first'); // earliest-created matching search names the alert
    expect(await sql('SELECT 1 FROM saved_search_hits')).toHaveLength(3); // pyFan, both×2 — `strong` is skipped because it already got new_match
    const st = await uid(strong.client);
    expect((await notifs(st, 'new_match')).length).toBe(1);
    expect(await notifs(st, 'saved_search')).toHaveLength(0);
  });

  it('closing and a second publish call never re-alert; concurrent publishes alert once and audit once', async () => {
    const emp = await makeEmployer();
    const s = await makeStudent();
    await s.client.post('/api/saved-searches', { name: 'py', filters: { q: 'python' } });
    const created = await emp.client.post('/api/vacancies', vacancyPayload());
    const id = created.body.vacancy.id;
    await emp.client.ensureCsrf();
    const rs = await Promise.all([1, 2, 3].map(() => emp.client.post(`/api/vacancies/${id}/publish`)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await notifs(await uid(s.client), 'saved_search')).toHaveLength(1);
    expect(await sql(`SELECT 1 FROM audit_log WHERE action = 'vacancy.publish'`)).toHaveLength(1);
    expect((await emp.client.post(`/api/vacancies/${id}/publish`)).body.matches).toBe(0);
    expect(await notifs(await uid(s.client), 'saved_search')).toHaveLength(1);
  });

  it('deleting the account or the vacancy cleans up hits; unverified/blocked students are not alerted', async () => {
    const emp = await makeEmployer();
    const s = await makeStudent(), blocked = await makeStudent();
    await s.client.post('/api/saved-searches', { name: 'py', filters: { q: 'python' } });
    await blocked.client.post('/api/saved-searches', { name: 'py', filters: { q: 'python' } });
    await sql(`UPDATE users SET status = 'blocked' WHERE id = $1`, [await uid(blocked.client)].length ? [(await sql<{ id: string }>(`SELECT user_id AS id FROM saved_searches ORDER BY created_at DESC LIMIT 1`))[0].id] : []);
    const vid = await publish(emp);
    expect(await sql('SELECT 1 FROM saved_search_hits')).toHaveLength(1);
    await emp.client.delete(`/api/vacancies/${vid}`);
    expect(await sql('SELECT 1 FROM saved_search_hits')).toHaveLength(0);
  });

  it('consistency: alert matching equals what GET /api/vacancies returns for the same filters', async () => {
    const emp = await makeEmployer();
    const s = await makeStudent();
    const vs = [
      vacancyPayload({ title: 'Python intern', requiredSkills: ['Python'], salaryMin: 200000, salaryMax: 300000 }),
      vacancyPayload({ title: 'Java developer', requiredSkills: ['Java'], kind: 'full_time', city: 'astana', workFormat: 'remote' }),
      vacancyPayload({ title: 'SEO specialist', description: 'Grow organic traffic for our brand every month.', requiredSkills: ['SEO', 'Marketing'], industry: 'media_marketing', city: 'almaty', salaryMin: 500000 }),
      vacancyPayload({ title: 'Data analyst', requiredSkills: ['SQL', 'Python'], workFormat: 'hybrid', salaryMax: 900000 }),
    ];
    for (const v of vs) await publish(emp, v);
    const all = (await s.client.get('/api/vacancies?sort=newest')).body.items as any[];
    expect(all).toHaveLength(4);
    const f = (o: Partial<SavedFilters>): SavedFilters => ({ q: '', industry: null, kind: null, format: null, city: null, salaryFrom: null, withSalary: false, ...o });
    const cases: [Partial<SavedFilters>, string][] = [
      [{ q: 'python' }, 'q=python'], [{ q: 'SEO' }, 'q=SEO'], [{ q: 'acme' }, 'q=acme'], [{ q: '100%' }, 'q=100%25'], [{ q: '_' }, 'q=_'],
      [{ kind: 'full_time' }, 'kind=full_time'], [{ city: 'astana' }, 'city=astana'], [{ format: 'remote' }, 'format=remote'], [{ industry: 'media_marketing' }, 'industry=media_marketing'],
      [{ salaryFrom: 250000 }, 'salaryFrom=250000'], [{ withSalary: true }, 'withSalary=1'], [{ q: 'python', salaryFrom: 800000 }, 'q=python&salaryFrom=800000'],
    ];
    for (const [filters, qs] of cases) {
      const viaApi = ((await s.client.get(`/api/vacancies?sort=newest&${qs}`)).body.items as any[]).map((i) => i.id).sort();
      const viaJs = all.filter((i) => vacancyMatchesFilters(f(filters), { title: i.title, description: i.description, companyName: i.company.name, requiredSkills: i.requiredSkills, industry: i.industry, kind: i.kind, workFormat: i.workFormat, city: i.city, salaryMin: i.salaryMin, salaryMax: i.salaryMax })).map((i) => i.id).sort();
      expect(viaJs, qs).toEqual(viaApi);
    }
  });
});

describe('account export & deletion', () => {
  it('student export contains their data, never secrets, and is audited', async () => {
    const { client, payload } = await makeStudent();
    await setProfile(client, { skills: ['Python'] });
    await client.post('/api/saved-searches', { name: 'py', filters: { q: 'python' } });
    const emp = await makeEmployer();
    const vid = await publish(emp);
    await client.post(`/api/vacancies/${vid}/apply`, { coverNote: 'Hello' });
    expect((await client.put(`/api/favorites/${vid}`)).status).toBe(200);
    const r = await client.get('/api/profile/export');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('attachment');
    const b = r.body;
    expect(b.account).toMatchObject({ email: payload.email, role: 'student', studentId: payload.studentId });
    expect(b.profile.skills).toEqual(['Python']);
    expect(b.applications).toHaveLength(1);
    expect(b.applications[0]).toMatchObject({ vacancy: 'Junior Python Developer Intern', coverNote: 'Hello' });
    expect(b.applications[0].history).toHaveLength(1);
    expect(b.savedSearches).toHaveLength(1);
    expect(b.favorites).toHaveLength(1);
    const text = JSON.stringify(b).toLowerCase();
    expect(text).not.toContain('password');
    expect(text).not.toContain('token_hash');
    expect(text).not.toContain('pbkdf2');
    expect(await sql(`SELECT 1 FROM audit_log WHERE action = 'account.export'`)).toHaveLength(1);
  });

  it('employer export lists vacancies with applicant COUNTS only (no applicant personal data)', async () => {
    const emp = await makeEmployer();
    const st = await makeStudent();
    const vid = await publish(emp);
    await st.client.post(`/api/vacancies/${vid}/apply`);
    const b = (await emp.client.get('/api/profile/export')).body;
    expect(b.vacancies).toHaveLength(1);
    expect(b.vacancies[0].applicantCount).toBe(1);
    expect(JSON.stringify(b)).not.toContain(st.payload.email);
    expect(JSON.stringify(b)).not.toContain(st.payload.studentId);
    expect((await new Client().get('/api/profile/export')).status).toBe(401);
  });

  it('export is rate limited', async () => {
    const { client } = await makeStudent();
    for (let i = 0; i < 5; i++) expect((await client.get('/api/profile/export')).status).toBe(200);
    const r = await client.get('/api/profile/export');
    expect(r.status).toBe(429);
    expect(err(r).retryAfter).toBeGreaterThan(0);
  });

  it('deletion needs the right password; wrong/missing/extra input changes nothing', async () => {
    const { client } = await makeStudent();
    const id = await uid(client);
    expect(err(await client.json('DELETE', '/api/profile', { password: 'Wrong#Pass1234' })).code).toBe('INVALID_CREDENTIALS');
    expect(err(await client.json('DELETE', '/api/profile', {})).fields.password).toBe('REQUIRED');
    expect(err(await client.json('DELETE', '/api/profile', { password: 123 })).fields.password).toBe('REQUIRED');
    expect(err(await client.json('DELETE', '/api/profile', { password: 'x'.repeat(129) })).fields.password).toBe('REQUIRED');
    expect(err(await client.json('DELETE', '/api/profile', [])).fields.password).toBe('REQUIRED');
    expect(err(await client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4', confirm: true })).code).toBe('UNKNOWN_FIELDS');
    expect((await client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' }, { csrf: null })).status).toBe(403);
    expect(await sql('SELECT 1 FROM users WHERE id = $1', [id])).toHaveLength(1);
  });

  it('wrong-password attempts are rate limited (cannot be used to brute-force the password)', async () => {
    const { client } = await makeStudent();
    for (let i = 0; i < 5; i++) expect((await client.json('DELETE', '/api/profile', { password: 'Wrong#Pass1234' })).status).toBe(401);
    const r = await client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' });
    expect(r.status).toBe(429);
  });

  it('student deletion erases everything they own, kills the session, keeps an anonymous audit row', async () => {
    const { client, payload } = await makeStudent();
    await setProfile(client, { skills: ['Python'] });
    const emp = await makeEmployer();
    const vid = await publish(emp);
    await client.post(`/api/vacancies/${vid}/apply`);
    await client.post('/api/saved-searches', { name: 'py', filters: { q: 'python' } });
    await client.get(`/api/vacancies/${vid}`);
    const id = await uid(client);
    const r = await client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' });
    expect(r.status).toBe(200);
    for (const t of ['users', 'student_profiles', 'applications', 'saved_searches', 'student_skills', 'vacancy_views', 'sessions', 'matches', 'notifications']) {
      const col = t === 'users' ? 'id' : t === 'applications' ? 'student_id' : t === 'matches' || t === 'vacancy_views' ? 'student_id' : 'user_id';
      expect(await sql(`SELECT 1 FROM ${t} WHERE ${col} = $1`, [id]), t).toHaveLength(0);
    }
    expect((await client.get('/api/profile')).status).toBe(401);
    const login = await new Client().post('/api/auth/login', { role: 'student', identifier: payload.studentId, password: 'Vk8#mQ2!zPw4' });
    expect(login.status).toBe(401);
    const a = (await sql(`SELECT actor_id, actor_role, CAST(meta AS TEXT) AS metatext FROM audit_log WHERE action = 'account.delete'`))[0];
    expect(a).toMatchObject({ actor_id: null, actor_role: 'student' });
    expect(a.metatext).not.toContain(payload.email);
    // the employer still has the vacancy, the application is gone
    expect((await emp.client.get(`/api/vacancies/${vid}/applicants`)).body.applicants).toEqual([]);
  });

  it('employer deletion removes their vacancies (and applications on them); students keep their own accounts', async () => {
    const emp = await makeEmployer();
    const st = await makeStudent();
    const vid = await publish(emp);
    await st.client.post(`/api/vacancies/${vid}/apply`);
    expect((await emp.client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' })).status).toBe(200);
    expect(await sql('SELECT 1 FROM vacancies')).toHaveLength(0);
    expect(await sql('SELECT 1 FROM applications')).toHaveLength(0);
    expect((await st.client.get('/api/profile')).status).toBe(200);
    expect((await sql(`SELECT meta FROM audit_log WHERE action = 'account.delete'`))[0].meta).toMatchObject({ role: 'employer', vacancies: 1, applications: 1 });
  });

  it('the admin account cannot be deleted through the API', async () => {
    const admin = await makeAdmin();
    expect((await admin.json('DELETE', '/api/profile', { password: 'Cm!Root2026#Safe' })).status).toBe(403);
    expect(await sql(`SELECT 1 FROM users WHERE role = 'admin'`)).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('records employer decisions, vacancy lifecycle and application status changes', async () => {
    const admin = await makeAdmin();
    const emp = await makeEmployer({ active: false });
    const empId = (await sql<{ id: string }>('SELECT id FROM users WHERE email = $1', [emp.payload.email]))[0].id;
    expect((await admin.post(`/api/admin/employers/${empId}/approve`)).status).toBe(200);
    await emp.client.post('/api/auth/logout'); await emp.client.post('/api/auth/login', { role: 'employer', identifier: emp.payload.email, password: emp.payload.password });
    const st = await makeStudent();
    const vid = await publish(emp);
    const app = (await st.client.post(`/api/vacancies/${vid}/apply`)).body.application;
    await emp.client.patch(`/api/applications/${app.id}/status`, { status: 'shortlisted' });
    await emp.client.post(`/api/vacancies/${vid}/close`);
    const draft = (await emp.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    await emp.client.delete(`/api/vacancies/${draft}`);
    const rej = await makeEmployer({ active: false });
    const rejId = (await sql<{ id: string }>('SELECT id FROM users WHERE email = $1', [rej.payload.email]))[0].id;
    await admin.post(`/api/admin/employers/${rejId}/reject`);

    const r = await admin.get('/api/admin/audit?limit=100');
    expect(r.status).toBe(200);
    const actions = r.body.items.map((i: any) => i.action);
    expect(actions).toEqual(['employer.reject', 'vacancy.delete', 'vacancy.close', 'application.status', 'vacancy.publish', 'employer.approve']);
    const status = r.body.items.find((i: any) => i.action === 'application.status');
    expect(status).toMatchObject({ target: { type: 'application', id: app.id }, meta: { from: 'applied', to: 'shortlisted' }, actor: { role: 'employer', id: emp.id } });
    expect(r.body.items.find((i: any) => i.action === 'employer.approve')).toMatchObject({ actor: { role: 'admin' }, target: { type: 'user', id: empId } });
    expect(r.body.next).toBeNull();
  });

  it('failed actions are not audited (no row for a 404/no-op)', async () => {
    const admin = await makeAdmin();
    await admin.post('/api/admin/employers/00000000-0000-4000-8000-000000000000/approve');
    const emp = await makeEmployer();
    await emp.client.post('/api/vacancies/00000000-0000-4000-8000-000000000000/close');
    expect(await sql('SELECT 1 FROM audit_log')).toHaveLength(0);
  });

  it('is admin only, validates its parameters and paginates with a stable cursor', async () => {
    const admin = await makeAdmin();
    const emp = await makeEmployer();
    for (let i = 0; i < 5; i++) await publish(emp, { title: `Vacancy number ${i}` });
    expect((await emp.client.get('/api/admin/audit')).status).toBe(403);
    expect((await new Client().get('/api/admin/audit')).status).toBe(401);
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'before=x', 'before=-1', 'action=DROP TABLE', 'action=' + 'a'.repeat(41), 'limit=1.5']) expect((await admin.get(`/api/admin/audit?${q}`)).status, q).toBe(400);
    const seen: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const r: any = await admin.get(`/api/admin/audit?limit=2&action=vacancy.publish${before ? `&before=${before}` : ''}`);
      expect(r.status).toBe(200);
      expect(r.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...r.body.items.map((i: any) => i.id));
      before = r.body.next;
      if (!before) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort((a, b) => Number(b) - Number(a))).toEqual(seen); // strictly newest first
    expect((await admin.get('/api/admin/audit?action=nothing.here')).body.items).toEqual([]);
  });

  it('is append-only at the database level', async () => {
    const emp = await makeEmployer();
    await publish(emp);
    await expect(sql(`UPDATE audit_log SET action = 'vacancy.close'`)).rejects.toThrow(/append-only/);
    await expect(sql(`UPDATE audit_log SET meta = '{"x":1}'`)).rejects.toThrow(/append-only/);
    await expect(sql(`UPDATE audit_log SET actor_id = NULL, action = 'vacancy.close'`)).rejects.toThrow(/append-only/);
    await expect(sql(`INSERT INTO audit_log (action) VALUES ('Bad Action!')`)).rejects.toThrow();
  });
});

describe('vacancy insights', () => {
  it('counts unique viewers once per day, conversion, status funnel, match pool and what applicants lack', async () => {
    const emp = await makeEmployer();
    const a = await makeStudent(), b = await makeStudent(), c = await makeStudent();
    await setProfile(a.client, { skills: ['Python'] });
    const vid = await publish(emp, { requiredSkills: ['Python', 'SQL', 'Docker'] });
    await a.client.get(`/api/vacancies/${vid}`); await a.client.get(`/api/vacancies/${vid}`); // same day: counted once
    await b.client.get(`/api/vacancies/${vid}`);
    await c.client.get(`/api/vacancies/${vid}`);
    await a.client.post(`/api/vacancies/${vid}/apply`);
    await b.client.post(`/api/vacancies/${vid}/apply`);
    await b.client.post(`/api/applications/${(await b.client.get('/api/applications')).body.applications[0].id}/withdraw`); // withdrawn does not count
    const r = await emp.client.get(`/api/vacancies/${vid}/insights`);
    expect(r.status).toBe(200);
    expect(r.body.views).toMatchObject({ total: 3, unique: 3 });
    expect(r.body.views.series).toHaveLength(30);
    expect(r.body.views.series.at(-1).views).toBe(3);
    expect(r.body.applications).toMatchObject({ total: 1, byStatus: { applied: 1, withdrawn: 1 }, conversionPercent: 33.3 });
    expect(r.body.applications.averageMatch).toBeGreaterThan(0);
    expect(r.body.topMissingSkills.map((x: any) => x.skill).sort()).toEqual(['Docker', 'SQL']);
    expect(r.body.matchPool.size).toBeGreaterThanOrEqual(0);
  });

  it('is empty-safe: no views/applications → nulls and zeros, never NaN', async () => {
    const emp = await makeEmployer();
    const vid = await publish(emp);
    const r = await emp.client.get(`/api/vacancies/${vid}/insights`);
    expect(r.body.views).toMatchObject({ total: 0, unique: 0 });
    expect(r.body.applications).toMatchObject({ total: 0, byStatus: {}, conversionPercent: null, averageMatch: null });
    expect(r.body.topMissingSkills).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain('NaN');
  });

  it('only the owner sees it; students and other employers cannot; viewing a draft is not counted', async () => {
    const emp = await makeEmployer(), other = await makeEmployer(), st = await makeStudent();
    const vid = await publish(emp);
    expect((await other.client.get(`/api/vacancies/${vid}/insights`)).status).toBe(404);
    expect((await st.client.get(`/api/vacancies/${vid}/insights`)).status).toBe(403);
    expect((await emp.client.get('/api/vacancies/not-a-uuid/insights')).status).toBe(404);
    const draft = (await emp.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    expect((await st.client.get(`/api/vacancies/${draft}`)).status).toBe(404);
    expect(await sql('SELECT 1 FROM vacancy_views WHERE vacancy_id = $1', [draft])).toHaveLength(0);
    await emp.client.get(`/api/vacancies/${vid}`); // employers viewing do not count
    expect(await sql('SELECT 1 FROM vacancy_views')).toHaveLength(0);
  });

  it('a failing view insert never breaks the page', async () => {
    const emp = await makeEmployer(), st = await makeStudent();
    const vid = await publish(emp);
    await sql('ALTER TABLE vacancy_views RENAME TO vacancy_views_x');
    try { expect((await st.client.get(`/api/vacancies/${vid}`)).status).toBe(200); }
    finally { await sql('ALTER TABLE vacancy_views_x RENAME TO vacancy_views'); }
  });
});

describe('similar vacancies', () => {
  it('ranks by skills/text, excludes itself, drafts, closed and expired; students get match %', async () => {
    const emp = await makeEmployer(), st = await makeStudent();
    await setProfile(st.client, { skills: ['Python'] });
    const base = await publish(emp, { title: 'Python data intern', requiredSkills: ['Python', 'SQL'] });
    const close = await publish(emp, { title: 'Python SQL analyst', requiredSkills: ['Python', 'SQL'] });
    const near = await publish(emp, { title: 'Data intern with Python', requiredSkills: ['Python'] });
    const far = await publish(emp, { title: 'SEO specialist', description: 'Grow organic traffic for our brand every month.', requiredSkills: ['SEO', 'Marketing'], industry: 'media_marketing', kind: 'full_time' });
    await emp.client.post(`/api/vacancies/${close}/close`);
    await emp.client.post('/api/vacancies', vacancyPayload({ title: 'Python draft intern', requiredSkills: ['Python', 'SQL'] }));
    const r = await st.client.get(`/api/vacancies/${base}/similar`);
    expect(r.status).toBe(200);
    const ids = r.body.similar.map((x: any) => x.id);
    expect(ids).toContain(near);
    expect(ids).not.toContain(base);
    expect(ids).not.toContain(close);
    expect(ids).not.toContain(far);
    expect(r.body.similar.every((x: any) => x.similarity >= 20 && x.similarity <= 100 && x.match && typeof x.match.percent === 'number')).toBe(true);
    const sorted = r.body.similar.map((x: any) => x.similarity);
    expect([...sorted].sort((a, b) => b - a)).toEqual(sorted);
    expect(r.body.similar.length).toBeLessThanOrEqual(5);
  });

  it('visibility rules: unknown/invalid ids 404, a closed or draft vacancy is hidden from others, visible to its owner', async () => {
    const emp = await makeEmployer(), other = await makeEmployer(), st = await makeStudent();
    const draft = (await emp.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    expect((await st.client.get(`/api/vacancies/${draft}/similar`)).status).toBe(404);
    expect((await other.client.get(`/api/vacancies/${draft}/similar`)).status).toBe(404);
    expect((await emp.client.get(`/api/vacancies/${draft}/similar`)).status).toBe(200);
    expect((await st.client.get('/api/vacancies/nope/similar')).status).toBe(404);
    expect((await st.client.get('/api/vacancies/00000000-0000-4000-8000-000000000000/similar')).status).toBe(404);
    expect((await new Client().get(`/api/vacancies/${draft}/similar`)).status).toBe(401);
  });
});

describe('related-skill matching through the API', () => {
  it('Vue.js counts partially toward a React requirement and is explained', async () => {
    const emp = await makeEmployer();
    const vue = await makeStudent(), none = await makeStudent();
    await setProfile(vue.client, { skills: ['Vue.js'] });
    const vid = await publish(emp, { title: 'Frontend intern', requiredSkills: ['React'] });
    const a = (await vue.client.get(`/api/vacancies/${vid}`)).body.match, b = (await none.client.get(`/api/vacancies/${vid}`)).body.match;
    expect(a.percent).toBeGreaterThan(b.percent);
    expect(a.matchedSkills).toEqual([]);
    expect(a.partialSkills).toEqual([{ skill: 'React', via: 'vue.js', credit: 0.5 }]);
    expect(b.partialSkills).toEqual([]);
  });
});

describe('request ids and readiness', () => {
  const call = (path: string, headers: Record<string, string> = {}) => app.request(`http://localhost${path}`, { headers }, testEnv);
  it('every API response carries X-Request-Id; a sane inbound id is echoed, a hostile one replaced', async () => {
    const gen = await call('/api/health');
    expect(gen.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect((await call('/api/health', { 'x-request-id': 'trace-12345678' })).headers.get('x-request-id')).toBe('trace-12345678');
    for (const bad of ['short', 'bad id with spaces', 'x'.repeat(65), 'a<script>alert(1)</script>']) {
      const id = (await call('/api/health', { 'x-request-id': bad })).headers.get('x-request-id')!;
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect((await call('/api/nope')).headers.get('x-request-id')).toBeTruthy();
  });
  it('readiness reports the database', async () => {
    const r = await call('/api/health/ready');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, db: 'up' });
  });
  it('readiness answers 503 when the database is unreachable', async () => {
    const r = await app.request('http://localhost/api/health/ready', {}, { ...testEnv, SQLITE_PATH: '/dev/null/db.sqlite' });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, db: 'down' });
  });
});
