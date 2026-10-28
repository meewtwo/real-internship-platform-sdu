import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { Db } from '../src/lib/db';
import type { BucketLike } from '../src/env';
import { processJob } from '../src/services/jobs';
import { Client, makeEmployer, makePdf, makeStudent, resetDb, setProfile, sql, testEnv, vacancyPayload, seedSkills } from './helpers';

class FakeBucket implements BucketLike {
  objects = new Map<string, Uint8Array>();
  failPut = false; failDelete = false; missingGet = false;
  async put(key: string, value: ArrayBuffer | Uint8Array) { if (this.failPut) throw new Error('r2 down'); this.objects.set(key, new Uint8Array(value)); }
  async get(key: string) { const v = this.objects.get(key); return v && !this.missingGet ? { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer } : null; }
  async delete(key: string) { if (this.failDelete) throw new Error('r2 delete failed'); this.objects.delete(key); }
}
let bucket: FakeBucket;
beforeEach(async () => { await resetDb(); await seedSkills('Python', 'SQL'); bucket = new FakeBucket(); });
afterEach(() => { delete testEnv.CV_BUCKET; delete testEnv.JOBS; });

const CV = ['Aigerim Nurlanova - Data Analyst', 'Software Engineer, Acme 2021 - 2023', 'Skills: Python, SQL'];
const cvRow = async () => (await sql<{ content: Buffer | null; storage_key: string | null; size_bytes: number }>('SELECT content, storage_key, size_bytes FROM cvs'))[0];
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describe('CV files in R2', () => {
  it('upload stores the file in the bucket (not the DB); download returns identical bytes with the same safe headers', async () => {
    testEnv.CV_BUCKET = bucket;
    const s = await makeStudent();
    const pdf = makePdf(CV);
    expect((await s.client.upload('/api/cv', pdf, 'my cv.pdf', 'application/pdf')).status).toBe(201);
    const row = await cvRow();
    expect(row.content).toBeNull();
    expect(row.storage_key).toMatch(/^cv\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16}$/);
    expect(bucket.objects.size).toBe(1);
    const d = await s.client.download('/api/cv/file');
    expect(d.status).toBe(200);
    expect(sameBytes(d.bytes, pdf)).toBe(true);
    expect(d.headers.get('content-type')).toBe('application/pdf');
    expect(d.headers.get('x-content-type-options')).toBe('nosniff');
    expect(d.headers.get('cache-control')).toBe('private, no-store');
    expect((await s.client.get('/api/cv')).body.cv.skills).toEqual(['Python', 'SQL']); // text extraction is unaffected
  });
  it('without the binding everything stays in the database (default behaviour unchanged)', async () => {
    const s = await makeStudent();
    await s.client.upload('/api/cv', makePdf(CV), 'a.pdf', 'application/pdf');
    expect(await cvRow()).toMatchObject({ storage_key: null });
    expect((await cvRow()).content).not.toBeNull();
  });
  it('replacing a CV removes the previous object; deleting the CV removes the object', async () => {
    testEnv.CV_BUCKET = bucket;
    const s = await makeStudent();
    await s.client.upload('/api/cv', makePdf(CV), 'a.pdf', 'application/pdf');
    const first = (await cvRow()).storage_key!;
    await s.client.upload('/api/cv', makePdf([...CV, 'Docker']), 'b.pdf', 'application/pdf');
    expect(bucket.objects.has(first)).toBe(false);
    expect(bucket.objects.size).toBe(1);
    expect((await s.client.delete('/api/cv')).status).toBe(200);
    expect(bucket.objects.size).toBe(0);
  });
  it('account deletion removes the files too', async () => {
    testEnv.CV_BUCKET = bucket;
    const s = await makeStudent();
    await s.client.upload('/api/cv', makePdf(CV), 'a.pdf', 'application/pdf');
    expect(bucket.objects.size).toBe(1);
    expect((await s.client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' })).status).toBe(200);
    expect(bucket.objects.size).toBe(0);
    expect(await sql('SELECT 1 FROM cvs')).toHaveLength(0);
  });
  it('a failed upload to R2 creates no DB row; a failed DB write cleans the object; delete failures never break the request', async () => {
    testEnv.CV_BUCKET = bucket;
    const s = await makeStudent();
    bucket.failPut = true;
    expect((await s.client.upload('/api/cv', makePdf(CV), 'a.pdf', 'application/pdf')).status).toBe(500);
    expect(await sql('SELECT 1 FROM cvs')).toHaveLength(0);
    bucket.failPut = false;
    await s.client.upload('/api/cv', makePdf(CV), 'a.pdf', 'application/pdf');
    bucket.failDelete = true;
    expect((await s.client.delete('/api/cv')).status).toBe(200); // object may be orphaned, the user's request still succeeds
    expect(await sql('SELECT 1 FROM cvs')).toHaveLength(0);
  });
  it('the employer can download an applicant’s CV from R2; withdrawn/foreign access is still refused', async () => {
    testEnv.CV_BUCKET = bucket;
    const emp = await makeEmployer(), other = await makeEmployer(), s = await makeStudent();
    await setProfile(s.client, { skills: ['Python'] });
    const pdf = makePdf(CV);
    await s.client.upload('/api/cv', pdf, 'a.pdf', 'application/pdf');
    const v = (await emp.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    await emp.client.post(`/api/vacancies/${v}/publish`);
    const appId = (await s.client.post(`/api/vacancies/${v}/apply`)).body.application.id;
    const ok = await emp.client.download(`/api/applications/${appId}/cv`);
    expect(ok.status).toBe(200);
    expect(sameBytes(ok.bytes, pdf)).toBe(true);
    expect((await other.client.download(`/api/applications/${appId}/cv`)).status).toBe(404);
    await s.client.post(`/api/applications/${appId}/withdraw`);
    expect((await emp.client.download(`/api/applications/${appId}/cv`)).status).toBe(404);
  });
  it('old DB-stored CVs keep working after R2 is enabled; a missing object or removed binding is a clean 404, not a crash', async () => {
    const s = await makeStudent();
    const pdf = makePdf(CV);
    await s.client.upload('/api/cv', pdf, 'a.pdf', 'application/pdf'); // stored in DB
    testEnv.CV_BUCKET = bucket;
    expect(sameBytes((await s.client.download('/api/cv/file')).bytes, pdf)).toBe(true);
    await s.client.upload('/api/cv', pdf, 'b.pdf', 'application/pdf'); // now in R2
    bucket.missingGet = true;
    expect((await s.client.download('/api/cv/file')).status).toBe(404);
    bucket.missingGet = false;
    delete testEnv.CV_BUCKET;
    expect((await s.client.download('/api/cv/file')).status).toBe(404);
  });
  it('the DB constraint refuses a row with neither bytes nor an object key', async () => {
    const s = await makeStudent();
    await s.client.upload('/api/cv', makePdf(CV), 'a.pdf', 'application/pdf');
    await expect(sql('UPDATE cvs SET content = NULL')).rejects.toThrow(/cvs_storage_chk/);
  });
});

describe('large CVs without R2 (stored in parts in the database)', () => {
  /** A real DOCX of ~1.6 MB: the text plus an incompressible "photo", stored uncompressed so the size is what D1 has to hold. */
  const bigDocx = (lines: string[], bytes = 1_600_000) => {
    const photo = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i += 65536) crypto.getRandomValues(photo.subarray(i, Math.min(i + 65536, bytes)));
    const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
    return zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), 'word/document.xml': strToU8(xml), 'word/media/image1.png': [photo, { level: 0 }] });
  };
  const chunks = () => sql<{ seq: number; len: number }>('SELECT seq, length(data) AS len FROM cv_chunks ORDER BY seq');

  it('a 1–2 MB file is accepted, split into ≤ 1 MB parts, and downloaded byte-identical by the student and the employer', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    const docx = bigDocx(CV);
    expect(docx.length).toBeGreaterThan(1_000_000);
    const up = await s.client.upload('/api/cv', docx, 'cv.docx');
    expect(up.status).toBe(201);
    expect(up.body.cv).toMatchObject({ size: docx.length, skills: ['Python', 'SQL'] });
    expect(await cvRow()).toMatchObject({ content: null, storage_key: 'd1-chunks', size_bytes: docx.length });
    expect((await chunks()).map((c) => c.len)).toEqual([1_000_000, docx.length - 1_000_000]);
    expect(sameBytes((await s.client.download('/api/cv/file')).bytes, docx)).toBe(true);
    const v = (await emp.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id;
    await emp.client.post(`/api/vacancies/${v}/publish`);
    const appId = (await s.client.post(`/api/vacancies/${v}/apply`)).body.application.id;
    expect((await emp.client.get(`/api/vacancies/${v}/applicants`)).body.applicants[0].student.hasCv).toBe(true);
    expect(sameBytes((await emp.client.download(`/api/applications/${appId}/cv`)).bytes, docx)).toBe(true);
  });
  it('replacing with a small file drops the old parts; a missing part is a 404, never a truncated file; parts go with the CV and the account', async () => {
    const s = await makeStudent();
    await s.client.upload('/api/cv', bigDocx(CV), 'cv.docx');
    expect(await chunks()).toHaveLength(2);
    await s.client.upload('/api/cv', makePdf(CV), 'a.pdf', 'application/pdf');
    expect(await chunks()).toHaveLength(0);
    expect((await cvRow()).content).not.toBeNull();
    await s.client.upload('/api/cv', bigDocx(CV), 'cv.docx');
    await sql('DELETE FROM cv_chunks WHERE seq = 1');
    expect((await s.client.download('/api/cv/file')).status).toBe(404);
    await s.client.upload('/api/cv', bigDocx(CV), 'cv.docx');
    expect((await s.client.delete('/api/cv')).status).toBe(200);
    expect(await chunks()).toHaveLength(0);
    await s.client.upload('/api/cv', bigDocx(CV), 'cv.docx');
    expect((await s.client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' })).status).toBe(200);
    expect(await chunks()).toHaveLength(0);
  });
});

describe('background jobs (queue)', () => {
  class FakeQueue { sent: unknown[] = []; fail = false; async send(m: unknown) { if (this.fail) throw new Error('queue down'); this.sent.push(m); } }
  async function setup() {
    const emp = await makeEmployer();
    const stu = await makeStudent();
    await setProfile(stu.client, { skills: ['Python', 'SQL'] });
    await stu.client.post('/api/saved-searches', { name: 'py', filters: { q: 'python' } });
    const v = (await emp.client.post('/api/vacancies', vacancyPayload())).body.vacancy.id as string;
    return { emp, stu, v };
  }
  const db = () => new Db(testEnv);
  const notifs = async (kind: string) => (await sql(`SELECT 1 FROM notifications WHERE kind = '${kind}'`)).length;

  it('without a queue publish matches inline (unchanged); with a queue it only enqueues and flags the response', async () => {
    const { emp, v } = await setup();
    const r = await emp.client.post(`/api/vacancies/${v}/publish`);
    expect(r.body).toMatchObject({ queued: false });
    expect(r.body.matches).toBeGreaterThan(0);
    const q = new FakeQueue(); testEnv.JOBS = q;
    const emp2 = await makeEmployer();
    const v2 = (await emp2.client.post('/api/vacancies', vacancyPayload({ title: 'Second Python intern' }))).body.vacancy.id;
    const before = await sql('SELECT 1 FROM matches');
    const r2 = await emp2.client.post(`/api/vacancies/${v2}/publish`);
    expect(r2.body).toMatchObject({ queued: true, matches: 0, vacancy: { status: 'published' } });
    expect(q.sent).toEqual([{ type: 'match_vacancy', vacancyId: v2 }]);
    expect(await sql('SELECT 1 FROM matches')).toEqual(before); // nothing matched yet
    expect((await sql(`SELECT meta FROM audit_log WHERE action = 'vacancy.publish' ORDER BY id DESC LIMIT 1`))[0].meta).toMatchObject({ queued: true });
  });
  it('the consumer creates matches and notifications; redelivery (at-least-once) never duplicates them', async () => {
    const { emp, stu, v } = await setup();
    testEnv.JOBS = new FakeQueue();
    await emp.client.post(`/api/vacancies/${v}/publish`);
    expect(await notifs('new_match')).toBe(0);
    expect(await processJob(db(), testEnv, { type: 'match_vacancy', vacancyId: v })).toBe('done');
    const matches = (await sql('SELECT 1 FROM matches')).length, nm = await notifs('new_match'), ss = await notifs('saved_search');
    expect(matches).toBeGreaterThan(0);
    expect(nm + ss).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) await processJob(db(), testEnv, { type: 'match_vacancy', vacancyId: v });
    expect((await sql('SELECT 1 FROM matches')).length).toBe(matches);
    expect(await notifs('new_match')).toBe(nm);
    expect(await notifs('saved_search')).toBe(ss);
    expect(((await stu.client.get(`/api/vacancies/${v}`)).body.match.percent)).toBeGreaterThan(0);
  });
  it('concurrent deliveries of the same job do not duplicate notifications either', async () => {
    const { emp, v } = await setup();
    testEnv.JOBS = new FakeQueue();
    await emp.client.post(`/api/vacancies/${v}/publish`);
    await Promise.all([1, 2, 3].map(() => processJob(db(), testEnv, { type: 'match_vacancy', vacancyId: v }).catch(() => 'error')));
    await processJob(db(), testEnv, { type: 'match_vacancy', vacancyId: v });
    const rows = await sql<{ user_id: string; kind: string }>(`SELECT user_id, kind FROM notifications WHERE kind IN ('new_match', 'saved_search')`);
    const uniq = new Set(rows.map((r) => `${r.user_id}:${r.kind}`));
    expect(rows.length).toBe(uniq.size);
  });
  it('ignores malformed jobs, unknown types, missing, closed and draft vacancies', async () => {
    const { emp, v } = await setup();
    for (const bad of [null, undefined, 5, 'x', [], {}, { type: 'other' }, { type: 'match_vacancy' }, { type: 'match_vacancy', vacancyId: 'nope' }, { type: 'match_vacancy', vacancyId: '00000000-0000-4000-8000-000000000000' }, { type: 'match_vacancy', vacancyId: v }]) {
      expect(await processJob(db(), testEnv, bad), JSON.stringify(bad)).toBe('skipped'); // v is still a draft
    }
    testEnv.JOBS = new FakeQueue(); // queued publish: no inline matching
    await emp.client.post(`/api/vacancies/${v}/publish`);
    await emp.client.post(`/api/vacancies/${v}/close`);
    expect(await processJob(db(), testEnv, { type: 'match_vacancy', vacancyId: v })).toBe('skipped');
    expect(await sql('SELECT 1 FROM matches')).toHaveLength(0);
  });
  it('if the queue is down at publish time the work is done inline so the vacancy is never left unmatched', async () => {
    const { emp, v } = await setup();
    const q = new FakeQueue(); q.fail = true; testEnv.JOBS = q;
    const r = await emp.client.post(`/api/vacancies/${v}/publish`);
    expect(r.status).toBe(200);
    expect((await sql('SELECT 1 FROM matches')).length).toBeGreaterThan(0);
  });
  it('a publish raced by several requests enqueues exactly one job', async () => {
    const { emp, v } = await setup();
    const q = new FakeQueue(); testEnv.JOBS = q;
    await emp.client.ensureCsrf();
    const rs = await Promise.all([1, 2, 3, 4].map(() => emp.client.post(`/api/vacancies/${v}/publish`)));
    expect(rs.every((r: { status: number }) => r.status === 200)).toBe(true);
    expect(q.sent).toHaveLength(1);
  });
  it('re-matching is stable after a student changes skills (the job rebuilds, not appends)', async () => {
    const { emp, stu, v } = await setup();
    testEnv.JOBS = new FakeQueue();
    await emp.client.post(`/api/vacancies/${v}/publish`);
    await processJob(db(), testEnv, { type: 'match_vacancy', vacancyId: v });
    const before = (await sql<{ percent: number }>('SELECT percent FROM matches'))[0].percent;
    await setProfile(stu.client, { skills: [] });
    await processJob(db(), testEnv, { type: 'match_vacancy', vacancyId: v });
    const rows = await sql<{ percent: number }>('SELECT percent FROM matches');
    expect(rows.length).toBeLessThanOrEqual(1);
    if (rows.length) expect(rows[0].percent).toBeLessThan(before);
  });
});
