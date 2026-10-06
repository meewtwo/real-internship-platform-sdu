import '../src/lib/dbNode';
import { skillKey } from '@sdu/shared';
import { Db } from '../src/lib/db';
import { strToU8, zipSync } from 'fflate';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { TEST_DB } from './globalSetup';

export const app = createApp();
export const testEnv: Env = {
  ENVIRONMENT: 'test', SQLITE_PATH: TEST_DB, SKIP_MX: '1', TRUST_PROXY_HEADERS: '1', APP_SECRET: 'test-secret',
};

let ipCounter = 0;
export const freshIp = () => `10.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}.1`;

export interface Res<T = any> { status: number; body: T; headers: Headers }

/** Minimal browser: cookie jar + CSRF handling. */
export class Client {
  jar = new Map<string, string>();
  csrf: string | null = null;
  constructor(public ip = freshIp()) {}

  private cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  private absorb(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const gone = attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === '';
      if (gone) this.jar.delete(name); else this.jar.set(name, value);
    }
  }

  async raw(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Res> {
    const headers: Record<string, string> = { 'x-forwarded-for': this.ip, ...(init.headers ?? {}) };
    const ck = this.cookieHeader();
    if (ck) headers.cookie = ck;
    const res = await app.request(`http://localhost${path}`, { method, headers, body: init.body }, testEnv);
    this.absorb(res);
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body, headers: res.headers };
  }

  async ensureCsrf() {
    if (!this.csrf) this.csrf = (await this.raw('GET', '/api/auth/csrf')).body.token;
    return this.csrf!;
  }

  async json(method: string, path: string, data?: unknown, extra: { csrf?: string | null; headers?: Record<string, string>; rawBody?: string } = {}): Promise<Res> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(extra.headers ?? {}) };
    if (method !== 'GET') {
      const token = extra.csrf === undefined ? await this.ensureCsrf() : extra.csrf;
      if (token) headers['x-csrf-token'] = token;
    }
    return this.raw(method, path, { body: extra.rawBody ?? (data === undefined ? undefined : JSON.stringify(data)), headers });
  }
  /** multipart upload with CSRF */
  async upload(path: string, bytes: Uint8Array | string, filename: string, type = 'application/octet-stream', field = 'file'): Promise<Res> {
    const fd = new FormData();
    fd.append(field, new File([bytes as BlobPart], filename, { type }));
    return this.raw('POST', path, { body: fd, headers: { 'x-csrf-token': await this.ensureCsrf() } });
  }
  async download(path: string): Promise<{ status: number; headers: Headers; bytes: Uint8Array }> {
    const headers: Record<string, string> = { 'x-forwarded-for': this.ip };
    const ck = this.cookieHeader();
    if (ck) headers.cookie = ck;
    const res = await app.request(`http://localhost${path}`, { headers }, testEnv);
    return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  delete = (p: string) => this.json('DELETE', p);
  get = (p: string) => this.json('GET', p);
  post = (p: string, d?: unknown) => this.json('POST', p, d);
  put = (p: string, d?: unknown) => this.json('PUT', p, d);
  patch = (p: string, d?: unknown) => this.json('PATCH', p, d);
}

const testDb = new Db(testEnv);
/** Wipes all data (the schema stays). Child tables go with `users`/`skills` through ON DELETE CASCADE. */
export async function resetDb() {
  await testDb.batch(['DELETE FROM users', 'DELETE FROM skills', 'DELETE FROM rate_limits', 'DELETE FROM audit_log', 'DELETE FROM ai_cache', 'DELETE FROM sqlite_sequence'].map((sql) => ({ sql })));
}
export const sql = <T = any>(text: string, params: unknown[] = []) => testDb.query<T>(text, params).then((r) => r.rows as T[]);
/** Adds vocabulary skills (name_key is filled by the application, so tests must too). */
export const seedSkills = (...names: string[]) => testDb.batch(names.map((n) => ({ sql: 'INSERT OR IGNORE INTO skills (name, name_key) VALUES ($1, $2)', params: [n, skillKey(n)] })));
/** SQL fragments for "N units ago" in the ISO format the schema uses. */
export const ago = (n: number, unit: 'seconds' | 'minutes' | 'hours' | 'days') => `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${n} ${unit}')`;

/** "YYYY-MM" that is `months` months in the future (Asia/Almaty). */
export function gradIn(months: number): string {
  const d = new Date(Date.now() + 5 * 3600_000);
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

let seq = 0;
export function studentPayload(over: Record<string, unknown> = {}) {
  const n = 100000000 + 7000 + seq++;
  return {
    studentId: String(n), name: 'Aigerim', surname: 'Nurlanova', email: `aigerim${n}@sdu.edu.kz`,
    phone: `+7701${String(n).slice(-7)}`, city: 'almaty', major: 'computer_science', yearOfStudy: '3', gpa: '3.65',
    graduation: gradIn(24), interestArea: 'data_ai', relocation: 'yes', password: 'Vk8#mQ2!zPw4', confirmPassword: 'Vk8#mQ2!zPw4',
    acceptTerms: true, language: 'en', ...over,
  };
}

let bin = 500000000000;
export function employerPayload(over: Record<string, unknown> = {}) {
  const n = seq++;
  return {
    companyName: 'Acme Technologies LLP', bin: String(bin++), industry: 'it_software', size: 's51_200', city: 'astana',
    contactName: 'Timur', contactSurname: 'Ospanov', position: 'HR Manager', email: `hr${n}@acme-tech.kz`,
    phone: `+7702${String(1000000 + n).slice(-7)}`, website: 'https://acme-tech.kz', description: 'We build things.',
    password: 'Vk8#mQ2!zPw4', confirmPassword: 'Vk8#mQ2!zPw4', acceptTerms: true, language: 'en', ...over,
  };
}

export async function lastCode(client: Client, to: string): Promise<string> {
  const r = await client.get(`/api/__test/outbox?to=${encodeURIComponent(to)}`);
  const mails = r.body.mails as { code: string }[];
  if (!mails.length) throw new Error('no mail for ' + to);
  return mails[mails.length - 1].code;
}

/** Register + verify a student; returns a logged-in client. */
export async function makeStudent(over: Record<string, unknown> = {}) {
  const p = studentPayload(over);
  const c = new Client();
  const r = await c.post('/api/auth/register/student', p);
  if (r.status !== 201) throw new Error('register failed ' + JSON.stringify(r.body));
  const v = await c.post('/api/auth/verify', { role: 'student', identifier: p.studentId, code: await lastCode(c, p.email) });
  if (v.status !== 200) throw new Error('verify failed ' + JSON.stringify(v.body));
  return { client: c, payload: p };
}

export function makeDocx(lines: string[]): Uint8Array {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  return zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), 'word/document.xml': strToU8(xml) });
}

/** Minimal valid one-page PDF with real text (ASCII). */
export function makePdf(lines: string[]): Uint8Array {
  const text = lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${l.replace(/[\\()]/g, '\\$&')}) Tj`).join(' ');
  const stream = `BT /F1 11 Tf 50 740 Td ${text} ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(out);
}

export async function makeEmployer(opts: { active?: boolean } = {}) {
  const c = new Client();
  const p = employerPayload();
  const r = await c.post('/api/auth/register/employer', p);
  if (r.status !== 201) throw new Error('employer register failed ' + JSON.stringify(r.body));
  const v = await c.post('/api/auth/verify', { role: 'employer', identifier: p.email, code: await lastCode(c, p.email) });
  if (v.status !== 200) throw new Error('verify failed');
  if (opts.active !== false) {
    await sql(`UPDATE users SET status = 'active' WHERE email = $1`, [p.email]);
    await c.post('/api/auth/logout');
    await c.post('/api/auth/login', { role: 'employer', identifier: p.email, password: p.password });
  }
  const [{ id }] = await sql('SELECT id FROM users WHERE email = $1', [p.email]);
  return { client: c, payload: p, id: id as string };
}

export async function makeAdmin() {
  const { hashPassword } = await import('../src/lib/crypto');
  const email = `admin${seq++}@careermatch.kz`;
  await sql(`INSERT INTO users (role, email, password_hash, status) VALUES ('admin', $1, $2, 'active')`, [email, await hashPassword('Cm!Root2026#Safe')]);
  const c = new Client();
  const r = await c.post('/api/auth/login', { role: 'employer', identifier: email, password: 'Cm!Root2026#Safe' });
  if (r.status !== 200) throw new Error('admin login failed');
  return c;
}

export const vacancyPayload = (over: Record<string, unknown> = {}) => ({
  title: 'Junior Python Developer Intern', description: 'We are looking for an intern to build data tools with Python and SQL for our analytics team.',
  kind: 'internship', industry: 'it_software', city: 'almaty', workFormat: 'onsite', requiredSkills: ['Python', 'SQL'], ...over,
});

export async function setProfile(client: Client, patch: Record<string, unknown>) {
  const cur = (await client.get('/api/profile')).body.profile;
  const r = await client.put('/api/profile/student', { ...cur, ...patch });
  if (r.status !== 200) throw new Error('profile update failed ' + JSON.stringify(r.body));
}
