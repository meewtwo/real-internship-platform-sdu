import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { Client, gradIn, makeAdmin, makeDocx, makeEmployer, makePdf, makeStudent, resetDb, setProfile, sql, vacancyPayload, seedSkills } from './helpers';

beforeEach(async () => {
  await resetDb();
  await seedSkills('Python', 'SQL', 'JavaScript', 'React', 'Docker', 'Machine Learning', 'Java');
  await sql(`INSERT INTO courses (skill_key, title, provider, url) VALUES ('docker', 'Docker Get Started', 'Docker', 'https://docs.docker.com/get-started/') ON CONFLICT DO NOTHING`);
});
const err = (r: { body: any }) => r.body?.error;
const CV = ['Aigerim Nurlanova - Data Analyst', 'Software Engineer, Acme 2021 - 2023', 'Skills: Python, SQL, Docker, machine learning', '3 years of experience building analytics tools'];

describe('CV upload (US-4)', () => {
  it('PDF: parsed, skills + experience extracted, stored, downloadable, deletable', async () => {
    const { client } = await makeStudent();
    const r = await client.upload('/api/cv', makePdf(CV), 'my cv.pdf', 'application/pdf');
    expect(r.status).toBe(201);
    expect(r.body.cv.skills).toEqual(['Docker', 'Machine Learning', 'Python', 'SQL']);
    expect(r.body.cv.experienceYears).toBeGreaterThanOrEqual(3);
    expect(r.body.cv.filename).toBe('my cv.pdf');
    expect((await client.get('/api/cv')).body.cv.skills).toContain('Python');
    const d = await client.download('/api/cv/file');
    expect(d.status).toBe(200);
    expect(d.headers.get('content-type')).toBe('application/pdf');
    expect(d.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new TextDecoder().decode(d.bytes.slice(0, 5))).toBe('%PDF-');
    expect((await client.delete('/api/cv')).status).toBe(200);
    expect((await client.get('/api/cv')).body.cv).toBeNull();
    expect((await client.download('/api/cv/file')).status).toBe(404);
  });
  it('DOCX works and replaces the previous CV', async () => {
    const { client } = await makeStudent();
    await client.upload('/api/cv', makePdf(CV), 'a.pdf');
    const r = await client.upload('/api/cv', makeDocx(['Java developer', 'Skills: Java, JavaScript, React and a lot of other things']), 'b.docx');
    expect(r.status).toBe(201);
    expect(r.body.cv.skills).toEqual(['Java', 'JavaScript', 'React']);
    expect(await sql('SELECT 1 FROM cvs')).toHaveLength(1);
  });
  it.each([
    ['plain text renamed .pdf', () => strToU8('hello world, this is not a pdf at all, just text'), 'x.pdf', 'CV_TYPE_INVALID'],
    ['text file', () => strToU8('some text content that is long enough'), 'x.txt', 'CV_TYPE_INVALID'],
    ['exe renamed', () => strToU8('MZ\x90\x00 binary'), 'x.exe', 'CV_TYPE_INVALID'],
    ['PDF content with .docx name', () => makePdf(CV), 'x.docx', 'CV_TYPE_INVALID'],
    ['DOCX content with .pdf name', () => makeDocx(CV), 'x.pdf', 'CV_TYPE_INVALID'],
    ['zip that is not a docx', () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'x.docx', 'CV_UNREADABLE'],
    ['corrupt pdf', () => strToU8('%PDF-1.4\ngarbage'), 'x.pdf', 'CV_UNREADABLE'],
    ['pdf without text (scan)', () => makePdf(['']), 'x.pdf', 'CV_EMPTY_TEXT'],
    ['empty docx', () => makeDocx(['hi']), 'x.docx', 'CV_EMPTY_TEXT'],
  ])('rejects: %s', async (_n, bytes, name, code) => {
    const { client } = await makeStudent();
    const r = await client.upload('/api/cv', bytes(), name);
    expect(r.status).toBe(400);
    expect(err(r).code).toBe(code);
    expect(await sql('SELECT 1 FROM cvs')).toHaveLength(0);
  });
  it('size limit, missing file, wrong content-type, roles, CSRF', async () => {
    const { client } = await makeStudent();
    const big = makePdf(CV);
    const huge = new Uint8Array(2 * 1024 * 1024 + 10); huge.set(big);
    const tooBig = await client.upload('/api/cv', huge, 'big.pdf');
    expect(tooBig.status).toBe(413);
    expect(err(tooBig).code).toBe('CV_TOO_LARGE');
    expect(err(await client.upload('/api/cv', big, 'x.pdf', 'application/pdf', 'wrongfield')).code).toBe('CV_MISSING_FILE');
    expect(err(await client.json('POST', '/api/cv', { a: 1 })).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const fd = new FormData(); fd.append('file', new File([big as BlobPart], 'x.pdf'));
    expect(err(await client.raw('POST', '/api/cv', { body: fd })).code).toBe('CSRF_INVALID');
    expect(err(await new Client().upload('/api/cv', big, 'x.pdf')).code).toBe('UNAUTHORIZED');
    const emp = await makeEmployer();
    expect(err(await emp.client.upload('/api/cv', big, 'x.pdf')).code).toBe('FORBIDDEN');
    expect(err(await client.upload('/api/cv', big, '../../etc/passwd')).code).toBe('CV_TYPE_INVALID');
  });
  it('filename is sanitised (no path, no control chars)', async () => {
    const { client } = await makeStudent();
    const r = await client.upload('/api/cv', makePdf(CV), '..\\..\\evil\u0000"name".pdf');
    expect(r.status).toBe(201);
    expect(r.body.cv.filename).toBe('evilname.pdf');
  });
  it('apply-skills merges extracted skills into the profile (max 30)', async () => {
    const { client } = await makeStudent();
    await setProfile(client, { skills: ['Java'], interests: [] });
    await client.upload('/api/cv', makePdf(CV), 'a.pdf');
    const r = await client.post('/api/cv/apply-skills');
    expect(r.body.added).toEqual(['Docker', 'Machine Learning', 'Python', 'SQL']);
    expect((await client.get('/api/profile')).body.profile.skills).toEqual(['Docker', 'Java', 'Machine Learning', 'Python', 'SQL']);
    expect(err(await new Client().post('/api/cv/apply-skills')).code).toBe('UNAUTHORIZED');
  });
});

describe('vacancies (US-5)', () => {
  it('pending employers can draft but not publish; active ones can; drafts are private', async () => {
    const pending = await makeEmployer({ active: false });
    const created = await pending.client.post('/api/vacancies', vacancyPayload());
    expect(created.status).toBe(201);
    expect(created.body.vacancy.status).toBe('draft');
    const id = created.body.vacancy.id;
    const pub = await pending.client.post(`/api/vacancies/${id}/publish`);
    expect(pub.status).toBe(403);
    expect(err(pub).code).toBe('EMPLOYER_NOT_APPROVED');
    const { client: student } = await makeStudent();
    expect((await student.get(`/api/vacancies/${id}`)).status).toBe(404);
    expect((await student.get('/api/vacancies')).body.total).toBe(0);
    await sql(`UPDATE users SET status = 'active'`);
    await pending.client.post('/api/auth/logout');
    await pending.client.post('/api/auth/login', { role: 'employer', identifier: pending.payload.email, password: pending.payload.password });
    const ok = await pending.client.post(`/api/vacancies/${id}/publish`);
    expect(ok.status).toBe(200);
    expect(ok.body.vacancy.status).toBe('published');
    expect((await student.get('/api/vacancies')).body.total).toBe(1);
  });
  it('validation + mass assignment + role/ownership guards', async () => {
    const e = await makeEmployer();
    const bad = await e.client.post('/api/vacancies', vacancyPayload({ title: '<b>x</b>', requiredSkills: [], minGpa: '4.5', deadline: '2020-01-01' }));
    expect(err(bad).fields).toMatchObject({ title: 'VACANCY_TITLE_INVALID', requiredSkills: 'VACANCY_SKILLS_REQUIRED', minGpa: 'GPA_OUT_OF_RANGE', deadline: 'DEADLINE_PAST' });
    for (const extra of [{ status: 'published' }, { employerId: e.id }, { id: 'x' }, { publishedAt: '2020-01-01' }])
      expect(err(await e.client.post('/api/vacancies', { ...vacancyPayload(), ...extra })).code).toBe('UNKNOWN_FIELDS');
    const { client: student } = await makeStudent();
    expect(err(await student.post('/api/vacancies', vacancyPayload())).code).toBe('FORBIDDEN');
    expect(err(await new Client().post('/api/vacancies', vacancyPayload())).code).toBe('UNAUTHORIZED');
    const id = (await e.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    const other = await makeEmployer();
    expect((await other.client.put(`/api/vacancies/${id}`, vacancyPayload())).status).toBe(404);
    expect((await other.client.post(`/api/vacancies/${id}/publish`)).status).toBe(404);
    expect((await other.client.delete(`/api/vacancies/${id}`)).status).toBe(404);
    expect((await e.client.get('/api/vacancies/not-a-uuid')).status).toBe(404);
    const upd = await e.client.put(`/api/vacancies/${id}`, vacancyPayload({ title: 'Renamed Intern', requiredSkills: ['Docker', 'Python', 'python'] }));
    expect(upd.body.vacancy.title).toBe('Renamed Intern');
    expect(upd.body.vacancy.requiredSkills).toEqual(['Docker', 'Python']);
    const mine = await e.client.get('/api/vacancies/mine');
    expect(mine.body.vacancies).toHaveLength(1);
    expect(mine.body.vacancies[0].applicants).toBe(0);
  });
  it('close / delete rules; closed vacancies are read-only and not listed', async () => {
    const e = await makeEmployer();
    const id = (await e.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    expect(err(await e.client.post(`/api/vacancies/${id}/close`)).code).toBe('VACANCY_NOT_PUBLISHED');
    await e.client.post(`/api/vacancies/${id}/publish`);
    await e.client.post(`/api/vacancies/${id}/close`);
    expect(err(await e.client.put(`/api/vacancies/${id}`, vacancyPayload())).code).toBe('VACANCY_CLOSED');
    const { client: s } = await makeStudent();
    expect((await s.get('/api/vacancies')).body.total).toBe(0);
    expect((await e.client.delete(`/api/vacancies/${id}`)).status).toBe(200);
  });
  it('DB constraints hold for vacancies (direct SQL)', async () => {
    const e = await makeEmployer();
    const ins = (title: string, desc: string, kind: string, extra = '', status = 'draft') => sql(
      `INSERT INTO vacancies (employer_id, title, title_lc, description, description_lc, kind, industry_key, city_key, work_format, status ${extra ? ', published_at' : ''}) VALUES ($1, $2, lower($2), $3, lower($3), $4, 'it_software', 'almaty', 'remote', $5 ${extra ? ', NULL' : ''})`,
      [e.id, title, desc, kind, status]);
    const ok = 'x'.repeat(30);
    await expect(ins('ab', ok, 'internship')).rejects.toThrow(/vac_title_chk/);
    await expect(ins('Valid', 'short', 'internship')).rejects.toThrow(/vac_desc_chk/);
    await expect(ins('Valid', ok, 'slave')).rejects.toThrow(/vac_kind_chk/);
    await expect(ins('Valid', ok, 'internship', 'x', 'published')).rejects.toThrow(/vac_published_chk/);
    await expect(ins('Valid title', ok, 'internship')).resolves.toBeDefined();
  });
});

async function publish(e: Awaited<ReturnType<typeof makeEmployer>>, over: Record<string, unknown> = {}) {
  const id = (await e.client.post('/api/vacancies', vacancyPayload(over))).body.vacancy.id as string;
  const r = await e.client.post(`/api/vacancies/${id}/publish`);
  expect(r.status).toBe(200);
  return { id, matches: r.body.matches as number };
}

describe('search, filters and match % (US-6, US-7)', () => {
  it('students see match % + explanation, sorted by match; filters and keyword work', async () => {
    const e = await makeEmployer();
    const a = await publish(e, { title: 'Python SQL Analyst Intern' });
    const b = await publish(e, { title: 'React Frontend Intern', requiredSkills: ['React', 'JavaScript'], industry: 'media_marketing', kind: 'full_time', workFormat: 'remote', city: 'astana' });
    const { client: s } = await makeStudent();
    await setProfile(s, { skills: ['Python', 'SQL'], interests: [] });
    const list = (await s.get('/api/vacancies')).body;
    expect(list.total).toBe(2);
    expect(list.items[0].id).toBe(a.id);
    expect(list.items[0].match.percent).toBeGreaterThan(list.items[1].match.percent);
    expect(list.items[0].match.matchedSkills).toEqual(['Python', 'SQL']);
    expect(list.items[1].match.missingSkills).toEqual(['JavaScript', 'React']);
    expect((await s.get('/api/vacancies?q=react')).body.items.map((x: any) => x.id)).toEqual([b.id]);
    expect((await s.get('/api/vacancies?q=javascript')).body.total).toBe(1); // by skill name
    expect((await s.get('/api/vacancies?kind=full_time')).body.total).toBe(1);
    expect((await s.get('/api/vacancies?format=remote&industry=media_marketing')).body.total).toBe(1);
    expect((await s.get('/api/vacancies?city=astana')).body.total).toBe(1);
    expect((await s.get('/api/vacancies?sort=newest')).body.items[0].id).toBe(b.id);
    expect((await s.get('/api/vacancies?q=%25')).body.total).toBe(0); // LIKE wildcards escaped
    expect((await s.get(`/api/vacancies?q=${encodeURIComponent("'; DROP TABLE users;--")}`)).body.total).toBe(0);
    expect((await s.get('/api/vacancies?page=2')).body.items).toHaveLength(0);
    for (const bad of ['kind=x', 'sort=x', 'page=0', 'page=abc', `q=${'a'.repeat(61)}`, 'industry=x']) expect(err(await s.get(`/api/vacancies?${bad}`)).code).toBe('SEARCH_INVALID');
    const detail = (await s.get(`/api/vacancies/${a.id}`)).body;
    expect(detail.match.percent).toBe(list.items[0].match.percent);
    expect(detail.application).toBeNull();
    expect((await e.client.get('/api/vacancies')).body.items[0].match).toBeNull(); // employers: no student match
  });
  it('CV improves the match (skills + text)', async () => {
    const e = await makeEmployer();
    const v = await publish(e);
    const { client: s } = await makeStudent();
    await setProfile(s, { skills: [], interests: [] });
    const before = (await s.get(`/api/vacancies/${v.id}`)).body.match.percent;
    await s.upload('/api/cv', makePdf(CV), 'a.pdf');
    const after = (await s.get(`/api/vacancies/${v.id}`)).body.match.percent;
    expect(after).toBeGreaterThan(before);
  });
  it('expired deadline hides the vacancy from search and blocks applying', async () => {
    const e = await makeEmployer();
    const v = await publish(e, { deadline: gradIn(0) + '-28' });
    await sql(`UPDATE vacancies SET deadline = current_date - 1`);
    const { client: s } = await makeStudent();
    expect((await s.get('/api/vacancies')).body.total).toBe(0);
    expect(err(await s.post(`/api/vacancies/${v.id}/apply`, {})).code).toBe('VACANCY_CLOSED');
  });
});

describe('applications, ranking, status tracking and notifications (US-9, US-10, US-11)', () => {
  it('full life cycle', async () => {
    const e = await makeEmployer();
    const v = await publish(e);
    const strong = await makeStudent();
    await setProfile(strong.client, { skills: ['Python', 'SQL'], interests: [] });
    const weak = await makeStudent();
    await setProfile(weak.client, { skills: ['Java'], interests: [], relocation: 'no', city: 'astana' });
    // publishing notified the matching student only if above the threshold
    const sn = (await strong.client.get('/api/notifications')).body;
    void sn;
    const a1 = await strong.client.post(`/api/vacancies/${v.id}/apply`, { coverNote: 'Hello <b>team</b>' });
    expect(a1.status).toBe(201);
    const a2 = await weak.client.post(`/api/vacancies/${v.id}/apply`);
    expect(a2.status).toBe(201);
    expect(err(await strong.client.post(`/api/vacancies/${v.id}/apply`, {})).code).toBe('ALREADY_APPLIED');
    expect(err(await strong.client.post(`/api/vacancies/${v.id}/apply`, { coverNote: 'x'.repeat(1001) })).fields.coverNote).toBe('COVER_NOTE_TOO_LONG');
    expect(err(await strong.client.post(`/api/vacancies/${v.id}/apply`, { status: 'accepted' })).code).toBe('UNKNOWN_FIELDS');
    // employer: ranked by match %, with explanation
    const ranked = (await e.client.get(`/api/vacancies/${v.id}/applicants`)).body.applicants;
    expect(ranked).toHaveLength(2);
    expect(ranked[0].id).toBe(a1.body.application.id);
    expect(ranked[0].matchPercent).toBeGreaterThan(ranked[1].matchPercent);
    expect(ranked[0].matchedSkills).toEqual(['Python', 'SQL']);
    expect(ranked[1].missingSkills).toEqual(['Python', 'SQL']);
    expect(ranked[0].coverNote).toBe('Hello <b>team</b>'); // stored raw, escaped on render
    const all = (await e.client.get('/api/applications/employer')).body.applicants;
    expect(all.map((x: any) => x.id)).toEqual(ranked.map((x: any) => x.id));
    expect((await e.client.get('/api/vacancies/mine')).body.vacancies[0].applicants).toBe(2);
    // employer notified
    const en = (await e.client.get('/api/notifications')).body;
    expect(en.unread).toBe(2);
    expect(en.items[0]).toMatchObject({ kind: 'new_application', link: `/vacancies/${v.id}/applicants`, read: false });
    expect(en.items[0].params.percent).toBeGreaterThan(0);
    // status changes
    const id1 = a1.body.application.id;
    expect(err(await strong.client.patch(`/api/applications/${id1}/status`, { status: 'accepted' })).code).toBe('FORBIDDEN');
    expect(err(await e.client.patch(`/api/applications/${id1}/status`, { status: 'applied' })).fields.status).toBe('STATUS_INVALID');
    expect(err(await e.client.patch(`/api/applications/${id1}/status`, { status: 'shortlisted', x: 1 })).code).toBe('UNKNOWN_FIELDS');
    const other = await makeEmployer();
    expect((await other.client.patch(`/api/applications/${id1}/status`, { status: 'shortlisted' })).status).toBe(404);
    expect((await e.client.patch(`/api/applications/${id1}/status`, { status: 'shortlisted' })).status).toBe(200);
    expect((await e.client.patch(`/api/applications/${id1}/status`, { status: 'interview' })).status).toBe(200);
    const mine = (await strong.client.get('/api/applications')).body.applications;
    expect(mine[0].status).toBe('interview');
    expect(mine[0].events.map((x: any) => x.status)).toEqual(['applied', 'shortlisted', 'interview']);
    const sn2 = (await strong.client.get('/api/notifications')).body;
    expect(sn2.items.filter((n: any) => n.kind === 'status_changed').map((n: any) => n.params.status)).toEqual(['interview', 'shortlisted']);
    // read handling is per user
    const nid = sn2.items[0].id;
    expect((await weak.client.post(`/api/notifications/${nid}/read`)).status).toBe(404);
    expect((await strong.client.post(`/api/notifications/${nid}/read`)).status).toBe(200);
    expect((await strong.client.get('/api/notifications/count')).body.unread).toBe(sn2.unread - 1);
    await strong.client.post('/api/notifications/read-all');
    expect((await strong.client.get('/api/notifications/count')).body.unread).toBe(0);
    // withdraw → employer can't change it, student may re-apply
    expect((await weak.client.post(`/api/applications/${a2.body.application.id}/withdraw`)).status).toBe(200);
    expect(err(await e.client.patch(`/api/applications/${a2.body.application.id}/status`, { status: 'viewed' })).code).toBe('INVALID_TRANSITION');
    expect((await e.client.get(`/api/vacancies/${v.id}/applicants`)).body.applicants).toHaveLength(1);
    expect((await weak.client.post(`/api/vacancies/${v.id}/apply`, {})).status).toBe(201);
    // a vacancy with applications cannot be deleted
    expect(err(await e.client.delete(`/api/vacancies/${v.id}`)).code).toBe('VACANCY_HAS_APPLICATIONS');
    // closed vacancy: no new applications
    await e.client.post(`/api/vacancies/${v.id}/close`);
    const late = await makeStudent();
    expect(err(await late.client.post(`/api/vacancies/${v.id}/apply`, {})).code).toBe('VACANCY_CLOSED');
  });
  it('parallel applications by the same student create exactly one', async () => {
    const e = await makeEmployer();
    const v = await publish(e);
    const { client } = await makeStudent();
    const rs = await Promise.all(Array.from({ length: 6 }, () => client.post(`/api/vacancies/${v.id}/apply`, {})));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await sql('SELECT 1 FROM applications')).toHaveLength(1);
    expect(await sql(`SELECT 1 FROM notifications WHERE kind = 'new_application'`)).toHaveLength(1);
  });
  it('CV access: owner employer and the student only; never after withdrawal', async () => {
    const e = await makeEmployer();
    const v = await publish(e);
    const s = await makeStudent();
    await s.client.upload('/api/cv', makePdf(CV), 'a.pdf');
    const app = (await s.client.post(`/api/vacancies/${v.id}/apply`, {})).body.application.id;
    expect((await e.client.download(`/api/applications/${app}/cv`)).status).toBe(200);
    expect((await s.client.download(`/api/applications/${app}/cv`)).status).toBe(200);
    const other = await makeEmployer();
    expect((await other.client.download(`/api/applications/${app}/cv`)).status).toBe(404);
    const stranger = await makeStudent();
    expect((await stranger.client.download(`/api/applications/${app}/cv`)).status).toBe(404);
    expect((await new Client().download(`/api/applications/${app}/cv`)).status).toBe(401);
    await s.client.post(`/api/applications/${app}/withdraw`);
    expect((await e.client.download(`/api/applications/${app}/cv`)).status).toBe(404);
  });
  it('publishing notifies matching students (new_match) and stores matches', async () => {
    const s = await makeStudent();
    await setProfile(s.client, { skills: ['Python', 'SQL'], interests: [] });
    const lo = await makeStudent();
    await setProfile(lo.client, { skills: [], interests: [], interestArea: 'law', relocation: 'remote' });
    const e = await makeEmployer();
    const v = await publish(e, { title: 'Python SQL Analyst Intern' });
    expect(v.matches).toBeGreaterThanOrEqual(1);
    const n = (await s.client.get('/api/notifications')).body.items.filter((x: any) => x.kind === 'new_match');
    expect(n).toHaveLength(1);
    expect(n[0].link).toBe(`/vacancies/${v.id}`);
    expect((await lo.client.get('/api/notifications')).body.items.filter((x: any) => x.kind === 'new_match')).toHaveLength(0);
    expect(await sql('SELECT 1 FROM matches WHERE vacancy_id = $1', [v.id])).toHaveLength(v.matches);
  });
});

describe('recommendations and skill gaps (US-8)', () => {
  it('top matches (excluding applied) + gaps with courses (catalogue or search fallback)', async () => {
    const e = await makeEmployer();
    const v1 = await publish(e, { title: 'Docker DevOps Intern', requiredSkills: ['Docker', 'Python'] });
    await publish(e, { title: 'Machine Learning Intern', requiredSkills: ['Machine Learning', 'Python'] });
    const { client: s } = await makeStudent();
    await setProfile(s, { skills: ['Python'], interests: [] });
    const r = (await s.get('/api/recommendations')).body;
    expect(r.recommendations).toHaveLength(2);
    expect(r.recommendations[0].match.percent).toBeGreaterThanOrEqual(r.recommendations[1].match.percent);
    const docker = r.gaps.find((g: any) => g.skill === 'Docker');
    expect(docker.courses[0]).toMatchObject({ provider: 'Docker', url: 'https://docs.docker.com/get-started/' });
    const ml = r.gaps.find((g: any) => g.skill === 'Machine Learning');
    expect(ml.courses[0].url).toMatch(/^https:\/\//);
    await s.post(`/api/vacancies/${v1.id}/apply`, {});
    expect((await s.get('/api/recommendations')).body.recommendations).toHaveLength(1);
    expect(err(await e.client.get('/api/recommendations')).code).toBe('FORBIDDEN');
  });
});

describe('admin: approvals and analytics (US-12)', () => {
  it('approving an employer notifies it; analytics aggregates real data; non-admins refused', async () => {
    const admin = await makeAdmin();
    const pend = await makeEmployer({ active: false });
    expect((await pend.client.get('/api/admin/analytics')).status).toBe(403);
    expect((await new Client().get('/api/admin/analytics')).status).toBe(401);
    expect((await admin.get('/api/admin/employers?status=pending')).body.employers).toHaveLength(1);
    expect((await admin.post(`/api/admin/employers/${pend.id}/approve`)).status).toBe(200);
    expect((await pend.client.get('/api/notifications')).body.items.map((n: any) => n.kind)).toContain('employer_approved');
    const e = await makeEmployer();
    const v = await publish(e);
    const s = await makeStudent();
    await setProfile(s.client, { skills: ['Python', 'SQL'], interests: [] });
    await s.client.post(`/api/vacancies/${v.id}/apply`, {});
    const a = (await admin.get('/api/admin/analytics')).body;
    expect(a.users.students).toBe(1);
    expect(a.users.employersActive).toBeGreaterThanOrEqual(2);
    expect(a.vacancies.published).toBe(1);
    expect(a.applications.total).toBe(1);
    expect(a.series).toHaveLength(30);
    expect(a.series.at(-1).applications).toBe(1);
    expect(a.topSkillsWanted.map((x: any) => x.name)).toEqual(['Python', 'SQL']);
    expect(a.topSkillsHeld.map((x: any) => x.name)).toEqual(['Python', 'SQL']);
    expect(a.funnel).toEqual([{ status: 'applied', n: 1 }]);
    expect(a.matches.total).toBeGreaterThanOrEqual(0);
  });
});

describe('scale', () => {
  it('publishing a vacancy matches 1500 students in bulk within a few seconds', async () => {
    await sql(`INSERT INTO users (role, student_id, email, phone, password_hash, status)
      SELECT 'student', printf('%09d', 400000000 + n), 'bulk' || n || '@sdu.edu.kz', '+7700' || printf('%07d', n), 'x', 'active' FROM (WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 1500) SELECT n FROM g)`);
    await sql(`INSERT INTO student_profiles (user_id, name, surname, city_key, major_key, year_of_study, gpa, graduation_date, interest_area, relocation)
      SELECT id, 'Bulk', 'Student', 'almaty', 'computer_science', '3', '3.50', '2029-06-01', 'data_ai', 'yes' FROM users WHERE email LIKE 'bulk%'`);
    await sql(`INSERT INTO student_skills (user_id, skill_id) SELECT u.id, s.id FROM users u, skills s WHERE u.email LIKE 'bulk%' AND s.name IN ('Python', 'SQL')`);
    const e = await makeEmployer();
    const id = (await e.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    const t0 = Date.now();
    const r = await e.client.post(`/api/vacancies/${id}/publish`);
    const ms = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(r.body.matches).toBe(1500);
    expect(await sql(`SELECT 1 FROM notifications WHERE kind = 'new_match'`)).toHaveLength(300); // capped
    expect(ms).toBeLessThan(5000);
  });
});

describe('salary, favourites, what-if, invitations, public home', () => {
  it('salary is validated, shown, filterable and sortable', async () => {
    const e = await makeEmployer();
    expect(err(await e.client.post('/api/vacancies', vacancyPayload({ salaryMin: 500000, salaryMax: 300000 }))).fields.salaryMax).toBe('SALARY_RANGE_INVALID');
    expect(err(await e.client.post('/api/vacancies', vacancyPayload({ salaryMin: -1 }))).fields.salaryMin).toBe('SALARY_INVALID');
    expect(err(await e.client.post('/api/vacancies', vacancyPayload({ salaryMax: '1e6' }))).fields.salaryMax).toBe('SALARY_INVALID');
    const a = await publish(e, { title: 'Paid Python Intern', salaryMin: 250000, salaryMax: 400000 });
    const b = await publish(e, { title: 'Unpaid Style Intern', requiredSkills: ['Java'] });
    const c = await publish(e, { title: 'Rich Python Role', salaryMin: 900000 });
    const { client: s } = await makeStudent();
    const all = (await s.get('/api/vacancies?sort=salary')).body.items;
    expect(all.map((x: any) => x.id)).toEqual([c.id, a.id, b.id].sort((x, y) => (x === c.id ? -1 : y === c.id ? 1 : x === a.id ? -1 : 1)));
    expect(all[1]).toMatchObject({ salaryMin: 250000, salaryMax: 400000 });
    expect((await s.get('/api/vacancies?withSalary=1')).body.total).toBe(2);
    expect((await s.get('/api/vacancies?salaryFrom=500000')).body.items.map((x: any) => x.id)).toEqual([c.id]);
    expect(err(await s.get('/api/vacancies?salaryFrom=abc')).code).toBe('SEARCH_INVALID');
    expect(err(await s.get('/api/vacancies?withSalary=2')).code).toBe('SEARCH_INVALID');
    await expect(sql(`UPDATE vacancies SET salary_min = 5, salary_max = 3 WHERE id = $1`, [a.id])).rejects.toThrow(/vac_salary_chk/);
    void b;
  });
  it('favourites: toggle, list, flags, only published, isolated per user', async () => {
    const e = await makeEmployer();
    const v = await publish(e);
    const draft = (await e.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    const s = await makeStudent(), other = await makeStudent();
    expect((await s.client.put(`/api/favorites/${v.id}`)).body.favorite).toBe(true);
    expect((await s.client.put(`/api/favorites/${v.id}`)).status).toBe(200); // idempotent
    expect((await s.client.put(`/api/favorites/${draft}`)).status).toBe(404);
    expect((await s.client.put('/api/favorites/not-a-uuid')).status).toBe(404);
    expect((await s.client.get('/api/favorites')).body.items.map((x: any) => x.id)).toEqual([v.id]);
    expect((await s.client.get('/api/vacancies')).body.items[0].favorite).toBe(true);
    expect((await s.client.get(`/api/vacancies/${v.id}`)).body.favorite).toBe(true);
    expect((await other.client.get('/api/favorites')).body.items).toHaveLength(0);
    expect(err(await e.client.put(`/api/favorites/${v.id}`)).code).toBe('FORBIDDEN');
    expect((await s.client.delete(`/api/favorites/${v.id}`)).body.favorite).toBe(false);
    expect((await s.client.get('/api/favorites')).body.items).toHaveLength(0);
  });
  it('what-if: learning a missing skill raises the match; all skills → max', async () => {
    const e = await makeEmployer();
    const v = await publish(e, { requiredSkills: ['Python', 'SQL', 'Docker'] });
    const { client: s } = await makeStudent();
    await setProfile(s, { skills: ['Python'], interests: [] });
    const r = (await s.get(`/api/vacancies/${v.id}/whatif`)).body;
    expect(r.options.map((o: any) => o.skill).sort()).toEqual(['Docker', 'SQL']);
    for (const o of r.options) { expect(o.delta).toBeGreaterThan(0); expect(o.percent).toBe(r.current + o.delta); }
    expect(r.all).toBeGreaterThan(Math.max(...r.options.map((o: any) => o.percent)) - 1);
    expect((await e.client.get(`/api/vacancies/${v.id}/whatif`)).status).toBe(403);
    expect((await s.get('/api/vacancies/00000000-0000-0000-0000-000000000000/whatif')).status).toBe(404);
  });
  it('talent pool + invitations: ranked, excludes applicants, one invite per student, notification, ownership', async () => {
    const strong = await makeStudent(); await setProfile(strong.client, { skills: ['Python', 'SQL'], interests: [] });
    const applied = await makeStudent(); await setProfile(applied.client, { skills: ['Python', 'SQL'], interests: [] });
    const e = await makeEmployer();
    const v = await publish(e, { title: 'Python SQL Analyst Intern' });
    await applied.client.post(`/api/vacancies/${v.id}/apply`, {});
    const t = (await e.client.get(`/api/vacancies/${v.id}/talent`)).body.candidates;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ matchedSkills: ['Python', 'SQL'], invited: false });
    const sid = t[0].studentId;
    expect((await e.client.post(`/api/vacancies/${v.id}/invite`, { studentId: sid })).status).toBe(201);
    expect(err(await e.client.post(`/api/vacancies/${v.id}/invite`, { studentId: sid })).code).toBe('ALREADY_INVITED');
    expect((await e.client.get(`/api/vacancies/${v.id}/talent`)).body.candidates[0].invited).toBe(true);
    const n = (await strong.client.get('/api/notifications')).body.items.find((x: any) => x.kind === 'invitation');
    expect(n.params).toMatchObject({ title: 'Python SQL Analyst Intern' });
    expect(err(await e.client.post(`/api/vacancies/${v.id}/invite`, { studentId: 'nope' })).code).toBe('VALIDATION_FAILED');
    expect(err(await e.client.post(`/api/vacancies/${v.id}/invite`, { studentId: sid, x: 1 })).code).toBe('UNKNOWN_FIELDS');
    const other = await makeEmployer();
    expect((await other.client.get(`/api/vacancies/${v.id}/talent`)).status).toBe(404);
    expect((await other.client.post(`/api/vacancies/${v.id}/invite`, { studentId: sid })).status).toBe(404);
    expect((await strong.client.post(`/api/vacancies/${v.id}/invite`, { studentId: sid })).status).toBe(403);
  });
  it('public home needs no login and exposes no personal data', async () => {
    const e = await makeEmployer();
    await publish(e, { salaryMin: 200000 });
    await makeStudent();
    const r = await new Client().get('/api/public/home');
    expect(r.status).toBe(200);
    expect(r.body.stats).toMatchObject({ vacancies: 1, employers: 1, students: 1 });
    expect(r.body.vacancies[0]).toMatchObject({ salaryMin: 200000 });
    expect(JSON.stringify(r.body)).not.toMatch(/@|phone|password|studentId/i);
  });
});

const TRANSCRIPT = `2025 Fall   CSC 210   Database Systems   6   A
2025 Fall   CSC 230   Web Programming   6   A-
2026 Spring CSC 310   Machine Learning   6   B+`;
describe('SDU portal résumé import', () => {
  it('demo import builds a résumé from courses, infers skills, applies them, improves matching', async () => {
    const e = await makeEmployer();
    const v = await publish(e, { requiredSkills: ['SQL', 'Machine Learning'], title: 'Data Intern' });
    const { client: s } = await makeStudent();
    await setProfile(s, { skills: [], interests: [] });
    const before = (await s.get(`/api/vacancies/${v.id}`)).body.match.percent;
    expect((await s.get('/api/resume')).body.resume).toBeNull();
    const r = await s.post('/api/resume/demo');
    expect(r.status).toBe(201);
    expect(r.body.resume.source).toBe('portal_demo');
    expect(r.body.resume.courses.length).toBeGreaterThanOrEqual(8);
    expect(r.body.resume.gpa).toBeGreaterThan(3);
    expect(r.body.resume.about).toContain('courses');
    expect(r.body.resume.inferredSkills).toEqual(expect.arrayContaining(['SQL', 'Machine Learning']));
    expect((await s.get(`/api/vacancies/${v.id}`)).body.match.percent).toBeGreaterThan(before); // résumé text counts
    const ap = await s.post('/api/resume/apply-skills');
    expect(ap.body.added).toEqual(expect.arrayContaining(['SQL', 'Machine Learning']));
    expect((await s.get('/api/profile')).body.profile.skills).toEqual(expect.arrayContaining(['SQL']));
    expect((await s.get(`/api/vacancies/${v.id}`)).body.match.matchedSkills).toEqual(['Machine Learning', 'SQL']);
  });
  it('transcript text import: parsed, validated, size/type/role guarded', async () => {
    const { client: s } = await makeStudent();
    const ok = await s.post('/api/resume/import', { text: TRANSCRIPT });
    expect(ok.status).toBe(201);
    expect(ok.body.resume).toMatchObject({ source: 'portal_transcript' });
    expect(ok.body.resume.courses.map((c: any) => c.code)).toEqual(['CSC 210', 'CSC 230', 'CSC 310']);
    expect(err(await s.post('/api/resume/import', { text: 'hello world nothing here' })).code).toBe('TRANSCRIPT_INVALID');
    expect(err(await s.post('/api/resume/import', { text: '   ' })).code).toBe('TRANSCRIPT_EMPTY');
    expect(err(await s.post('/api/resume/import', { text: TRANSCRIPT, role: 'admin' })).code).toBe('UNKNOWN_FIELDS');
    expect((await s.post('/api/resume/import', { text: `<script>alert(1)</script>\n${TRANSCRIPT}` })).status).toBe(201); // junk lines are ignored
    const pdf = await s.upload('/api/resume/import', makePdf(TRANSCRIPT.split('\n')), 't.pdf', 'application/pdf');
    expect(pdf.status).toBe(201);
    expect((await s.upload('/api/resume/import', 'x', 'bad.exe')).body.error.code).toBe('CV_TYPE_INVALID');
    expect((await s.upload('/api/resume/import', new Uint8Array(0), 't.txt')).body.error.code).toBe('TRANSCRIPT_EMPTY');
    const txt = await s.upload('/api/resume/import', TRANSCRIPT, 't.txt', 'text/plain');
    expect(txt.status).toBe(201);
    const emp = await makeEmployer();
    expect(err(await emp.client.post('/api/resume/demo')).code).toBe('FORBIDDEN');
    expect(err(await new Client().get('/api/resume')).code).toBe('UNAUTHORIZED');
  });
  it('edit about, delete; XSS-looking text is stored as plain text', async () => {
    const { client: s } = await makeStudent();
    expect(err(await s.put('/api/resume', { about: 'x' })).code).toBe('RESUME_NOT_FOUND');
    await s.post('/api/resume/demo');
    expect((await s.put('/api/resume', { about: 'Hello <img src=x onerror=alert(1)> team' })).body.resume.about).toBe('Hello <img src=x onerror=alert(1)> team');
    expect(err(await s.put('/api/resume', { about: 'x'.repeat(1001) })).fields.about).toBe('RESUME_ABOUT_TOO_LONG');
    expect(err(await s.put('/api/resume', { about: '  ' })).fields.about).toBe('REQUIRED');
    expect(err(await s.put('/api/resume', { about: 'ok', courses: [] })).code).toBe('UNKNOWN_FIELDS');
    expect((await s.delete('/api/resume')).status).toBe(200);
    expect((await s.get('/api/resume')).body.resume).toBeNull();
  });
});
