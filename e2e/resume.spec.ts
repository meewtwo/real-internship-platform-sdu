import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiStudent, uiLogin } from './fixtures';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:4173';
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};
const saved = (p: Page) => expect(p.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible({ timeout: 10_000 });

test('résumé builder: create → edit with autosave → validation → templates → review → share → export; accessible', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } });
  const stu = await apiStudent(ctx.request, ['Python', 'SQL']);
  const p = await ctx.newPage();
  await uiLogin(p, 'student', stu.id);

  // create from the profile
  await p.getByRole('navigation').getByRole('link', { name: 'Résumé', exact: true }).first().click();
  await p.getByRole('link', { name: 'Builder' }).click();
  await expect(p.getByRole('heading', { name: 'Résumé builder' })).toBeVisible();
  await p.getByLabel('Title', { exact: true }).fill('Data internships');
  await p.getByRole('button', { name: 'Create' }).click();
  await expect(p).toHaveURL(/\/resume\/builder\/[0-9a-f-]{36}$/);
  const id = p.url().split('/').pop()!;
  await expect(p.getByRole('textbox', { name: 'Full name' })).toHaveValue('Aigerim Nurlanova');

  // edit → autosaves, and survives a reload
  await p.getByRole('textbox', { name: 'Summary' }).fill('Final-year student building analytics tools with Python and SQL.');
  await p.getByRole('button', { name: 'Add job' }).click();
  await p.getByRole('textbox', { name: 'Role' }).fill('Data intern');
  await p.getByRole('textbox', { name: 'Company' }).fill('Acme');
  await p.getByRole('textbox', { name: 'Achievement 1' }).fill('Built dashboards for analysts');
  await saved(p);
  await p.reload();
  await expect(p.getByRole('textbox', { name: 'Role' })).toHaveValue('Data intern');
  await expect(p.getByRole('textbox', { name: 'Summary' })).toHaveValue(/analytics tools/);
  await expect(p.getByLabel('Title', { exact: true })).toHaveValue('Data internships');

  // invalid input is flagged and NOT sent; fixing it saves again
  const email = p.getByRole('textbox', { name: 'Email' });
  await email.fill('not-an-email');
  await expect(p.getByRole('status').filter({ hasText: 'Fix the highlighted fields to save' })).toBeVisible();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await email.fill('aigerim@example.com');
  await saved(p);

  // templates re-render the same data
  await p.getByLabel('Template').selectOption('modern');
  await expect(p.locator('.resume-sheet').getByRole('heading', { level: 2, name: 'Contact' })).toBeVisible();
  await saved(p);
  expect(await axe(p)).toEqual([]);

  // rule-based review points at what to improve
  await p.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(p.getByText('Résumé score')).toBeVisible();
  await expect(p.getByText('Add numbers to achievements (how many, how much, how fast).')).toBeVisible();
  await p.getByRole('tab', { name: 'Preview' }).click();
  await p.getByRole('textbox', { name: 'Achievement 1' }).fill('Built 12 dashboards used by 40 analysts');
  await saved(p);
  await p.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(p.getByText('Add numbers to achievements (how many, how much, how fast).')).toHaveCount(0);

  // history: restore creates a new version
  await p.getByRole('tab', { name: 'History' }).click();
  await expect(p.getByText('Current')).toBeVisible();
  p.once('dialog', (d) => void d.accept());
  await p.getByRole('button', { name: 'Restore' }).last().click();
  await expect(p.getByText('Version restored')).toBeVisible();

  // share: public page is reachable without login, hides contact details, and is noindex
  await p.getByRole('tab', { name: 'Share' }).click();
  await p.getByRole('button', { name: 'Create public link' }).click();
  const link = await p.getByLabel('Public link').inputValue();
  expect(link).toMatch(/\/r\/[A-Za-z0-9_-]{16,}$/);
  const anon = await browser.newContext({ baseURL: BASE });
  const pub = await anon.newPage();
  await pub.goto(new URL(link).pathname);
  await expect(pub.getByRole('heading', { name: 'Aigerim Nurlanova' })).toBeVisible();
  await expect(pub.getByText('aigerim@example.com')).toHaveCount(0);
  await expect(pub.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  expect(await axe(pub)).toEqual([]);
  // revoking kills the link
  await p.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(p.getByRole('button', { name: 'Create public link' })).toBeVisible();
  await pub.reload();
  await expect(pub.getByRole('alert')).toContainText('Résumé not found');

  // export
  const res = await ctx.request.get(`/api/resume-docs/${id}/export.docx`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('wordprocessingml');
  expect((await res.body()).subarray(0, 2).toString()).toBe('PK');

  // AI controls stay hidden until the user opts in (no key configured in e2e anyway)
  await expect(p.getByRole('button', { name: 'Stronger' })).toHaveCount(0);
});

test('résumé builder: two tabs editing the same résumé → the stale one is told, and can reload', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } });
  const stu = await apiStudent(ctx.request, ['Python']);
  const a = await ctx.newPage();
  await uiLogin(a, 'student', stu.id);
  await a.goto('/resume/builder');
  await a.getByRole('button', { name: 'Create' }).click();
  await expect(a).toHaveURL(/\/resume\/builder\/[0-9a-f-]{36}$/);
  const b = await ctx.newPage();
  await b.goto(a.url());
  await expect(b.getByRole('textbox', { name: 'Full name' })).toHaveValue('Aigerim Nurlanova');
  await a.getByRole('textbox', { name: 'Headline (e.g. Data analyst)' }).fill('Written in tab A');
  await saved(a);
  await b.getByRole('textbox', { name: 'Headline (e.g. Data analyst)' }).fill('Written in tab B');
  await expect(b.getByRole('alert').filter({ hasText: 'Changed elsewhere' })).toBeVisible({ timeout: 10_000 });
  await b.getByRole('button', { name: 'Reload' }).click();
  await expect(b.getByRole('textbox', { name: 'Headline (e.g. Data analyst)' })).toHaveValue('Written in tab A');
  await saved(b);
});
