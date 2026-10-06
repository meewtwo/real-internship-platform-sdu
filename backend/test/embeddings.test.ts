import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/lib/db';
import { backfillEmbeddings, getEmbedder, setEmbedder, studentText, vacancyText, type Embedder } from '../src/services/embeddings';
import { runScheduled } from '../src/services/scheduled';
import { processJob } from '../src/services/jobs';
import { Client, makeAdmin, makeEmployer, makePdf, makeStudent, resetDb, setProfile, sql, testEnv, vacancyPayload, seedSkills } from './helpers';

// A tiny deterministic "semantic" model: concepts are dimensions, words in ANY language that express a concept light that dimension.
const CONCEPTS: string[][] = [
  ['machine learning', 'машинное обучение', 'нейросет', 'neural', 'ml '], ['data', 'данн', 'analytics', 'аналитик'], ['marketing', 'маркетинг', 'smm', 'реклам'],
  ['finance', 'финанс', 'banking', 'банк'], ['web', 'react', 'frontend', 'javascript'], ['security', 'безопасност', 'cyber'], ['teaching', 'преподав', 'education', 'образован'], ['design', 'дизайн', 'figma'],
];
const embed = (t: string) => { const l = t.toLowerCase(); const v = CONCEPTS.map((ws) => ws.reduce((n, w) => n + (l.includes(w) ? 1 : 0), 0)); v[CONCEPTS.length] = 0.01; return v; };
let texts: string[][] = [];
function install(over: Partial<Embedder> = {}) { texts = []; setEmbedder({ model: 'fake-model', embed: async (t) => { texts.push(t); return t.map(embed); }, ...over }); }

beforeEach(async () => { await resetDb(); await seedSkills('Python', 'SQL', 'React', 'Machine Learning'); setEmbedder(null); texts = []; });
afterEach(() => { setEmbedder(null); delete testEnv.AI; delete testEnv.EMBED_API_KEY; delete testEnv.EMBED_BASE_URL; delete testEnv.EMBED_MODEL; delete testEnv.JOBS; });

const rows = (t: string) => sql<{ model: string; dim: number; content_hash: string }>(`SELECT model, dim, content_hash FROM ${t}`);
async function publish(emp: Awaited<ReturnType<typeof makeEmployer>>, over: Record<string, unknown> = {}) {
  const c = await emp.client.post('/api/vacancies', vacancyPayload(over));
  const id = c.body.vacancy.id as string;
  expect((await emp.client.post(`/api/vacancies/${id}/publish`)).status).toBe(200);
  return id;
}
const matchOf = async (c: Client, id: string) => (await c.get(`/api/vacancies/${id}`)).body.match;

describe('without an embedder nothing changes', () => {
  it('no rows, lexical matching, normal publish', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    await setProfile(s.client, { skills: ['Python'] });
    const id = await publish(emp);
    expect(await rows('vacancy_embeddings')).toHaveLength(0);
    expect(await rows('student_embeddings')).toHaveLength(0);
    expect((await matchOf(s.client, id)).textSource).toBe('lexical');
  });
});

describe('semantic pipeline', () => {
  const ML_VACANCY = { title: 'Machine Learning Engineer intern', description: 'Build neural networks and machine learning models for our data platform.', requiredSkills: ['Python', 'Machine Learning'] };

  it('embeds a vacancy on publish and a student on profile save; matching turns semantic and understands another language', async () => {
    const emp = await makeEmployer(), ru = await makeStudent(), plain = await makeStudent();
    await setProfile(ru.client, { skills: ['Python'], interestArea: 'data_ai' });
    await setProfile(plain.client, { skills: ['Python'], interestArea: 'data_ai' });
    await ru.client.upload('/api/cv', makePdf(['Opyt: mashinnoe obuchenie', 'Skills: Python', 'Experience 2022 - 2024 data engineer']), 'cv.pdf', 'application/pdf');
    const lexicalBefore = await (async () => { const id = await publish(emp, { ...ML_VACANCY, title: 'ML intern lexical probe' }); return (await matchOf(ru.client, id)).text; })();
    install();
    await setProfile(ru.client, { skills: ['Python'], interestArea: 'data_ai', interests: ['машинное обучение', 'нейросети'] }); // Russian-language interests
    await setProfile(plain.client, { skills: ['Python'], interestArea: 'data_ai', interests: ['маркетинг', 'реклама'] });
    const id = await publish(emp, ML_VACANCY);
    expect(await rows('vacancy_embeddings')).toEqual([{ model: 'fake-model', dim: CONCEPTS.length + 1, content_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(await rows('student_embeddings')).toHaveLength(2);
    const a = await matchOf(ru.client, id), b = await matchOf(plain.client, id);
    expect(a.textSource).toBe('semantic');
    expect(a.text).toBeGreaterThan(b.text);      // Russian "машинное обучение" ≈ English "machine learning"
    expect(a.percent).toBeGreaterThan(b.percent);
    expect(typeof lexicalBefore).toBe('number');
  });

  it('is incremental: unchanged content is never re-embedded; changed content is', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    install();
    await setProfile(s.client, { skills: ['Python'] });
    const first = texts.length;
    expect(first).toBeGreaterThan(0);
    await setProfile(s.client, { skills: ['Python'] });
    expect(texts.length).toBe(first);
    const h1 = (await rows('student_embeddings'))[0].content_hash;
    await setProfile(s.client, { skills: ['Python', 'SQL'] });
    expect(texts.length).toBe(first + 1);
    expect((await rows('student_embeddings'))[0].content_hash).not.toBe(h1);
    const id = await publish(emp, ML_VACANCY);
    const v = texts.length;
    const edited = await emp.client.put(`/api/vacancies/${id}`, vacancyPayload({ ...ML_VACANCY, description: 'Now we focus on web frontend work with React and javascript for customers.' }));
    expect(edited.status).toBe(200);
    expect(texts.length).toBe(v + 1);
    await emp.client.put(`/api/vacancies/${id}`, vacancyPayload({ ...ML_VACANCY, description: 'Now we focus on web frontend work with React and javascript for customers.' }));
    expect(texts.length).toBe(v + 1);
  });

  it('CV upload/delete, résumé about, AI-applied skills all refresh the student vector', async () => {
    const s = await makeStudent();
    install();
    await s.client.upload('/api/cv', makePdf(['Marketing manager 2020 - 2023', 'Skills: SMM']), 'cv.pdf', 'application/pdf');
    const n1 = texts.length; expect(n1).toBeGreaterThan(0);
    await s.client.delete('/api/cv');
    expect(texts.length).toBe(n1 + 1);
    await s.client.put('/api/ai/consent', { accept: true });
    await s.client.post('/api/ai/cv/apply-skills', { skills: ['Figma'] });
    expect(texts.length).toBe(n1 + 2);
  });

  it('never sends personal identifiers to the provider', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    install();
    await s.client.upload('/api/cv', makePdf(['Aigerim Nurlanova', 'Mail aigerim.n@gmail.com Phone +7 701 123 45 67 ID 230107001', 'Data analyst 2022 - 2024, Python']), 'cv.pdf', 'application/pdf');
    await publish(emp, { ...ML_VACANCY, description: 'Write to hr@acme-tech.kz or call +7 702 555 11 22 about this machine learning role.' });
    const all = texts.flat().join('\n');
    expect(all).not.toMatch(/Aigerim|Nurlanova|gmail|hr@acme|\+7 70|230107001|555 11 22/);
    expect(all).toContain('Data analyst');
  });

  it('text builders are bounded and redacted', () => {
    const t = studentText({ skills: ['Python'], cvSkills: [], interests: [], cvText: 'x'.repeat(10_000) + ' bob@example.com', majorKey: 'computer_science', interestArea: 'data_ai', city: 'almaty', cityOther: null, relocation: 'yes', gpa: 3, experienceYears: 0 }, ['Bob']);
    expect(t.length).toBeLessThanOrEqual(3000);
    expect(vacancyText({ title: 'T', skills: ['A'], description: 'mail me a@b.kz ' + 'y'.repeat(9000) }).length).toBeLessThanOrEqual(3000);
    expect(vacancyText({ title: 'T', skills: ['A'], description: 'mail me a@b.kz' })).not.toContain('a@b.kz');
  });

  it('provider failures and garbage never break saving/publishing; matching stays lexical', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    for (const bad of [async () => { throw new Error('model down'); }, async (t: string[]) => t.map(() => [NaN, 1]), async () => [], async (t: string[]) => t.map(() => [0, 0, 0]), async (t: string[]) => t.map(() => Array(5000).fill(1))]) {
      install({ embed: bad as never });
      expect((await s.client.put('/api/profile/student', { ...(await s.client.get('/api/profile')).body.profile, skills: ['Python', `S${Math.random().toString(36).slice(2, 6)}x`] })).status).toBe(200);
      const id = await publish(emp, { ...ML_VACANCY, title: `Probe ${Math.random().toString(36).slice(2, 8)} engineer` });
      expect((await matchOf(s.client, id)).textSource).toBe('lexical');
    }
    expect(await rows('vacancy_embeddings')).toHaveLength(0);
    expect(await rows('student_embeddings')).toHaveLength(0);
  });

  it('vectors from different models/dimensions are never compared (a stale student vector means lexical for that pair)', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    install();
    await setProfile(s.client, { skills: ['Python'] });
    install({ model: 'other-model', embed: async (t) => t.map((x) => embed(x).slice(0, 4)) }); // 4-d vectors from a "new" model
    const id = await publish(emp, ML_VACANCY);
    expect((await sql<{ dim: number }>('SELECT dim FROM vacancy_embeddings'))[0].dim).toBe(4);
    expect((await sql<{ dim: number }>('SELECT dim FROM student_embeddings'))[0].dim).toBe(CONCEPTS.length + 1);
    expect((await matchOf(s.client, id)).textSource).toBe('lexical');
    await setProfile(s.client, { skills: ['Python', 'SQL'] }); // student re-embedded with the new model
    expect((await matchOf(s.client, id)).textSource).toBe('semantic');
  });

  it('deleting a student or vacancy removes their vectors', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    install();
    await setProfile(s.client, { skills: ['Python'] });
    const id = await publish(emp, ML_VACANCY);
    expect((await rows('vacancy_embeddings')).length + (await rows('student_embeddings')).length).toBe(2);
    expect((await s.client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' })).status).toBe(200);
    expect(await rows('student_embeddings')).toHaveLength(0);
    await emp.client.post(`/api/vacancies/${id}/close`);
    await sql('DELETE FROM vacancies');
    expect(await rows('vacancy_embeddings')).toHaveLength(0);
  });

  it('the queue consumer embeds the vacancy before matching', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    await setProfile(s.client, { skills: ['Python'] });
    install();
    await setProfile(s.client, { skills: ['Python', 'SQL'] });
    testEnv.JOBS = { send: async () => undefined };
    const c = await emp.client.post('/api/vacancies', vacancyPayload(ML_VACANCY));
    await emp.client.post(`/api/vacancies/${c.body.vacancy.id}/publish`);
    expect(await rows('vacancy_embeddings')).toHaveLength(0);
    await processJob(new Db(testEnv), testEnv, { type: 'match_vacancy', vacancyId: c.body.vacancy.id });
    expect(await rows('vacancy_embeddings')).toHaveLength(1);
  });
});

describe('backfill', () => {
  it('embeds only what is missing, is idempotent, bounded, admin-only, and part of the cron', async () => {
    const emp = await makeEmployer(), s1 = await makeStudent(), s2 = await makeStudent(), admin = await makeAdmin();
    await setProfile(s1.client, { skills: ['Python'] }); await setProfile(s2.client, { skills: ['SQL'] });
    await publish(emp, { title: 'Alpha role Python' }); await publish(emp, { title: 'Beta role SQL' });
    expect((await admin.post('/api/admin/embeddings/backfill')).status).toBe(503); // no embedder yet
    install();
    expect((await s1.client.post('/api/admin/embeddings/backfill')).status).toBe(403);
    const r = await admin.post('/api/admin/embeddings/backfill');
    expect(r.body).toEqual({ vacancies: 2, students: 2 });
    expect(await admin.post('/api/admin/embeddings/backfill').then((x) => x.body)).toEqual({ vacancies: 0, students: 0 });
    await sql('DELETE FROM student_embeddings');
    const db = new Db(testEnv);
    expect(await backfillEmbeddings(db, testEnv, 1)).toEqual({ vacancies: 0, students: 1 }); // limit respected
    await runScheduled(testEnv, '0 4 * * 1');
    expect(await rows('student_embeddings')).toHaveLength(2);
  });
  it('skips blocked students and drafts/closed vacancies', async () => {
    const emp = await makeEmployer(), s = await makeStudent();
    await emp.client.post('/api/vacancies', vacancyPayload());
    await sql(`UPDATE users SET status = 'blocked' WHERE id = $1`, [(await s.client.get('/api/profile')).body.user.id]);
    install();
    expect(await backfillEmbeddings(new Db(testEnv), testEnv, 50)).toEqual({ vacancies: 0, students: 0 });
  });
});

describe('providers', () => {
  it('Workers AI binding: multilingual default model, {text: [...]} input, validated output', async () => {
    const calls: { model: string; input: unknown }[] = [];
    testEnv.AI = { run: async (model, input) => { calls.push({ model, input }); return { data: (input as { text: string[] }).text.map(() => [1, 2, 3]) }; } };
    const e = getEmbedder(testEnv)!;
    expect(e.model).toBe('@cf/baai/bge-m3');
    expect(await e.embed(['a', 'b'])).toEqual([[1, 2, 3], [1, 2, 3]]);
    expect(calls[0]).toEqual({ model: '@cf/baai/bge-m3', input: { text: ['a', 'b'] } });
    testEnv.AI = { run: async () => ({ data: [[1]] }) };
    await expect(getEmbedder(testEnv)!.embed(['a', 'b'])).rejects.toThrow(/shape/);
    testEnv.AI = { run: async () => ({ data: [['x']] }) };
    await expect(getEmbedder(testEnv)!.embed(['a'])).rejects.toThrow(/invalid/);
  });
  it('OpenAI-compatible endpoint: URL, bearer key, model, input order by index, errors surface', async () => {
    testEnv.EMBED_API_KEY = 'ek-1'; testEnv.EMBED_BASE_URL = 'https://emb.test/v1/'; testEnv.EMBED_MODEL = 'm-1';
    const real = globalThis.fetch;
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ data: [{ index: 1, embedding: [2, 2] }, { index: 0, embedding: [1, 1] }] })); }) as never;
    try {
      const e = getEmbedder(testEnv)!;
      expect(await e.embed(['a', 'b'])).toEqual([[1, 1], [2, 2]]);
      expect(seen!.url).toBe('https://emb.test/v1/embeddings');
      expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer ek-1');
      expect(JSON.parse(seen!.init.body as string)).toEqual({ model: 'm-1', input: ['a', 'b'] });
      globalThis.fetch = (async () => new Response('', { status: 429 })) as never;
      await expect(e.embed(['a'])).rejects.toThrow(/429/);
    } finally { globalThis.fetch = real; }
  });
  it('no provider configured → null (feature off)', () => { expect(getEmbedder(testEnv)).toBeNull(); });
});
