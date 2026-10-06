import { DatabaseSync } from 'node:sqlite';
import { strToU8 } from 'fflate';
import { hashPassword } from '../backend/src/lib/crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { PASSWORD, gradIn, uniqueEmployer, uniqueStudent } from './helpers';

export const dbQuery = async (sql: string, params: unknown[] = []): Promise<any[]> => {
  const db = new DatabaseSync('/tmp/sdu_e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  try {
    const st = db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
    return /^\s*(select|with|pragma)\b/i.test(sql) ? (st.all(...(params as never[])) as any[]).map((r) => ({ ...r })) : (st.run(...(params as never[])), []);
  } finally { db.close(); }
};

export function makePdf(lines: string[]): Buffer {
  const text = lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${l.replace(/[\\()]/g, '\\$&')}) Tj`).join(' ');
  const stream = `BT /F1 11 Tf 50 740 Td ${text} ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(strToU8(out));
}

async function post(req: APIRequestContext, path: string, data: unknown) {
  const token = (await (await req.get('/api/auth/csrf')).json()).token;
  return req.post(path, { data, headers: { 'x-csrf-token': token } });
}
async function put(req: APIRequestContext, path: string, data: unknown) {
  const token = (await (await req.get('/api/auth/csrf')).json()).token;
  return req.put(path, { data, headers: { 'x-csrf-token': token } });
}
async function code(req: APIRequestContext, to: string) {
  for (let i = 0; i < 30; i++) {
    const mails = (await (await req.get(`/api/__test/outbox?to=${encodeURIComponent(to)}`)).json()).mails as { code: string }[];
    if (mails.length) return mails.at(-1)!.code;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('no mail');
}

export async function apiStudent(req: APIRequestContext, skills: string[] = ['Python', 'SQL']) {
  const s = uniqueStudent();
  const reg = await post(req, '/api/auth/register/student', { studentId: s.id, name: 'Aigerim', surname: 'Nurlanova', email: s.email, phone: `+7${s.phone7}`, city: 'almaty', major: 'computer_science', yearOfStudy: '3', gpa: '3.65', graduation: gradIn(24).value, interestArea: 'data_ai', relocation: 'yes', password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true, language: 'en' });
  if (reg.status() !== 201) throw new Error('student register ' + (await reg.text()));
  await post(req, '/api/auth/verify', { role: 'student', identifier: s.id, code: await code(req, s.email) });
  const prof = (await (await req.get('/api/profile')).json()).profile;
  await put(req, '/api/profile/student', { ...prof, skills, interests: [] });
  await post(req, '/api/auth/logout', {});
  return s;
}
export async function apiEmployer(req: APIRequestContext) {
  const e = uniqueEmployer();
  const reg = await post(req, '/api/auth/register/employer', { companyName: 'Acme Technologies LLP', bin: e.bin, industry: 'it_software', size: 's51_200', city: 'astana', contactName: 'Timur', contactSurname: 'Ospanov', position: 'HR Manager', email: e.email, phone: `+7${e.phone7}`, password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true, language: 'en' });
  if (reg.status() !== 201) throw new Error('employer register ' + (await reg.text()));
  await post(req, '/api/auth/verify', { role: 'employer', identifier: e.email, code: await code(req, e.email) });
  await post(req, '/api/auth/logout', {});
  return e;
}
export async function seedAdmin(): Promise<string> {
  const email = `admin${Date.now()}@careermatch.kz`;
  await dbQuery(`INSERT INTO users (role, email, password_hash, status) VALUES ('admin', $1, $2, 'active')`, [email, await hashPassword('Cm!Root2026#Safe')]);
  return email;
}
export async function uiLogin(page: Page, role: 'student' | 'employer', identifier: string, password = PASSWORD) {
  await page.goto(`/login?role=${role}`);
  await page.locator(role === 'student' ? 'input[name=studentId]' : 'input[name=email]').fill(identifier);
  await page.locator('input[name=password]').fill(password);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/dashboard/);
}

export const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true }).first();
export async function logout(page: Page) {
  await page.getByRole('button', { name: /^(Account|Аккаунт)$/ }).click();
  await page.getByRole('menuitem', { name: /Log out|Выйти|Шығу/ }).click();
}
