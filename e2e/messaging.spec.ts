import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiEmployer, apiStudent, dbQuery, uiLogin } from './fixtures';
import { PASSWORD } from './helpers';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:4173';
const csrf = async (r: APIRequestContext) => (await (await r.get('/api/auth/csrf')).json()).token as string;
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 160) + ' ' + JSON.stringify(n.any.map((a) => a.data))).join(' | ')}`);
};

test('candidate ↔ employer: chat, interview proposal and confirmation, calendar file; accessible', async ({ browser }) => {
  const mk = () => browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } });
  const [eCtx, sCtx] = [await mk(), await mk()];
  const emp = await apiEmployer(eCtx.request);
  await dbQuery(`UPDATE users SET status = 'active' WHERE email = $1`, [emp.email]);
  const stu = await apiStudent(sCtx.request, ['Python', 'SQL']);

  const e = await eCtx.newPage();
  await uiLogin(e, 'employer', emp.email);
  const mkVac = await e.request.post('/api/vacancies', { headers: { 'x-csrf-token': await csrf(e.request) }, data: { title: 'Python SQL Data Analyst Intern', description: 'Analyse data with Python and SQL and build dashboards for our analytics team.', kind: 'internship', industry: 'it_software', city: 'almaty', workFormat: 'onsite', requiredSkills: ['Python', 'SQL'] } });
  const vid = (await mkVac.json()).vacancy.id as string;
  await e.request.post(`/api/vacancies/${vid}/publish`, { headers: { 'x-csrf-token': await csrf(e.request) } });

  const s = await sCtx.newPage();
  await uiLogin(s, 'student', stu.id);
  const app = await s.request.post(`/api/vacancies/${vid}/apply`, { headers: { 'x-csrf-token': await csrf(s.request) } });
  expect(app.status()).toBe(201);
  const appId = (await app.json()).application.id as string;

  // employer opens the conversation from the applicants list and writes first
  await e.goto(`/vacancies/${vid}/applicants`);
  await e.getByRole('link', { name: 'Message', exact: true }).click();
  await expect(e).toHaveURL(new RegExp(`/messages/${appId}$`));
  await e.getByLabel('Write a message… (Ctrl+Enter to send)').fill('Hello Aigerim! Are you free for a short call next week?');
  await e.getByRole('button', { name: 'Send' }).click();
  await expect(e.getByRole('log').getByText('Hello Aigerim! Are you free for a short call next week?')).toBeVisible();

  // candidate sees it in the list (unread), opens it and replies
  await s.getByRole('navigation').getByRole('link', { name: 'Messages', exact: true }).first().click();
  await expect(s.getByRole('heading', { name: 'Messages' })).toBeVisible();
  const row = s.getByRole('link', { name: /Acme Technologies LLP/ });
  await expect(row).toContainText('Hello Aigerim!');
  await expect(row.getByLabel('1 unread')).toBeVisible();
  await row.click();
  await expect(s.getByRole('log').getByText('Hello Aigerim!')).toBeVisible();
  await s.getByLabel('Write a message… (Ctrl+Enter to send)').fill('Yes — Tuesday afternoon works for me.');
  await s.keyboard.press('Control+Enter');
  await expect(s.getByRole('log').getByText('Yes — Tuesday afternoon works for me.')).toBeVisible();
  expect(await axe(s)).toEqual([]);

  // employer receives the reply (polling) and proposes an interview
  await expect(e.getByRole('log').getByText('Yes — Tuesday afternoon works for me.')).toBeVisible({ timeout: 20_000 });
  await e.getByRole('button', { name: 'Propose an interview' }).click();
  const when = new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 11) + '10:00'; // 10:00 Almaty three days ahead (UTC+5 shift only affects the date part)
  await e.getByLabel(/Date and time/).fill(when);
  await e.getByLabel('Place or link').fill('https://meet.example.com/room-1');
  await e.getByRole('button', { name: 'Send proposal' }).click();
  await expect(e.getByText('Awaiting answer')).toBeVisible();
  await expect(e.getByRole('link', { name: 'https://meet.example.com/room-1' })).toBeVisible();

  // candidate confirms; calendar file works; the application moved to "Interview"
  await s.reload();
  await expect(s.getByText('Awaiting answer')).toBeVisible();
  await s.getByRole('button', { name: 'Accept' }).click();
  await expect(s.getByText('Confirmed', { exact: true })).toBeVisible();
  const ics = s.getByRole('link', { name: 'Add to calendar (.ics)' });
  const href = await ics.getAttribute('href');
  const res = await s.request.get(href!);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('BEGIN:VEVENT');
  expect(body).toContain('STATUS:CONFIRMED');
  expect(body).toContain('LOCATION:https://meet.example.com/room-1');
  const status = (await dbQuery('SELECT status FROM applications WHERE id = $1', [appId]))[0].status;
  expect(status).toBe('interview');
  expect(await axe(s)).toEqual([]);

  // employer is notified in-app
  await e.goto('/notifications');
  await expect(e.getByText(/confirmed the interview for “Python SQL Data Analyst Intern”/)).toBeVisible();
});

test('a closed application is read-only in the chat', async ({ browser }) => {
  const mk = () => browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const [eCtx, sCtx] = [await mk(), await mk()];
  const emp = await apiEmployer(eCtx.request);
  await dbQuery(`UPDATE users SET status = 'active' WHERE email = $1`, [emp.email]);
  const stu = await apiStudent(sCtx.request, ['Python']);
  const e = await eCtx.newPage();
  await uiLogin(e, 'employer', emp.email);
  const vid = (await (await e.request.post('/api/vacancies', { headers: { 'x-csrf-token': await csrf(e.request) }, data: { title: 'Python intern role', description: 'Analyse data with Python and build dashboards for our analytics team.', kind: 'internship', industry: 'it_software', city: 'almaty', workFormat: 'onsite', requiredSkills: ['Python'] } })).json()).vacancy.id as string;
  await e.request.post(`/api/vacancies/${vid}/publish`, { headers: { 'x-csrf-token': await csrf(e.request) } });
  const s = await sCtx.newPage();
  await uiLogin(s, 'student', stu.id);
  const appId = (await (await s.request.post(`/api/vacancies/${vid}/apply`, { headers: { 'x-csrf-token': await csrf(s.request) } })).json()).application.id as string;
  await e.request.patch(`/api/applications/${appId}/status`, { headers: { 'x-csrf-token': await csrf(e.request) }, data: { status: 'rejected' } });
  await s.goto(`/messages/${appId}`);
  await expect(s.getByText('This application is closed — messaging is read-only.')).toBeVisible();
  await expect(s.getByRole('button', { name: 'Send' })).toHaveCount(0);
  void PASSWORD;
});
