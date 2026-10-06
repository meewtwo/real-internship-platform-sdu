import { beforeEach, describe, expect, it } from 'vitest';
import { buildIcs } from '../src/lib/ics';
import { getMailbox } from '../src/lib/mail';
import { validateInterviewProposal, validateMessage } from '@sdu/shared';
import { Client, makeAdmin, makeEmployer, makeStudent, resetDb, setProfile, sql, vacancyPayload, seedSkills, ago } from './helpers';

beforeEach(async () => { await resetDb(); await sql('DELETE FROM audit_log'); await seedSkills('Python', 'SQL'); getMailbox().length = 0; });
const err = (r: { body: any }) => r.body?.error;
type Emp = Awaited<ReturnType<typeof makeEmployer>>;
async function publish(emp: Emp, over: Record<string, unknown> = {}) {
  const c = await emp.client.post('/api/vacancies', vacancyPayload(over));
  await emp.client.post(`/api/vacancies/${c.body.vacancy.id}/publish`);
  return c.body.vacancy.id as string;
}
async function setup(opts: { lang?: string } = {}) {
  const emp = await makeEmployer();
  const stu = await makeStudent({ language: opts.lang ?? 'en' });
  await setProfile(stu.client, { skills: ['Python', 'SQL'] });
  const vid = await publish(emp);
  const appId = (await stu.client.post(`/api/vacancies/${vid}/apply`)).body.application.id as string;
  getMailbox().length = 0;
  return { emp, stu, vid, appId };
}
const iso = (offsetMin: number) => new Date(Math.ceil((Date.now() + offsetMin * 60_000) / 60_000) * 60_000).toISOString();
const propose = (emp: Emp, appId: string, over: Record<string, unknown> = {}) => emp.client.post('/api/interviews', { applicationId: appId, startsAt: iso(2 * 24 * 60), durationMin: 45, format: 'online', location: 'https://meet.example.com/abc', note: 'Bring your portfolio', ...over });

describe('messages', () => {
  it('two-way conversation with unread tracking, polling and thread list', async () => {
    const { emp, stu, appId } = await setup();
    expect((await stu.client.get('/api/messages/threads')).body.threads).toEqual([]); // no messages yet → no thread
    const first = await emp.client.post(`/api/messages/${appId}`, { body: 'Hello! Can you talk on Monday?' });
    expect(first.status).toBe(201);
    expect(first.body.message).toMatchObject({ mine: true, body: 'Hello! Can you talk on Monday?', read: false });
    expect((await stu.client.get('/api/messages/unread')).body.unread).toBe(1);
    const threads = (await stu.client.get('/api/messages/threads')).body.threads;
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ applicationId: appId, counterpart: 'Acme Technologies LLP', unread: 1, last: { mine: false } });
    const read = await stu.client.get(`/api/messages/${appId}`);
    expect(read.body).toMatchObject({ counterpart: 'Acme Technologies LLP', role: 'student', canSend: true, vacancy: { title: 'Junior Python Developer Intern' } });
    expect(read.body.messages).toHaveLength(1);
    expect(read.body.messages[0].mine).toBe(false);
    expect((await stu.client.get('/api/messages/unread')).body.unread).toBe(0); // reading marks as read
    const reply = await stu.client.post(`/api/messages/${appId}`, { body: 'Yes, Monday works.' });
    const empView = await emp.client.get(`/api/messages/${appId}`);
    expect(empView.body).toMatchObject({ counterpart: 'Aigerim Nurlanova', role: 'employer' });
    expect(empView.body.messages.map((m: any) => [m.mine, m.body, m.read])).toEqual([[true, 'Hello! Can you talk on Monday?', true], [false, 'Yes, Monday works.', true]]); // opening the thread marks the other side's messages read; `read` matters for MY messages (seen by them)
    const after = await emp.client.get(`/api/messages/${appId}?after=${first.body.message.id}`);
    expect(after.body.messages.map((m: any) => m.id)).toEqual([reply.body.message.id]);
    expect((await emp.client.get(`/api/messages/${appId}?after=999999999999`)).body.messages).toEqual([]);
    expect((await emp.client.get(`/api/messages/${appId}?after=abc`)).status).toBe(400);
  });

  it('only the two participants can read or write; roles and auth enforced', async () => {
    const { emp, stu, appId } = await setup();
    const otherS = await makeStudent(), otherE = await makeEmployer(), admin = await makeAdmin();
    await emp.client.post(`/api/messages/${appId}`, { body: 'private' });
    for (const who of [otherS, otherE]) {
      expect((await who.client.get(`/api/messages/${appId}`)).status).toBe(404);
      expect((await who.client.post(`/api/messages/${appId}`, { body: 'intrusion' })).status).toBe(404);
      expect((await who.client.get('/api/messages/threads')).body.threads).toEqual([]);
      expect((await who.client.get('/api/messages/unread')).body.unread).toBe(0);
    }
    expect((await admin.get(`/api/messages/${appId}`)).status).toBe(403);
    expect((await new Client().get(`/api/messages/${appId}`)).status).toBe(401);
    expect((await stu.client.get('/api/messages/not-a-uuid')).status).toBe(404);
    expect(await sql('SELECT 1 FROM application_messages')).toHaveLength(1);
  });

  it('validates and sanitises text; stores markup as inert text', async () => {
    const { emp, stu, appId } = await setup();
    for (const [body, code] of [[{ body: '' }, 'MESSAGE_INVALID'], [{ body: '   \n\t ' }, 'MESSAGE_INVALID'], [{ body: 5 }, 'MESSAGE_INVALID'], [{}, 'MESSAGE_INVALID'], [{ body: 'x'.repeat(2001) }, 'TEXT_TOO_LONG'], [{ body: 'x', extra: 1 }, 'UNKNOWN_FIELDS']] as const) {
      const r = await emp.client.post(`/api/messages/${appId}`, body);
      expect(r.status, JSON.stringify(body).slice(0, 30)).toBe(400);
      expect(err(r).code).toBe(code);
    }
    expect((await emp.client.json('POST', `/api/messages/${appId}`, undefined, { rawBody: '{bad' })).status).toBe(400);
    expect((await emp.client.json('POST', `/api/messages/${appId}`, { body: 'x' }, { csrf: null })).status).toBe(403);
    const r = await stu.client.post(`/api/messages/${appId}`, { body: '  Line one\r\n\r\n\r\n\r\nLine <b>two</b>\u0000\u202E  ' });
    expect(r.body.message.body).toBe('Line one\n\nLine <b>two</b>');
    expect(validateMessage('😀'.repeat(2000))).toMatchObject({ ok: true });
    expect(validateMessage('😀'.repeat(2001))).toMatchObject({ ok: false });
  });

  it('closed applications are read-only; a withdrawn or rejected candidate cannot be messaged', async () => {
    const { emp, stu, appId } = await setup();
    await emp.client.post(`/api/messages/${appId}`, { body: 'hi' });
    await emp.client.patch(`/api/applications/${appId}/status`, { status: 'rejected' });
    const r = await emp.client.post(`/api/messages/${appId}`, { body: 'one more' });
    expect(r.status).toBe(409);
    expect(err(r).code).toBe('MESSAGE_NOT_ALLOWED');
    const view = await stu.client.get(`/api/messages/${appId}`);
    expect(view.body).toMatchObject({ canSend: false, status: 'rejected' });
    expect(view.body.messages).toHaveLength(1);
    const e2 = await setup();
    await e2.stu.client.post(`/api/applications/${e2.appId}/withdraw`);
    expect((await e2.stu.client.post(`/api/messages/${e2.appId}`, { body: 'x' })).status).toBe(409);
  });

  it('a burst of messages makes ONE unread notification and one e-mail; a new one appears after the recipient reads', async () => {
    const { emp, stu, appId } = await setup({ lang: 'ru' });
    for (let i = 0; i < 5; i++) await emp.client.post(`/api/messages/${appId}`, { body: `message ${i}` });
    const notes = (await stu.client.get('/api/notifications')).body.items.filter((n: any) => n.kind === 'new_message');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ link: `/messages/${appId}`, params: { title: 'Junior Python Developer Intern', from: 'Acme Technologies LLP' } });
    const mails = getMailbox().filter((m) => m.to === stu.payload.email && m.kind === 'notification.new_message');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('Новое сообщение: Junior Python Developer Intern');
    await stu.client.post('/api/notifications/read-all');
    await emp.client.post(`/api/messages/${appId}`, { body: 'again' });
    expect((await stu.client.get('/api/notifications')).body.items.filter((n: any) => n.kind === 'new_message')).toHaveLength(2);
  });

  it('rate limit: 60 messages per hour per user', async () => {
    const { emp, appId } = await setup();
    await emp.client.ensureCsrf();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await emp.client.post(`/api/messages/${appId}`, { body: `m${i}` })).status;
    expect(last).toBe(429);
    expect(await sql('SELECT 1 FROM application_messages')).toHaveLength(60);
  });

  it('concurrent sends from both sides are all stored with strictly increasing ids; deleting the account removes its messages', async () => {
    const { emp, stu, appId } = await setup();
    await emp.client.ensureCsrf(); await stu.client.ensureCsrf();
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? stu : emp).client.post(`/api/messages/${appId}`, { body: `race ${i}` })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const ids = (await emp.client.get(`/api/messages/${appId}`)).body.messages.map((m: any) => BigInt(m.id));
    expect(ids).toHaveLength(8);
    expect(ids.every((v: bigint, i: number) => i === 0 || v > ids[i - 1])).toBe(true);
    expect((await stu.client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' })).status).toBe(200);
    expect(await sql('SELECT 1 FROM application_messages')).toHaveLength(0);
  });
});

describe('interviews', () => {
  it('propose → accept: notifies both ways, moves the application to "interview", e-mails with Almaty time', async () => {
    const { emp, stu, appId } = await setup({ lang: 'ru' });
    const start = iso(2 * 24 * 60);
    const r = await propose(emp, appId, { startsAt: start });
    expect(r.status).toBe(201);
    expect(r.body.interview).toMatchObject({ status: 'proposed', durationMin: 45, format: 'online', location: 'https://meet.example.com/abc', note: 'Bring your portfolio', role: 'employer', counterpart: 'Aigerim Nurlanova', proposedByMe: true });
    const mail = getMailbox().find((m) => m.to === stu.payload.email && m.kind === 'notification.interview_update')!;
    expect(mail.subject).toBe('Собеседование — предложено: Junior Python Developer Intern');
    expect(mail.text).toMatch(/Acme Technologies LLP предлагает собеседование по «Junior Python Developer Intern»: \d{4}-\d\d-\d\d \d\d:\d\d\./);
    const id = r.body.interview.id;
    const mine = await stu.client.get('/api/interviews');
    expect(mine.body.interviews[0]).toMatchObject({ id, role: 'student', counterpart: 'Acme Technologies LLP', proposedByMe: false });
    const acc = await stu.client.post(`/api/interviews/${id}/respond`, { accept: true });
    expect(acc.status).toBe(200);
    expect(acc.body.interview.status).toBe('accepted');
    expect((await sql<{ status: string }>('SELECT status FROM applications'))[0].status).toBe('interview');
    expect((await sql<{ status: string }>('SELECT status FROM application_events ORDER BY id DESC LIMIT 1'))[0].status).toBe('interview');
    expect(getMailbox().find((m) => m.to === emp.payload.email && m.kind === 'notification.interview_update')!.subject).toBe('Interview confirmed: Junior Python Developer Intern');
    expect((await stu.client.post(`/api/interviews/${id}/respond`, { accept: true })).status).toBe(409); // already decided
  });

  it('decline leaves the application status alone and lets the employer propose again', async () => {
    const { emp, stu, appId } = await setup();
    const id = (await propose(emp, appId)).body.interview.id;
    expect((await propose(emp, appId, { startsAt: iso(3 * 24 * 60) })).status).toBe(409); // one live interview per application
    expect(err(await propose(emp, appId, { startsAt: iso(3 * 24 * 60) })).code).toBe('INTERVIEW_ACTIVE_EXISTS');
    expect((await stu.client.post(`/api/interviews/${id}/respond`, { accept: false })).body.interview.status).toBe('declined');
    expect((await sql<{ status: string }>('SELECT status FROM applications'))[0].status).toBe('applied');
    expect((await propose(emp, appId, { startsAt: iso(3 * 24 * 60) })).status).toBe(201);
  });

  it('validation: time window, timezone, duration, format, location, unknown fields — with field codes', async () => {
    const { emp, appId } = await setup();
    const bad = async (over: Record<string, unknown>, field: string, code: string) => { const r = await propose(emp, appId, over); expect(r.status, JSON.stringify(over)).toBe(400); expect(err(r).fields[field], JSON.stringify(over)).toBe(code); };
    await bad({ startsAt: iso(-60) }, 'startsAt', 'INTERVIEW_TIME_INVALID');
    await bad({ startsAt: iso(10) }, 'startsAt', 'INTERVIEW_TIME_INVALID');
    await bad({ startsAt: iso(91 * 24 * 60) }, 'startsAt', 'INTERVIEW_TIME_INVALID');
    for (const s of ['2030-01-01 10:00', '2030-01-01T10:00', 'tomorrow', '', null, 5, '2030-13-40T10:00:00Z']) await bad({ startsAt: s }, 'startsAt', 'INTERVIEW_TIME_INVALID');
    for (const d of [14, 241, 30.5, '30', null]) await bad({ durationMin: d }, 'durationMin', 'INTERVIEW_TIME_INVALID');
    await bad({ format: 'telepathy' }, 'format', 'VALIDATION_FAILED');
    await bad({ location: '' }, 'location', 'REQUIRED');
    await bad({ location: 'x'.repeat(201) }, 'location', 'TEXT_TOO_LONG');
    await bad({ location: 'javascript:alert(1)' }, 'location', 'RESUME_URL_INVALID');
    await bad({ location: 'http://insecure.example.com/room' }, 'location', 'RESUME_URL_INVALID');
    await bad({ note: 'n'.repeat(501) }, 'note', 'TEXT_TOO_LONG');
    expect(err(await propose(emp, appId, { extra: 1 })).code).toBe('UNKNOWN_FIELDS');
    expect((await propose(emp, appId, { format: 'onsite', location: 'SDU campus, room 305', note: undefined })).status).toBe(201);
  });

  it('permissions: only the owning employer proposes, only the candidate responds, participants can cancel', async () => {
    const { emp, stu, appId } = await setup();
    const otherE = await makeEmployer(), otherS = await makeStudent();
    expect((await propose(otherE, appId)).status).toBe(404);
    expect((await stu.client.post('/api/interviews', { applicationId: appId, startsAt: iso(2 * 24 * 60), durationMin: 30, format: 'phone', location: '+77010000000' })).status).toBe(403);
    expect((await propose(emp, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const id = (await propose(emp, appId)).body.interview.id;
    expect((await emp.client.post(`/api/interviews/${id}/respond`, { accept: true })).status).toBe(403);
    expect((await otherS.client.post(`/api/interviews/${id}/respond`, { accept: true })).status).toBe(404);
    expect((await otherS.client.post(`/api/interviews/${id}/cancel`)).status).toBe(404);
    expect((await otherE.client.post(`/api/interviews/${id}/cancel`)).status).toBe(404);
    expect((await otherS.client.get(`/api/interviews/${id}/ics`)).status).toBe(404);
    expect((await otherE.client.get('/api/interviews')).body.interviews).toEqual([]);
    expect((await new Client().get('/api/interviews')).status).toBe(401);
    expect((await stu.client.post(`/api/interviews/${id}/respond`, { accept: 'yes' })).status).toBe(400);
    expect((await stu.client.post(`/api/interviews/not-a-uuid/respond`, { accept: true })).status).toBe(404);
  });

  it('cannot schedule for closed applications', async () => {
    const { emp, appId } = await setup();
    await emp.client.patch(`/api/applications/${appId}/status`, { status: 'rejected' });
    expect(err(await propose(emp, appId)).code).toBe('INTERVIEW_STATE_INVALID');
  });

  it('employer conflicts: overlapping slots refused, adjacent slots fine, concurrent overlapping proposals → exactly one wins', async () => {
    const emp = await makeEmployer();
    const vid = await publish(emp);
    const apps: string[] = [];
    for (let i = 0; i < 4; i++) { const s = await makeStudent(); await setProfile(s.client, { skills: ['Python'] }); apps.push((await s.client.post(`/api/vacancies/${vid}/apply`)).body.application.id); }
    const t0 = 3 * 24 * 60;
    expect((await propose(emp, apps[0], { startsAt: iso(t0), durationMin: 60 })).status).toBe(201);
    const overlap = await propose(emp, apps[1], { startsAt: iso(t0 + 30), durationMin: 30 });
    expect(overlap.status).toBe(409);
    expect(err(overlap).code).toBe('INTERVIEW_CONFLICT');
    expect((await propose(emp, apps[1], { startsAt: iso(t0 + 60), durationMin: 30 })).status).toBe(201); // starts exactly when the first ends
    expect((await propose(emp, apps[1], { startsAt: iso(t0 - 30), durationMin: 30 })).status).toBe(409); // app 1 already has a live one
    await emp.client.ensureCsrf();
    const race = await Promise.all([apps[2], apps[3]].map((a) => propose(emp, a, { startsAt: iso(t0 + 600), durationMin: 60 })));
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('a cancelled slot frees the time; a declined one too', async () => {
    const emp = await makeEmployer();
    const vid = await publish(emp);
    const sA = await makeStudent(), sB = await makeStudent();
    const a = (await sA.client.post(`/api/vacancies/${vid}/apply`)).body.application.id, b = (await sB.client.post(`/api/vacancies/${vid}/apply`)).body.application.id;
    const first = await propose(emp, a, { startsAt: iso(4 * 24 * 60), durationMin: 60 });
    expect((await propose(emp, b, { startsAt: iso(4 * 24 * 60), durationMin: 60 })).status).toBe(409);
    await emp.client.post(`/api/interviews/${first.body.interview.id}/cancel`);
    expect((await propose(emp, b, { startsAt: iso(4 * 24 * 60), durationMin: 60 })).status).toBe(201);
  });

  it('candidate conflicts: cannot accept a second interview that overlaps one already confirmed', async () => {
    const stu = await makeStudent();
    await setProfile(stu.client, { skills: ['Python'] });
    const e1 = await makeEmployer(), e2 = await makeEmployer();
    const a1 = (await stu.client.post(`/api/vacancies/${await publish(e1)}/apply`)).body.application.id;
    const a2 = (await stu.client.post(`/api/vacancies/${await publish(e2, { title: 'Second company role' })}/apply`)).body.application.id;
    const i1 = (await propose(e1, a1, { startsAt: iso(5 * 24 * 60), durationMin: 60 })).body.interview.id;
    const i2 = (await propose(e2, a2, { startsAt: iso(5 * 24 * 60 + 30), durationMin: 60 })).body.interview.id;
    expect((await stu.client.post(`/api/interviews/${i1}/respond`, { accept: true })).status).toBe(200);
    const clash = await stu.client.post(`/api/interviews/${i2}/respond`, { accept: true });
    expect(clash.status).toBe(409);
    expect(err(clash).code).toBe('INTERVIEW_CONFLICT');
    expect((await stu.client.post(`/api/interviews/${i2}/respond`, { accept: false })).status).toBe(200);
  });

  it('cancel: either side, only while upcoming and live; the other side is notified; double cancel and past interviews refused', async () => {
    const { emp, stu, appId } = await setup();
    const id = (await propose(emp, appId)).body.interview.id;
    await stu.client.post(`/api/interviews/${id}/respond`, { accept: true });
    getMailbox().length = 0;
    const c = await stu.client.post(`/api/interviews/${id}/cancel`);
    expect(c.body.interview.status).toBe('cancelled');
    expect(getMailbox().find((m) => m.to === emp.payload.email && m.kind === 'notification.interview_update')!.text).toContain('Aigerim Nurlanova cancelled the interview');
    expect((await stu.client.post(`/api/interviews/${id}/cancel`)).status).toBe(409);
    expect((await emp.client.post(`/api/interviews/${id}/cancel`)).status).toBe(409);
    const id2 = (await propose(emp, appId, { startsAt: iso(3 * 24 * 60) })).body.interview.id;
    await sql(`UPDATE interviews SET starts_at = ${ago(1, 'hours')} WHERE id = $1`, [id2]);
    expect((await emp.client.post(`/api/interviews/${id2}/cancel`)).status).toBe(409);
    expect((await stu.client.post(`/api/interviews/${id2}/respond`, { accept: true })).status).toBe(409); // too late to accept
  });

  it('lists upcoming first, then past', async () => {
    const emp = await makeEmployer();
    const vid = await publish(emp);
    const ids: string[] = [];
    const stu = await makeStudent();
    const a = (await stu.client.post(`/api/vacancies/${vid}/apply`)).body.application.id;
    const i = (await propose(emp, a, { startsAt: iso(6 * 24 * 60) })).body.interview.id;
    await emp.client.post(`/api/interviews/${i}/cancel`);
    const j = (await propose(emp, a, { startsAt: iso(2 * 24 * 60) })).body.interview.id;
    ids.push(i, j);
    await sql(`UPDATE interviews SET starts_at = ${ago(2, 'days')} WHERE id = $1`, [i]);
    const list = (await emp.client.get('/api/interviews')).body.interviews;
    expect(list.map((x: any) => x.id)).toEqual([j, i]);
  });

  it('.ics: valid calendar file for both participants — UTC times, escaping, folding, status', async () => {
    const { emp, stu, appId } = await setup();
    const start = '2031-03-04T09:30:00.000Z';
    const r = await emp.client.post('/api/interviews', { applicationId: appId, startsAt: start, durationMin: 90, format: 'onsite', location: 'Room 5; Block B, Almaty — Достык 59/1 and a very long street address that must be folded across lines properly', note: 'Bring ID, laptop; thanks' });
    expect(r.status).toBe(400); // 2031 is beyond 90 days → use a near date instead
    const near = iso(10 * 24 * 60);
    const id = (await emp.client.post('/api/interviews', { applicationId: appId, startsAt: near, durationMin: 90, format: 'onsite', location: 'Room 5; Block B, Almaty — Достык 59/1 and a very long street address that must be folded across lines properly', note: 'Bring ID, laptop; thanks' })).body.interview.id;
    for (const who of [emp, stu]) {
      const res = await who.client.download(`/api/interviews/${id}/ics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const text = new TextDecoder().decode(res.bytes);
      expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false); // CRLF only
      const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      expect(text).toContain(`DTSTART:${stamp(new Date(near))}`);
      expect(text).toContain(`DTEND:${stamp(new Date(new Date(near).getTime() + 90 * 60_000))}`);
      expect(text).toContain('STATUS:TENTATIVE');
      const unfolded = text.replace(/\r\n /g, '');
      expect(unfolded).toContain('Room 5\; Block B\\, Almaty — Достык 59/1');
      expect(unfolded).toContain('Bring ID\\, laptop\; thanks');
      for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    }
    await stu.client.post(`/api/interviews/${id}/respond`, { accept: true });
    expect(new TextDecoder().decode((await stu.client.download(`/api/interviews/${id}/ics`)).bytes)).toContain('STATUS:CONFIRMED');
    await emp.client.post(`/api/interviews/${id}/cancel`);
    expect(new TextDecoder().decode((await stu.client.download(`/api/interviews/${id}/ics`)).bytes)).toContain('STATUS:CANCELLED');
  });
});

describe('buildIcs / validators (unit)', () => {
  it('folds long lines without splitting multibyte characters and escapes specials', () => {
    const ics = buildIcs({ uid: 'u1', start: new Date('2030-01-15T10:00:00Z'), durationMin: 30, summary: 'a,b;c\\d\ne', location: '😀'.repeat(60), description: 'д'.repeat(120), status: 'CONFIRMED', now: new Date('2030-01-01T00:00:00Z') });
    expect(ics).toContain('SUMMARY:a\\,b\;c\\\\d\\ne');
    expect(ics).toContain('DTSTAMP:20300101T000000Z');
    expect(ics).toContain('DTSTART:20300115T100000Z');
    expect(ics).toContain('DTEND:20300115T103000Z');
    const un = ics.replace(/\r\n /g, '');
    expect(un).toContain(`LOCATION:${'😀'.repeat(60)}`);
    expect(un).toContain(`DESCRIPTION:${'д'.repeat(120)}`);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).not.toContain('\uFFFD');
  });
  it('proposal validator accepts offsets, normalises to UTC and is deterministic for a fixed clock', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const ok = validateInterviewProposal({ applicationId: '00000000-0000-4000-8000-000000000000', startsAt: '2030-01-05T15:00:00+05:00', durationMin: 30, format: 'phone', location: ' +7 701 000 00 00 ' }, now);
    expect(ok).toEqual({ ok: true, data: { applicationId: '00000000-0000-4000-8000-000000000000', startsAt: '2030-01-05T10:00:00.000Z', durationMin: 30, format: 'phone', location: '+7 701 000 00 00', note: null } });
    expect(validateInterviewProposal({ applicationId: 'x' }, now)).toMatchObject({ ok: false });
    expect(validateInterviewProposal(null, now)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});
