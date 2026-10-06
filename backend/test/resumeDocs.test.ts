import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { setAiProvider, type AiRequest } from '../src/services/ai';
import { parseCv } from '../src/lib/cvParse';
import { Client, app, makeEmployer, makePdf, makeStudent, resetDb, setProfile, sql, testEnv, vacancyPayload, seedSkills } from './helpers';

const calls: AiRequest[] = [];
function fake(reply: unknown | ((r: AiRequest) => unknown)) {
  calls.length = 0;
  setAiProvider({ async complete(r) { calls.push(r); const v = typeof reply === 'function' ? (reply as (r: AiRequest) => unknown)(r) : reply; return typeof v === 'string' ? v : JSON.stringify(v); } });
}
beforeEach(async () => {
  await resetDb();
  await sql('DELETE FROM audit_log'); await sql('DELETE FROM ai_cache');
  await seedSkills('Python', 'SQL', 'Docker', 'React');
  setAiProvider(null);
});
afterEach(() => { setAiProvider(null); delete testEnv.AI_USER_DAILY; });
const err = (r: { body: any }) => r.body?.error;

const DOC = (over: Record<string, unknown> = {}) => ({
  personal: { fullName: 'Aigerim Nurlanova', headline: 'Data analyst', email: 'aigerim@example.com', phone: '+7 701 123 45 67', city: 'Almaty', links: [{ label: 'GitHub', url: 'https://github.com/aigerim' }] },
  summary: 'Student who builds analytics tools with Python and SQL for real teams.',
  experience: [{ role: 'Data intern', company: 'Acme & Sons <Ltd>', location: 'Almaty', start: '2024-06', end: 'present', bullets: ['Built 12 dashboards used by 40 analysts', 'Automated weekly reports'] }],
  education: [{ institution: 'SDU University', degree: 'BSc CS', start: '2022-09', end: '2026-06', details: 'GPA 3.65' }],
  projects: [], skills: [{ group: 'Tools', items: ['Python', 'SQL', 'Docker'] }], languages: [{ name: 'English', level: 'B2' }], certificates: [], ...over,
});
async function newDoc(client: Client, over: Record<string, unknown> = {}) {
  const r = await client.post('/api/resume-docs', { title: 'My résumé', from: 'blank', ...over });
  expect(r.status).toBe(201);
  return r.body.doc as { id: string; version: number; data: any };
}
async function save(client: Client, id: string, baseVersion: number, patch: Record<string, unknown>) { return client.put(`/api/resume-docs/${id}`, { baseVersion, ...patch }); }

describe('create & list', () => {
  it('seeds from blank / profile / CV / portal; defaults come from the account', async () => {
    const s = await makeStudent();
    await setProfile(s.client, { skills: ['Python', 'SQL'] });
    const blank = await newDoc(s.client, { from: 'blank' });
    expect(blank.data.personal).toMatchObject({ fullName: 'Aigerim Nurlanova', email: s.payload.email, city: 'Almaty' });
    expect(blank.data.skills).toEqual([]);
    expect(blank.version).toBe(1);
    const prof = await newDoc(s.client, { from: 'profile', title: 'From profile' });
    expect(prof.data.skills[0].items).toEqual(['Python', 'SQL']);
    expect(prof.data.education[0]).toMatchObject({ institution: 'SDU University', degree: 'Computer science', details: 'GPA 3.65' });
    await s.client.upload('/api/cv', makePdf(['Aigerim - Data Analyst', 'Software Engineer, Acme 2021 - 2023', 'Skills: Python, SQL, Docker']), 'cv.pdf', 'application/pdf');
    const cv = await newDoc(s.client, { from: 'cv', title: 'From CV' });
    expect(cv.data.skills[0].items).toEqual(expect.arrayContaining(['Docker', 'Python', 'SQL']));
    expect(cv.data.experience.length).toBeGreaterThan(0);
    await s.client.post('/api/resume/import', { demo: true }).catch(() => undefined);
    const list = await s.client.get('/api/resume-docs');
    expect(list.body.docs).toHaveLength(3);
    expect(list.body.max).toBe(5);
    expect(list.body.docs[0]).not.toHaveProperty('data');
  });
  it('validates meta; limit of 5 holds even under concurrent creates; unknown fields rejected', async () => {
    const s = await makeStudent();
    expect(err(await s.client.post('/api/resume-docs', { title: '' })).fields.title).toBe('REQUIRED');
    expect(err(await s.client.post('/api/resume-docs', { title: 'x', template: 'fancy' })).fields.template).toBe('RESUME_FIELD_INVALID');
    expect(err(await s.client.post('/api/resume-docs', { title: 'x', from: 'magic' })).fields.from).toBe('RESUME_FIELD_INVALID');
    expect(err(await s.client.post('/api/resume-docs', { title: 'x', userId: 'z' })).code).toBe('UNKNOWN_FIELDS');
    await s.client.ensureCsrf();
    const rs = await Promise.all(Array.from({ length: 9 }, (_, i) => s.client.post('/api/resume-docs', { title: `Doc ${i}`, from: 'blank' })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 409).every((r) => err(r).code === 'RESUME_DOC_LIMIT')).toBe(true);
  });
  it('is private: other students, employers and anonymous users get nothing', async () => {
    const a = await makeStudent(), b = await makeStudent(), e = await makeEmployer();
    const d = await newDoc(a.client);
    expect((await b.client.get(`/api/resume-docs/${d.id}`)).status).toBe(404);
    expect((await b.client.get('/api/resume-docs')).body.docs).toEqual([]);
    expect((await e.client.get('/api/resume-docs')).status).toBe(403);
    expect((await new Client().get('/api/resume-docs')).status).toBe(401);
    for (const [m, p] of [['put', ''], ['delete', ''], ['get', '/versions'], ['get', '/review'], ['get', '/export.docx'], ['post', '/share'], ['post', '/restore']] as const) {
      const body = m === 'put' ? { baseVersion: 1, title: 'hacked' } : p === '/share' ? { enabled: true } : p === '/restore' ? { version: 1, baseVersion: 1 } : undefined;
      const r = await (b.client as any)[m](`/api/resume-docs/${d.id}${p}`, body);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
    expect((await a.client.get('/api/resume-docs/not-a-uuid')).status).toBe(404);
    expect((await a.client.get(`/api/resume-docs/${d.id}`)).body.doc.title).toBe('My résumé');
  });
});

describe('saving', () => {
  it('stores validated data, bumps the version, and reports field errors by path', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    const ok = await save(s.client, d.id, 1, { data: DOC(), title: 'Final', template: 'modern', language: 'ru' });
    expect(ok.status).toBe(200);
    expect(ok.body.doc).toMatchObject({ version: 2, title: 'Final', template: 'modern', language: 'ru' });
    expect(ok.body.doc.data.experience[0].company).toBe('Acme & Sons <Ltd>'); // stored as inert text
    const bad = await save(s.client, d.id, 2, { data: DOC({ experience: [{ role: 'x', start: '2024-13' }], personal: { fullName: '', email: 'nope', links: [{ label: 'a', url: 'javascript:alert(1)' }] } }) });
    expect(bad.status).toBe(400);
    expect(err(bad).fields).toMatchObject({ 'experience.0.start': 'RESUME_DATE_INVALID', 'personal.fullName': 'REQUIRED', 'personal.email': 'EMAIL_INVALID', 'personal.links.0.url': 'RESUME_URL_INVALID' });
    expect((await s.client.get(`/api/resume-docs/${d.id}`)).body.doc.version).toBe(2); // a rejected save changes nothing
    expect((await save(s.client, d.id, 2, { title: 'Only title' })).body.doc.data.experience).toHaveLength(1); // meta-only save keeps data
  });
  it('rejects malformed requests', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    for (const body of [{}, { baseVersion: '1' }, { baseVersion: 0 }, { baseVersion: 1.5 }, { baseVersion: 1, extra: 1 }, { baseVersion: 1, data: 'x' }, { baseVersion: 1, template: 'x' }, { baseVersion: 1, title: '' }]) {
      expect((await s.client.put(`/api/resume-docs/${d.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await s.client.put(`/api/resume-docs/${d.id}`, [] as never)).status).toBe(400);
    expect((await s.client.json('PUT', `/api/resume-docs/${d.id}`, undefined, { rawBody: '{bad' })).status).toBe(400);
    expect((await s.client.json('PUT', `/api/resume-docs/${d.id}`, { baseVersion: 1, data: DOC() }, { csrf: null })).status).toBe(403);
    expect((await s.client.put('/api/resume-docs/00000000-0000-4000-8000-000000000000', { baseVersion: 1, title: 'x' })).status).toBe(404);
  });
  it('optimistic concurrency: a stale base version is refused (409), concurrent saves → exactly one wins', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    expect((await save(s.client, d.id, 1, { title: 'A' })).status).toBe(200);
    const stale = await save(s.client, d.id, 1, { title: 'B' });
    expect(stale.status).toBe(409);
    expect(err(stale).code).toBe('RESUME_CONFLICT');
    expect((await s.client.get(`/api/resume-docs/${d.id}`)).body.doc.title).toBe('A');
    await s.client.ensureCsrf();
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => save(s.client, d.id, 2, { title: `race ${i}` })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    expect((await s.client.get(`/api/resume-docs/${d.id}`)).body.doc.version).toBe(3);
  });
  it('payloads over the API body limit are refused cleanly', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    const r = await s.client.put(`/api/resume-docs/${d.id}`, { baseVersion: 1, data: { personal: { fullName: 'A' }, summary: 'x'.repeat(70_000) } });
    expect(r.status).toBe(413);
  });
  it('delete removes the document and its versions; the student account deletion cascades', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    await save(s.client, d.id, 1, { title: 'v2' });
    expect(await sql('SELECT 1 FROM resume_versions')).toHaveLength(2);
    expect((await s.client.delete(`/api/resume-docs/${d.id}`)).status).toBe(200);
    expect(await sql('SELECT 1 FROM resume_versions')).toHaveLength(0);
    expect((await s.client.delete(`/api/resume-docs/${d.id}`)).status).toBe(404);
    await newDoc(s.client); await newDoc(s.client);
    expect((await s.client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' })).status).toBe(200);
    expect(await sql('SELECT 1 FROM resume_docs')).toHaveLength(0);
    expect(await sql('SELECT 1 FROM resume_versions')).toHaveLength(0);
  });
});

describe('version history', () => {
  it('keeps the latest 20 versions, lists newest first, and restoring creates a NEW version with the old content', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    let v = 1;
    for (let i = 0; i < 24; i++) { const r = await save(s.client, d.id, v, { data: DOC({ summary: `Summary number ${i}` }) }); expect(r.status).toBe(200); v = r.body.doc.version; }
    expect(v).toBe(25);
    const list = (await s.client.get(`/api/resume-docs/${d.id}/versions`)).body;
    expect(list.versions).toHaveLength(20);
    expect(list.versions[0].version).toBe(25);
    expect(list.versions.at(-1).version).toBe(6);
    expect(list.current).toBe(25);
    const old = await s.client.post(`/api/resume-docs/${d.id}/restore`, { version: 10, baseVersion: 25 });
    expect(old.status).toBe(200);
    expect(old.body.doc.version).toBe(26);
    expect(old.body.doc.data.summary).toBe('Summary number 8'); // version 10 = save #9 = i 8
    expect((await s.client.post(`/api/resume-docs/${d.id}/restore`, { version: 2, baseVersion: 26 })).status).toBe(404); // pruned
    expect((await s.client.post(`/api/resume-docs/${d.id}/restore`, { version: 10, baseVersion: 25 })).status).toBe(409); // stale
    expect((await s.client.post(`/api/resume-docs/${d.id}/restore`, { version: 'x', baseVersion: 26 })).status).toBe(400);
  });
});

describe('sharing', () => {
  it('public link: unauthenticated, unlisted, contact hidden by default, revocable, rotatable', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    await save(s.client, d.id, 1, { data: DOC() });
    const anon = new Client();
    const shared = await s.client.post(`/api/resume-docs/${d.id}/share`, { enabled: true });
    const slug = shared.body.doc.publicSlug as string;
    expect(slug).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    const pub = await anon.get(`/api/public/resume/${slug}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('x-robots-tag')).toContain('noindex');
    expect(pub.body.resume.data.personal).toMatchObject({ fullName: 'Aigerim Nurlanova', email: '', phone: '' });
    expect(JSON.stringify(pub.body)).not.toContain('aigerim@example.com');
    expect(JSON.stringify(pub.body)).not.toContain(s.payload.studentId);
    expect(pub.body.resume).not.toHaveProperty('id');
    expect((await s.client.post(`/api/resume-docs/${d.id}/share`, { enabled: true, showContact: true })).body.doc.publicSlug).toBe(slug); // idempotent
    expect((await anon.get(`/api/public/resume/${slug}`)).body.resume.data.personal.email).toBe('aigerim@example.com');
    const rot = (await s.client.post(`/api/resume-docs/${d.id}/share`, { enabled: true, rotate: true })).body.doc.publicSlug;
    expect(rot).not.toBe(slug);
    expect((await anon.get(`/api/public/resume/${slug}`)).status).toBe(404);
    expect((await anon.get(`/api/public/resume/${rot}`)).status).toBe(200);
    await s.client.post(`/api/resume-docs/${d.id}/share`, { enabled: false });
    expect((await anon.get(`/api/public/resume/${rot}`)).status).toBe(404);
    const after = (await s.client.get(`/api/resume-docs/${d.id}`)).body.doc;
    expect(after).toMatchObject({ publicSlug: null, publicContact: false });
  });
  it('rejects junk slugs, malformed share bodies, and is rate limited', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    const anon = new Client();
    for (const slug of ['short', 'x'.repeat(65), '../../etc/passwd', 'a b c d e f g h i j k l', "'; DROP TABLE users;--"]) expect((await anon.get(`/api/public/resume/${encodeURIComponent(slug)}`)).status).toBe(404);
    for (const body of [{}, { enabled: 'yes' }, { enabled: true, showContact: 1 }, { enabled: true, x: 1 }]) expect((await s.client.post(`/api/resume-docs/${d.id}/share`, body)).status).toBe(400);
    let last = 0;
    for (let i = 0; i < 65; i++) last = (await anon.get('/api/public/resume/AAAAAAAAAAAAAAAAAAAAAA')).status;
    expect(last).toBe(429);
  });
  it('deleting a shared document kills the link', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    const slug = (await s.client.post(`/api/resume-docs/${d.id}/share`, { enabled: true })).body.doc.publicSlug;
    await s.client.delete(`/api/resume-docs/${d.id}`);
    expect((await new Client().get(`/api/public/resume/${slug}`)).status).toBe(404);
  });
});

describe('DOCX export', () => {
  it('produces a valid package that our own parser reads back (round trip), with XML-escaped text', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    await save(s.client, d.id, 1, { data: DOC({ summary: 'Line one\nLine two <b>&</b>' }), title: 'Мое резюме / CV' });
    const r = await s.client.download(`/api/resume-docs/${d.id}/export.docx`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('wordprocessingml.document');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.docx"; filename\*=UTF-8''/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    const files = unzipSync(r.bytes);
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('Acme &amp; Sons &lt;Ltd&gt;');
    expect(xml).not.toContain('<Ltd>');
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*<b>/);
    const parsed = await parseCv(r.bytes);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.text).toContain('Aigerim Nurlanova');
      expect(parsed.text).toContain('Acme & Sons <Ltd>');
      expect(parsed.text).toContain('• Built 12 dashboards used by 40 analysts');
      expect(parsed.text).toContain('EXPERIENCE');
      expect(parsed.text).toContain('Present');
      expect(parsed.text).toContain('Python, SQL, Docker');
    }
  });
  it('localises section headings; empty sections are omitted; weird titles produce a safe filename', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client, { language: 'ru', title: '../../etc/passwd"\r\nX-Evil: 1' });
    await save(s.client, d.id, 1, { data: DOC({ projects: [], languages: [], certificates: [] }) });
    const r = await s.client.download(`/api/resume-docs/${d.id}/export.docx`);
    expect(r.headers.get('content-disposition')).not.toMatch(/[\r\n]/);
    expect(r.headers.get('content-disposition')).toMatch(/filename="[A-Za-z0-9._-]+\.docx"/);
    const parsed = await parseCv(r.bytes);
    expect(parsed.ok && parsed.text).toContain('ОПЫТ РАБОТЫ');
    expect(parsed.ok && parsed.text).toContain('по настоящее время');
    expect(parsed.ok && parsed.text).not.toContain('СЕРТИФИКАТЫ');
  });
  it('a blank document still exports', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    const parsed = await parseCv((await s.client.download(`/api/resume-docs/${d.id}/export.docx`)).bytes);
    expect(parsed.ok && parsed.text).toContain('Aigerim Nurlanova');
  });
});

describe('review', () => {
  it('returns a deterministic score with positioned issues', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    const weak = (await s.client.get(`/api/resume-docs/${d.id}/review`)).body;
    expect(weak.score).toBeLessThan(60);
    expect(weak.issues.map((i: any) => i.issue)).toEqual(expect.arrayContaining(['no_summary', 'no_experience', 'few_skills']));
    await save(s.client, d.id, 1, { data: DOC() });
    const better = (await s.client.get(`/api/resume-docs/${d.id}/review`)).body;
    expect(better.score).toBeGreaterThan(weak.score);
    expect(better.strengths).toContain('quantified');
    expect((await s.client.get(`/api/resume-docs/${d.id}/review`)).body).toEqual(better);
  });
});

describe('AI assistance', () => {
  const consent = (c: Client) => c.put('/api/ai/consent', { accept: true });
  it('requires consent', async () => {
    const s = await makeStudent();
    const d = await newDoc(s.client);
    fake({ text: 'Built dashboards for analysts' });
    expect(err(await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'Did dashboards for analysts', mode: 'stronger' })).code).toBe('AI_CONSENT_REQUIRED');
    expect(err(await s.client.post(`/api/resume-docs/${d.id}/ai/tailor`, { vacancyId: 'x' })).code).toBe('AI_CONSENT_REQUIRED');
    expect(calls).toHaveLength(0);
  });
  it('rewrite: returns a validated line; never sends the name; AI-only (503 without provider)', async () => {
    const s = await makeStudent(); await consent(s.client);
    const d = await newDoc(s.client);
    expect(err(await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'Did dashboards for analysts', mode: 'stronger' })).code).toBe('AI_UNAVAILABLE');
    fake({ text: 'Built dashboards that analysts use daily' });
    const r = await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'Did dashboards for analysts, contact aigerim@example.com', mode: 'stronger', context: 'Data intern at Acme' });
    expect(r.status).toBe(200);
    expect(r.body.text).toBe('Built dashboards that analysts use daily');
    expect(calls[0].user).not.toContain('aigerim@example.com');
    expect(calls[0].user).toMatch(/<<<BULLET[\s\S]*BULLET>>>/);
  });
  it('rewrite: refuses invented numbers, links and over-long output (→ 503 after one retry), accepts numbers from the original', async () => {
    const s = await makeStudent(); await consent(s.client);
    const d = await newDoc(s.client);
    for (const bad of [{ text: 'Increased sales by 300%' }, { text: 'Built tools, see https://evil.example' }, { text: 'x' }, { nope: 1 }]) {
      fake(bad);
      expect((await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'Built 12 dashboards for analysts', mode: 'stronger' })).status).toBe(503);
      expect(calls).toHaveLength(2);
    }
    fake({ text: 'Delivered 12 dashboards for analysts' });
    expect((await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'Built 12 dashboards for analysts', mode: 'shorter' })).body.text).toBe('Delivered 12 dashboards for analysts');
  });
  it('rewrite: validates input; other users cannot rewrite in my document context', async () => {
    const s = await makeStudent(), o = await makeStudent(); await consent(s.client); await consent(o.client);
    const d = await newDoc(s.client);
    fake({ text: 'Built dashboards' });
    for (const body of [{ text: 'tiny', mode: 'stronger' }, { text: 'x'.repeat(241), mode: 'stronger' }, { text: 'valid text here', mode: 'evil' }, { text: 'valid text here', mode: 'stronger', extra: 1 }, { mode: 'stronger' }]) expect((await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, body)).status, JSON.stringify(body)).toBe(400);
    expect((await o.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'valid text here', mode: 'stronger' })).status).toBe(404);
  });
  it('rewrite: daily AI limit → 429', async () => {
    const s = await makeStudent(); await consent(s.client);
    const d = await newDoc(s.client);
    testEnv.AI_USER_DAILY = '1';
    fake({ text: 'Built dashboards for analysts' });
    expect((await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'Did dashboards for analysts', mode: 'stronger' })).status).toBe(200);
    const r = await s.client.post(`/api/resume-docs/${d.id}/ai/rewrite`, { text: 'Did dashboards for others', mode: 'stronger' });
    expect(r.status).toBe(429);
    expect(err(r).code).toBe('AI_LIMIT');
  });

  async function published() {
    const emp = await makeEmployer();
    const v = await emp.client.post('/api/vacancies', vacancyPayload({ requiredSkills: ['Python', 'SQL', 'React', 'Kubernetes'], title: 'Full stack intern' }));
    await emp.client.post(`/api/vacancies/${v.body.vacancy.id}/publish`);
    return v.body.vacancy.id as string;
  }
  it('tailor: deterministic keyword gap always; AI suggestion only if it does not claim missing skills', async () => {
    const s = await makeStudent(); await consent(s.client);
    const d = await newDoc(s.client);
    await save(s.client, d.id, 1, { data: DOC() });
    const vid = await published();
    const rules = await s.client.post(`/api/resume-docs/${d.id}/ai/tailor`, { vacancyId: vid });
    expect(rules.status).toBe(200);
    expect(rules.body).toMatchObject({ gap: { present: ['Python', 'SQL'], missing: ['Kubernetes', 'React'] }, suggestion: null, source: 'rules' });
    fake({ summary: 'Analyst with Python and SQL ready to contribute to a full stack team.', tips: ['Add a project that uses a web framework'] });
    const ai = await s.client.post(`/api/resume-docs/${d.id}/ai/tailor`, { vacancyId: vid });
    expect(ai.body).toMatchObject({ source: 'ai', suggestion: { summary: expect.stringContaining('Python'), tips: ['Add a project that uses a web framework'] } });
    expect(calls[0].user).toContain('never claim any of these missing skills');
    expect(calls[0].user).not.toContain('aigerim@example.com');
    fake({ summary: 'Expert in React and Kubernetes with Python.', tips: ['x'.repeat(10)] });
    const lie = await s.client.post(`/api/resume-docs/${d.id}/ai/tailor`, { vacancyId: vid, language: 'ru' }); // different prompt → not served from cache
    expect(lie.body).toMatchObject({ source: 'rules', suggestion: null, gap: { missing: ['Kubernetes', 'React'] } });
    expect(calls).toHaveLength(2); // retried once, still refused, fell back to the deterministic gap
  });
  it('tailor: unknown/unpublished vacancy and bad bodies', async () => {
    const s = await makeStudent(); await consent(s.client);
    const d = await newDoc(s.client);
    expect((await s.client.post(`/api/resume-docs/${d.id}/ai/tailor`, { vacancyId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await s.client.post(`/api/resume-docs/${d.id}/ai/tailor`, {})).status).toBe(400);
    expect((await s.client.post(`/api/resume-docs/${d.id}/ai/tailor`, { vacancyId: 'x', evil: 1 })).status).toBe(400);
  });
});

describe('non-regression', () => {
  it('new endpoints are reachable only with a session + CSRF, and the app still serves the old résumé routes', async () => {
    const s = await makeStudent();
    expect((await new Client().json('POST', '/api/resume-docs', { title: 'x' }, { csrf: null })).status).toBe(403); // CSRF first, then auth
    const anon = new Client();
    await anon.ensureCsrf();
    expect((await anon.post('/api/resume-docs', { title: 'x' })).status).toBe(401);
    expect((await s.client.get('/api/resume')).status).toBe(200);
    const r = await app.request('http://localhost/api/health', {}, testEnv);
    expect(r.status).toBe(200);
  });
});
