import { beforeEach, describe, expect, it } from 'vitest';
import { validateOtherText, validateStudentProfile } from '@sdu/shared';
import { Client, employerPayload, makeAdmin, makeEmployer, makeStudent, resetDb, seedSkills, setProfile, sql, studentPayload, vacancyPayload } from './helpers';

beforeEach(async () => {
  await resetDb();
  await seedSkills('Python', 'SQL');
});
const err = (r: { body: any }) => r.body?.error;
const kinds = async (c: Client) => (await c.get('/api/notifications')).body.items.map((n: any) => n.kind);

describe('"Other" dropdown values (interest / industry)', () => {
  it('validator: required, trimmed, 2–100 visible characters', () => {
    expect(validateOtherText('  Game design ')).toEqual({ ok: true, value: 'Game design' });
    expect(validateOtherText('   ')).toEqual({ ok: false, code: 'REQUIRED' });
    expect(validateOtherText(undefined)).toEqual({ ok: false, code: 'REQUIRED' });
    expect(validateOtherText('x')).toEqual({ ok: false, code: 'OTHER_TEXT_INVALID' });
    expect(validateOtherText('x'.repeat(101))).toEqual({ ok: false, code: 'OTHER_TEXT_INVALID' });
    expect(validateOtherText('x'.repeat(100)).ok).toBe(true);
    expect(validateOtherText('a​b')).toEqual({ ok: false, code: 'OTHER_TEXT_INVALID' });
    expect(validateOtherText(42)).toEqual({ ok: false, code: 'OTHER_TEXT_INVALID' });
  });

  it('student profile: custom interest is required with "other", saved, and dropped when another option is picked', async () => {
    const { client } = await makeStudent();
    const cur = (await client.get('/api/profile')).body.profile;
    expect(cur.interestOther).toBeNull();
    const missing = await client.put('/api/profile/student', { ...cur, interestArea: 'other', interestOther: '  ' });
    expect(err(missing).fields).toEqual({ interestOther: 'REQUIRED' });
    await setProfile(client, { interestArea: 'other', interestOther: '  Game design ' });
    expect((await client.get('/api/profile')).body.profile).toMatchObject({ interestArea: 'other', interestOther: 'Game design' });
    await setProfile(client, { interestArea: 'data_ai', interestOther: 'ignored' });
    expect((await client.get('/api/profile')).body.profile).toMatchObject({ interestArea: 'data_ai', interestOther: null });
    // the client-side validator gives the same answer
    expect(validateStudentProfile({ ...cur, interestArea: 'other', interestOther: '' }).ok).toBe(false);
  });

  it('student registration accepts a custom interest', async () => {
    const p = studentPayload({ interestArea: 'other', interestOther: 'Sports analytics' });
    expect((await new Client().post('/api/auth/register/student', p)).status).toBe(201);
    expect((await sql('SELECT interest_area, interest_other FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE u.email = $1', [p.email]))[0])
      .toEqual({ interest_area: 'other', interest_other: 'Sports analytics' });
    const bad = await new Client().post('/api/auth/register/student', studentPayload({ interestArea: 'other' }));
    expect(err(bad).fields.interestOther).toBe('REQUIRED');
  });

  it('employer registration + profile store a custom industry; it is cleared when a list industry is chosen', async () => {
    const c = new Client();
    const p = employerPayload({ industry: 'other', industryOther: 'Esports' });
    expect((await c.post('/api/auth/register/employer', p)).status).toBe(201);
    expect((await sql('SELECT industry_key, industry_other FROM employer_profiles ep JOIN users u ON u.id = ep.user_id WHERE u.email = $1', [p.email]))[0])
      .toEqual({ industry_key: 'other', industry_other: 'Esports' });
    expect(err(await new Client().post('/api/auth/register/employer', employerPayload({ industry: 'other', industryOther: 'x'.repeat(101) }))).fields.industryOther).toBe('OTHER_TEXT_INVALID');

    const e = await makeEmployer();
    const cur = (await e.client.get('/api/profile')).body.profile;
    const { bin: _bin, ...editable } = cur;
    expect((await e.client.put('/api/profile/employer', { ...editable, industry: 'other', industryOther: 'Space tech' })).body.profile).toMatchObject({ industry: 'other', industryOther: 'Space tech' });
    expect((await e.client.put('/api/profile/employer', { ...editable, industry: 'telecom', industryOther: 'Space tech' })).body.profile).toMatchObject({ industry: 'telecom', industryOther: null });
  });

  it('vacancies keep a custom industry too', async () => {
    const e = await makeEmployer();
    expect(err(await e.client.post('/api/vacancies', vacancyPayload({ industry: 'other' }))).fields.industryOther).toBe('REQUIRED');
    const v = (await e.client.post('/api/vacancies', vacancyPayload({ industry: 'other', industryOther: 'Esports' }))).body.vacancy;
    expect(v).toMatchObject({ industry: 'other', industryOther: 'Esports' });
    // a draft saved before the field existed (industry 'other', no text) can still be published
    await sql(`UPDATE vacancies SET industry_other = NULL WHERE id = $1`, [v.id]);
    expect((await e.client.post(`/api/vacancies/${v.id}/publish`)).status).toBe(200);
  });
});

describe('company review by an admin', () => {
  it('lists companies by review status with details and counts; only verified employers are listed', async () => {
    const admin = await makeAdmin();
    const pend = await makeEmployer({ active: false });
    await makeEmployer();
    await new Client().post('/api/auth/register/employer', employerPayload()); // unverified: not up for review yet
    const r = (await admin.get('/api/admin/employers?status=pending')).body;
    expect(r.counts).toEqual({ pending: 1, approved: 1, rejected: 0 });
    expect(r.employers).toHaveLength(1);
    expect(r.employers[0]).toMatchObject({ id: pend.id, companyName: 'Acme Technologies LLP', industry: 'it_software', size: 's51_200', city: 'astana', reviewStatus: 'pending', contactName: 'Timur', position: 'HR Manager' });
    expect((await admin.get('/api/admin/employers?status=approved')).body.employers).toHaveLength(1);
    expect((await admin.get('/api/admin/employers?status=nope')).status).toBe(400);
  });

  it('reject with a reason → employer can still sign in, sees the reason, cannot publish, is notified; approve later unlocks publishing', async () => {
    const admin = await makeAdmin();
    const e = await makeEmployer({ active: false });
    const draft = (await e.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    expect(err(await e.client.post(`/api/vacancies/${draft}/publish`)).code).toBe('EMPLOYER_NOT_APPROVED');

    expect(err(await admin.post(`/api/admin/employers/${e.id}/reject`, { reason: 'x'.repeat(501) })).fields.reason).toBe('REJECTION_REASON_TOO_LONG');
    const rej = await admin.post(`/api/admin/employers/${e.id}/reject`, { reason: '  IIN does not match the company  ' });
    expect(rej.body).toMatchObject({ ok: true, reviewStatus: 'rejected', rejectionReason: 'IIN does not match the company' });
    expect((await admin.post(`/api/admin/employers/${e.id}/reject`)).status).toBe(404); // already decided

    // the account stays usable so the employer sees why
    await e.client.post('/api/auth/logout');
    expect((await e.client.post('/api/auth/login', { role: 'employer', identifier: e.payload.email, password: e.payload.password })).status).toBe(200);
    expect((await e.client.get('/api/profile')).body.review).toMatchObject({ status: 'rejected', reason: 'IIN does not match the company' });
    expect(await kinds(e.client)).toContain('employer_rejected');
    const pub = await e.client.post(`/api/vacancies/${draft}/publish`);
    expect(pub.status).toBe(403);
    expect(err(pub).code).toBe('EMPLOYER_REJECTED');
    const listed = (await admin.get('/api/admin/employers?status=rejected')).body.employers;
    expect(listed[0]).toMatchObject({ id: e.id, rejectionReason: 'IIN does not match the company', reviewedBy: expect.stringContaining('@careermatch.kz') });

    // re-review: approve from the rejected list
    expect((await admin.post(`/api/admin/employers/${e.id}/approve`)).body).toMatchObject({ status: 'active', reviewStatus: 'approved' });
    expect((await e.client.get('/api/profile')).body.review).toMatchObject({ status: 'approved', reason: null });
    expect(await kinds(e.client)).toContain('employer_approved');
    expect((await e.client.post(`/api/vacancies/${draft}/publish`)).status).toBe(200);
    // the published vacancy is visible to students
    const s = await makeStudent();
    expect((await s.client.get(`/api/vacancies/${draft}`)).status).toBe(200);
  });

  it('approval keeps existing drafts as drafts', async () => {
    const admin = await makeAdmin();
    const e = await makeEmployer({ active: false });
    const draft = (await e.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    await admin.post(`/api/admin/employers/${e.id}/approve`);
    expect((await sql('SELECT status FROM vacancies WHERE id = $1', [draft]))[0].status).toBe('draft');
  });

  it('a company rejected before this change (blocked account) can still be approved', async () => {
    const admin = await makeAdmin();
    const e = await makeEmployer({ active: false });
    await sql(`UPDATE users SET status = 'blocked' WHERE id = $1`, [e.id]);
    await sql(`UPDATE employer_profiles SET review_status = 'rejected' WHERE user_id = $1`, [e.id]);
    expect((await admin.post(`/api/admin/employers/${e.id}/approve`)).status).toBe(200);
    expect((await sql('SELECT status FROM users WHERE id = $1', [e.id]))[0].status).toBe('active');
  });

  it('non-admins cannot list or decide', async () => {
    const e = await makeEmployer({ active: false });
    const s = await makeStudent();
    for (const c of [e.client, s.client]) {
      expect((await c.get('/api/admin/employers?status=pending')).status).toBe(403);
      expect((await c.post(`/api/admin/employers/${e.id}/approve`)).status).toBe(403);
      expect((await c.post(`/api/admin/employers/${e.id}/reject`, { reason: 'x' })).status).toBe(403);
    }
    expect((await new Client().get('/api/admin/employers')).status).toBe(401);
    expect((await sql('SELECT review_status FROM employer_profiles WHERE user_id = $1', [e.id]))[0].review_status).toBe('pending');
  });
});
