import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Vk8#mQ2!zPw4';
export const LANGS = ['en', 'ru', 'kk'] as const;
export type Lang = (typeof LANGS)[number];

export function gradIn(months: number): { month: string; year: string; value: string } {
  const d = new Date(Date.now() + 5 * 3600_000);
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = String(Math.floor(idx / 12));
  const month = String((idx % 12) + 1);
  return { month, year, value: `${year}-${month.padStart(2, '0')}` };
}

let n = 0;
export function uniqueStudent() {
  const id = String(300000000 + Math.floor(Math.random() * 600000000) + n++);
  return { id, email: `u${id}@sdu.edu.kz`, phone7: `70${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` };
}
export function uniqueEmployer() {
  const id = String(Math.floor(Math.random() * 1e9)) + n++;
  return { email: `hr${id}@company-${id}.kz`, bin: String(400000000000 + Math.floor(Math.random() * 99999999999)).slice(0, 12), phone7: `70${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` };
}

export async function setLang(page: Page, lang: Lang) {
  await page.addInitScript((l) => { try { localStorage.setItem('lang', l); } catch { /* ignore */ } }, lang);
}

/** Reads the last 6-digit code emailed to `to` (test-only outbox endpoint, ENVIRONMENT=test). */
export async function lastCode(page: Page, to: string, purpose?: 'register' | 'reset'): Promise<string> {
  let code = '';
  await expect.poll(async () => {
    const r = await page.request.get(`/api/__test/outbox?to=${encodeURIComponent(to)}`);
    const mails = ((await r.json()).mails as { code: string; purpose: string }[]).filter((m) => !purpose || m.purpose === purpose);
    code = mails.at(-1)?.code ?? '';
    return code;
  }, { timeout: 15_000 }).not.toBe('');
  return code;
}

export async function mailCount(page: Page, to: string): Promise<number> {
  const r = await page.request.get(`/api/__test/outbox?to=${encodeURIComponent(to)}`);
  return ((await r.json()).mails as unknown[]).length;
}

export async function typeCode(page: Page, code: string) {
  await page.getByRole('group', { name: /code|код/i }).locator('input').first().click();
  await page.keyboard.type(code);
}

export const isWizardViewport = (_w: number, _h: number) => true; // registration is always the step-by-step layout

/** Opens /register (or ?role=employer) directly on step n (1-based) using the persisted step index. */
export async function gotoStep(page: Page, role: 'student' | 'employer', n: number) {
  await page.goto(`/register?role=${role}`);
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [`step:${role}`, String(n - 1)] as const);
  await page.reload();
}

/** Fills the student registration step by step. Stops early (without failing) when a step cannot be continued. */
export async function fillStudentDesktop(page: Page, s: ReturnType<typeof uniqueStudent>, over: Partial<Record<string, string>> = {}) {
  const g = gradIn(24);
  const next = page.getByRole('button', { name: 'Next' });
  await page.getByLabel('Student ID').fill(over.studentId ?? s.id);
  await page.getByLabel('Phone').fill(s.phone7);
  await page.getByLabel('First name').fill(over.name ?? 'Aigerim');
  await page.getByLabel('Last name').fill(over.surname ?? 'Nurlanova');
  await page.getByLabel('University email').fill(over.email ?? s.email);
  if (!(await next.isEnabled())) return;
  await next.click();
  await pickCity(page, 'Alm');
  await page.getByLabel('Major').selectOption('computer_science');
  await page.getByLabel('Year of study').selectOption('3');
  await page.getByLabel('GPA (0–4)').fill(over.gpa ?? '3.65');
  await page.getByLabel('Month').selectOption(g.month);
  await page.getByLabel('Year', { exact: true }).selectOption(g.year);
  if (!(await next.isEnabled())) return;
  await next.click();
  await page.getByLabel('Internship interest').selectOption('data_ai');
  await page.getByRole('radiogroup', { name: /relocation/i }).getByText('Yes').click();
  await page.getByLabel('Password', { exact: true }).fill(over.password ?? PASSWORD);
  await page.getByLabel('Confirm password').fill(over.confirm ?? over.password ?? PASSWORD);
  await page.getByRole('checkbox').check();
}

export async function pickCity(page: Page, query: string) {
  const box = page.getByRole('combobox', { name: /City of residence/ });
  await box.click();
  await box.fill(query);
  await page.getByRole('listbox').getByRole('option').first().click();
}
