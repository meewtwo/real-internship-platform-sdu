import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { INDUSTRY_KEYS, skillKey } from '@sdu/shared';
import { Client, makeAdmin, makeEmployer, makeStudent, resetDb, seedSkills, setProfile, sql, vacancyPayload } from './helpers';

// resetDb() wipes `skills`, which cascades to `industry_skills`: re-run the data part of migration 0004 (everything after its CREATE INDEX)
const SEED_0004 = readFileSync(fileURLToPath(new URL('../../database/d1/0004_industry_skills.sql', import.meta.url)), 'utf8')
  .split('CREATE INDEX industry_skills_order_idx ON industry_skills (industry_key, sort_order);')[1]
  .split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);

beforeEach(async () => {
  await resetDb();
  await seedSkills('Python', 'SQL');
  for (const stmt of SEED_0004) await sql(stmt);
});
const err = (r: { body: any }) => r.body?.error;
const ids = (r: { body: any }) => (r.body.items as { id: string }[]).map((x) => x.id);
const todayAlmaty = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const shiftDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

async function published(e: { client: Client }, over: Record<string, unknown> = {}) {
  const v = (await e.client.post('/api/vacancies', vacancyPayload(over))).body.vacancy;
  const p = await e.client.post(`/api/vacancies/${v.id}/publish`);
  expect(p.status).toBe(200);
  return v.id as string;
}

describe('Issue 6: skills suggested for the selected industry', () => {
  it('returns relevant skills per industry, in order, and the general set for "Other" / no industry', async () => {
    const { client } = await makeEmployer();
    const it = (await client.get('/api/profile/skills/suggested?industry=it_software')).body;
    expect(it.industry).toBe('it_software');
    expect(it.skills).toEqual(expect.arrayContaining(['JavaScript', 'Python', 'SQL', 'Git', 'REST API', 'Docker']));
    expect(it.skills[0]).toBe('JavaScript');
    const fin = (await client.get('/api/profile/skills/suggested?industry=finance_banking')).body.skills;
    expect(fin).toEqual(expect.arrayContaining(['Excel', 'Financial Analysis', 'Accounting', 'Risk Management', 'SQL']));
    for (const q of ['other', '']) {
      const r = (await client.get(`/api/profile/skills/suggested?industry=${q}`)).body;
      expect(r.industry).toBe('general');
      expect(r.skills).toContain('Communication');
    }
    expect((await client.get('/api/profile/skills/suggested')).body.industry).toBe('general');
  });

  it('every industry has 8–15 suggestions, all taken from the shared skills vocabulary', async () => {
    const { client } = await makeEmployer();
    for (const k of INDUSTRY_KEYS.filter((x) => x !== 'other')) {
      const skills = (await client.get(`/api/profile/skills/suggested?industry=${k}`)).body.skills as string[];
      expect(skills.length, k).toBeGreaterThanOrEqual(8);
      expect(skills.length, k).toBeLessThanOrEqual(15);
      expect(new Set(skills.map(skillKey)).size, k).toBe(skills.length);
      const vocab = await sql<{ name: string }>('SELECT name FROM skills WHERE name_key IN (SELECT value FROM json_each($1))', [JSON.stringify(skills.map(skillKey))]);
      expect(vocab.map((r) => r.name).sort(), k).toEqual([...skills].sort());
    }
  });

  it('rejects unknown industries and anonymous callers', async () => {
    const { client } = await makeEmployer();
    expect((await client.get('/api/profile/skills/suggested?industry=space')).status).toBe(400);
    expect((await new Client().get('/api/profile/skills/suggested?industry=it_software')).status).toBe(401);
  });

  it('a suggested skill is spelled like the student\'s skill, so it matches', async () => {
    const s = await makeStudent();
    await setProfile(s.client, { skills: ['risk management'] }); // typed in lower case → stored with the vocabulary spelling
    expect((await s.client.get('/api/profile')).body.profile.skills).toContain('Risk Management');
    const e = await makeEmployer();
    const id = await published(e, { industry: 'finance_banking', requiredSkills: ['Risk Management', 'Excel'] });
    const d = (await s.client.get(`/api/vacancies/${id}`)).body;
    expect(d.match.matchedSkills).toContain('Risk Management');
  });
});

describe('Issue 7: résumé builder writes to the database', () => {
  it('repeated saves update the same row; other students cannot read or change it', async () => {
    const a = await makeStudent(), b = await makeStudent();
    const doc = (await a.client.post('/api/resume-docs', { title: 'My CV', from: 'profile' })).body.doc;
    let v = doc.version;
    for (const summary of ['First save of the summary.', 'Second save of the summary.']) {
      const r = await a.client.put(`/api/resume-docs/${doc.id}`, { baseVersion: v, data: { ...doc.data, summary } });
      expect(r.status).toBe(200);
      v = r.body.doc.version;
    }
    const rows = await sql('SELECT version, json_extract(data, \'$.summary\') AS summary FROM resume_docs WHERE user_id = (SELECT id FROM users WHERE student_id = $1)', [a.payload.studentId]);
    expect(rows).toEqual([{ version: 3, summary: 'Second save of the summary.' }]);
    // a fresh session (another browser / device) reads the same data from the database
    const again = (await a.client.get(`/api/resume-docs/${doc.id}`)).body.doc;
    expect(again.data.summary).toBe('Second save of the summary.');
    expect((await b.client.get(`/api/resume-docs/${doc.id}`)).status).toBe(404);
    expect((await b.client.put(`/api/resume-docs/${doc.id}`, { baseVersion: v, title: 'Hacked' })).status).toBe(404);
    expect((await sql('SELECT title FROM resume_docs WHERE id = $1', [doc.id]))[0].title).toBe('My CV');
  });

  it('a stale or invalid save is refused (the UI then shows an error, not "saved")', async () => {
    const a = await makeStudent();
    const doc = (await a.client.post('/api/resume-docs', { title: 'My CV' })).body.doc;
    expect((await a.client.put(`/api/resume-docs/${doc.id}`, { baseVersion: doc.version, data: { ...doc.data, summary: 'x'.repeat(601) } })).status).toBe(400);
    expect((await a.client.put(`/api/resume-docs/${doc.id}`, { baseVersion: doc.version, title: 'A' })).status).toBe(200);
    expect(err(await a.client.put(`/api/resume-docs/${doc.id}`, { baseVersion: doc.version, title: 'B' })).code).toBe('RESUME_CONFLICT');
  });
});

describe('Issue 8: newly published vacancies of approved companies are visible to students', () => {
  it('a draft is hidden; after publish it is in the list, search, filters and detail', async () => {
    const e = await makeEmployer();
    const s = await makeStudent();
    const draft = (await e.client.post('/api/vacancies', vacancyPayload({ title: 'Brand new QA tester', industry: 'finance_banking', city: 'astana' }))).body.vacancy;
    expect(ids(await s.client.get('/api/vacancies'))).not.toContain(draft.id);
    expect((await s.client.get(`/api/vacancies/${draft.id}`)).status).toBe(404);
    expect((await e.client.post(`/api/vacancies/${draft.id}/publish`)).status).toBe(200);
    expect(ids(await s.client.get('/api/vacancies'))).toContain(draft.id);
    expect(ids(await s.client.get('/api/vacancies?q=qa%20tester'))).toEqual([draft.id]);
    expect(ids(await s.client.get('/api/vacancies?industry=finance_banking&city=astana&kind=internship&format=onsite'))).toEqual([draft.id]);
    expect(ids(await s.client.get('/api/vacancies?industry=it_software'))).not.toContain(draft.id);
    expect((await s.client.get(`/api/vacancies/${draft.id}`)).status).toBe(200);
    expect((await s.client.get('/api/recommendations')).body.recommendations.map((x: any) => x.id)).toContain(draft.id);
  });

  it('the deadline day is still open; a past deadline hides the vacancy', async () => {
    const e = await makeEmployer();
    const s = await makeStudent();
    const id = await published(e, { title: 'Deadline today vacancy' });
    await sql('UPDATE vacancies SET deadline = $2 WHERE id = $1', [id, todayAlmaty()]);
    expect(ids(await s.client.get('/api/vacancies'))).toContain(id);
    await sql('UPDATE vacancies SET deadline = $2 WHERE id = $1', [id, shiftDays(todayAlmaty(), -1)]);
    expect(ids(await s.client.get('/api/vacancies'))).not.toContain(id);
    expect((await e.client.get('/api/vacancies/mine')).body.vacancies[0].expired).toBe(true);
  });

  it('vacancies of a company that is no longer approved are hidden everywhere students look (API-enforced)', async () => {
    const e = await makeEmployer();
    const s = await makeStudent();
    const id = await published(e, { title: 'Vacancy of a rejected company' });
    expect(ids(await s.client.get('/api/vacancies'))).toContain(id);
    await sql(`UPDATE employer_profiles SET review_status = 'rejected' WHERE user_id = $1`, [e.id]);
    expect(ids(await s.client.get('/api/vacancies'))).not.toContain(id);
    expect((await s.client.get(`/api/vacancies/${id}`)).status).toBe(404);
    expect((await s.client.post(`/api/vacancies/${id}/apply`)).status).toBe(404);
    expect((await s.client.put(`/api/favorites/${id}`)).status).toBe(404);
    expect((await new Client().get('/api/public/home')).body.vacancies.map((v: any) => v.id)).not.toContain(id);
    // the owner still sees it on "My vacancies"
    expect((await e.client.get('/api/vacancies/mine')).body.vacancies.map((v: any) => v.id)).toContain(id);
  });

  it('publishing a closed vacancy is refused instead of pretending to succeed', async () => {
    const e = await makeEmployer();
    const id = await published(e);
    expect((await e.client.post(`/api/vacancies/${id}/close`)).status).toBe(200);
    expect(err(await e.client.post(`/api/vacancies/${id}/publish`)).code).toBe('VACANCY_CLOSED');
    expect((await sql('SELECT status FROM vacancies WHERE id = $1', [id]))[0].status).toBe('closed');
  });
});

describe('Issue 9: admin sees every vacancy of a company', () => {
  async function companyWithVacancies() {
    const e = await makeEmployer();
    const draft = (await e.client.post('/api/vacancies', vacancyPayload({ title: 'Draft vacancy' }))).body.vacancy.id as string;
    const live = await published(e, { title: 'Live vacancy' });
    const closed = await published(e, { title: 'Closed vacancy' });
    await e.client.post(`/api/vacancies/${closed}/close`);
    const expired = await published(e, { title: 'Expired vacancy' });
    await sql('UPDATE vacancies SET deadline = $2 WHERE id = $1', [expired, shiftDays(todayAlmaty(), -3)]);
    return { e, draft, live, closed, expired };
  }

  it('company details list all vacancies incl. drafts, with counts, status filter, sorting and applicants', async () => {
    const { e, draft, live, closed, expired } = await companyWithVacancies();
    const s = await makeStudent();
    await s.client.post(`/api/vacancies/${live}/apply`);
    const admin = await makeAdmin();
    const r = (await admin.get(`/api/admin/employers/${e.id}`)).body;
    expect(r.company).toMatchObject({ id: e.id, reviewStatus: 'approved', vacancyCount: 4, publishedCount: 2 }); // live + expired (the closed one is not published)
    expect(r.counts).toEqual({ all: 4, draft: 1, published: 1, closed: 1, expired: 1 });
    expect(r.vacancies.map((v: any) => v.id).sort()).toEqual([draft, live, closed, expired].sort());
    expect(r.vacancies.find((v: any) => v.id === live)).toMatchObject({ status: 'published', expired: false, applicants: 1, kind: 'internship', industry: 'it_software', workFormat: 'onsite' });
    for (const [status, id] of [['draft', draft], ['published', live], ['closed', closed], ['expired', expired]] as const) {
      expect((await admin.get(`/api/admin/employers/${e.id}?status=${status}`)).body.vacancies.map((v: any) => v.id), status).toEqual([id]);
    }
    const newest = (await admin.get(`/api/admin/employers/${e.id}`)).body.vacancies.map((v: any) => v.id);
    const oldest = (await admin.get(`/api/admin/employers/${e.id}?sort=oldest`)).body.vacancies.map((v: any) => v.id);
    expect(oldest).toEqual([...newest].reverse());
    expect((await admin.get(`/api/admin/employers/${e.id}?status=archived`)).status).toBe(400);
    expect((await admin.get(`/api/admin/employers/${e.id}?sort=title`)).status).toBe(400);
    // the list shows the counts too
    const list = (await admin.get('/api/admin/employers?status=approved')).body.employers;
    expect(list.find((x: any) => x.id === e.id)).toMatchObject({ vacancyCount: 4, publishedCount: 2 });
    // and the admin can open any vacancy read-only, a draft included
    expect((await admin.get(`/api/vacancies/${draft}`)).body.vacancy).toMatchObject({ id: draft, status: 'draft' });
  });

  it('a pending company with drafts and a company without vacancies', async () => {
    const pending = await makeEmployer({ active: false });
    const d = (await pending.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    const empty = await makeEmployer();
    const admin = await makeAdmin();
    const p = (await admin.get(`/api/admin/employers/${pending.id}`)).body;
    expect(p.company.reviewStatus).toBe('pending');
    expect(p.vacancies.map((v: any) => v.id)).toEqual([d]);
    const n = (await admin.get(`/api/admin/employers/${empty.id}`)).body;
    expect(n.counts.all).toBe(0);
    expect(n.vacancies).toEqual([]);
    expect((await admin.get('/api/admin/employers/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('students, employers and anonymous users cannot use the admin endpoints', async () => {
    const { e, draft } = await companyWithVacancies();
    const s = await makeStudent();
    expect((await s.client.get(`/api/admin/employers/${e.id}`)).status).toBe(403);
    expect((await e.client.get(`/api/admin/employers/${e.id}`)).status).toBe(403);
    expect((await new Client().get(`/api/admin/employers/${e.id}`)).status).toBe(401);
    // and the ordinary endpoint still hides drafts from everyone but the owner and admins
    expect((await s.client.get(`/api/vacancies/${draft}`)).status).toBe(404);
    expect((await (await makeEmployer()).client.get(`/api/vacancies/${draft}`)).status).toBe(404);
  });
});

describe('vacancies created while the company waits for approval', () => {
  it('"publish after approval": approving the company publishes the draft, students see it, matching ran', async () => {
    await seedSkills('Python', 'SQL');
    const pending = await makeEmployer({ active: false });
    const s = await makeStudent();
    await setProfile(s.client, { skills: ['Python', 'SQL'] });
    const id = (await pending.client.post('/api/vacancies', vacancyPayload({ title: 'Created while pending' }))).body.vacancy.id;
    expect(err(await pending.client.post(`/api/vacancies/${id}/publish`)).code).toBe('EMPLOYER_NOT_APPROVED');
    const req = await pending.client.post(`/api/vacancies/${id}/publish-request`);
    expect(req.status).toBe(200);
    expect(req.body.vacancy).toMatchObject({ status: 'draft', publishRequested: true });
    expect(ids(await s.client.get('/api/vacancies'))).not.toContain(id);

    const admin = await makeAdmin();
    const ok = await admin.post(`/api/admin/employers/${pending.id}/approve`);
    expect(ok.body.published).toBe(1);
    expect(ids(await s.client.get('/api/vacancies'))).toContain(id);
    const row = (await sql('SELECT status, publish_requested_at FROM vacancies WHERE id = $1', [id]))[0];
    expect(row).toEqual({ status: 'published', publish_requested_at: null });
    expect((await sql('SELECT count(*) AS n FROM matches WHERE vacancy_id = $1', [id]))[0].n).toBe(1);
    expect((await sql(`SELECT actor_role FROM audit_log WHERE action = 'vacancy.publish' AND target_id = $1`, [id]))[0].actor_role).toBe('admin');
  });

  it('drafts without a request stay drafts; a cancelled request too; an invalid draft keeps its request', async () => {
    const pending = await makeEmployer({ active: false });
    const plain = (await pending.client.post('/api/vacancies', vacancyPayload({ title: 'Plain draft' }))).body.vacancy.id;
    const cancelled = (await pending.client.post('/api/vacancies', vacancyPayload({ title: 'Cancelled draft' }))).body.vacancy.id;
    const stale = (await pending.client.post('/api/vacancies', vacancyPayload({ title: 'Stale deadline draft' }))).body.vacancy.id;
    for (const id of [cancelled, stale]) await pending.client.post(`/api/vacancies/${id}/publish-request`);
    expect((await pending.client.delete(`/api/vacancies/${cancelled}/publish-request`)).body.vacancy.publishRequested).toBe(false);
    await sql('UPDATE vacancies SET deadline = $2 WHERE id = $1', [stale, shiftDays(todayAlmaty(), -1)]);
    const admin = await makeAdmin();
    expect((await admin.post(`/api/admin/employers/${pending.id}/approve`)).body.published).toBe(0);
    const st = await sql<{ id: string; status: string; r: string | null }>('SELECT id, status, publish_requested_at AS r FROM vacancies WHERE employer_id = $1', [pending.id]);
    expect(st.find((x) => x.id === plain)).toMatchObject({ status: 'draft', r: null });
    expect(st.find((x) => x.id === cancelled)).toMatchObject({ status: 'draft', r: null });
    expect(st.find((x) => x.id === stale)!.status).toBe('draft');
    expect(st.find((x) => x.id === stale)!.r).not.toBeNull();
  });

  it('request guards: approved companies publish directly, rejected cannot, only own drafts', async () => {
    const e = await makeEmployer();
    const draft = (await e.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    expect(err(await e.client.post(`/api/vacancies/${draft}/publish-request`)).code).toBe('EMPLOYER_ALREADY_APPROVED');
    const live = await published(e);
    expect(err(await e.client.post(`/api/vacancies/${live}/publish-request`)).code).toBe('VACANCY_NOT_DRAFT');
    const other = await makeEmployer({ active: false });
    expect((await other.client.post(`/api/vacancies/${draft}/publish-request`)).status).toBe(404);
    const rej = await makeEmployer({ active: false });
    const rd = (await rej.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    await (await makeAdmin()).post(`/api/admin/employers/${rej.id}/reject`);
    expect(err(await rej.client.post(`/api/vacancies/${rd}/publish-request`)).code).toBe('EMPLOYER_REJECTED');
    const s = await makeStudent();
    expect((await s.client.post(`/api/vacancies/${draft}/publish-request`)).status).toBe(403);
  });

  it('the cron sweep publishes requested drafts of approved companies (e.g. flagged by migration 0005)', async () => {
    const { runScheduled } = await import('../src/services/scheduled');
    const { testEnv } = await import('./helpers');
    const e = await makeEmployer();
    const id = (await e.client.post('/api/vacancies', vacancyPayload({ title: 'Flagged by the migration' }))).body.vacancy.id;
    await sql('UPDATE vacancies SET publish_requested_at = created_at WHERE id = $1', [id]);
    await runScheduled(testEnv, '*/15 * * * *');
    expect((await sql('SELECT status FROM vacancies WHERE id = $1', [id]))[0].status).toBe('published');
  });

  it('migration 0005 backfill: drafts created before approval are flagged, later drafts are not', async () => {
    const e = await makeEmployer();
    const before = (await e.client.post('/api/vacancies', vacancyPayload({ title: 'Before approval' }))).body.vacancy.id;
    const after = (await e.client.post('/api/vacancies', vacancyPayload({ title: 'After approval' }))).body.vacancy.id;
    await sql(`UPDATE vacancies SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = $1`, [before]);
    await sql(`UPDATE vacancies SET created_at = '2026-03-01T00:00:00.000Z' WHERE id = $1`, [after]);
    await sql(`UPDATE employer_profiles SET reviewed_at = '2026-02-01T00:00:00.000Z' WHERE user_id = $1`, [e.id]);
    const backfill = readFileSync(fileURLToPath(new URL('../../database/d1/0005_publish_after_approval.sql', import.meta.url)), 'utf8').split(/^UPDATE /m)[1];
    await sql('UPDATE ' + backfill.trim().replace(/;$/, ''));
    const r = await sql<{ id: string; f: string | null }>('SELECT id, publish_requested_at AS f FROM vacancies WHERE employer_id = $1', [e.id]);
    expect(r.find((x) => x.id === before)!.f).not.toBeNull();
    expect(r.find((x) => x.id === after)!.f).toBeNull();
  });
});
