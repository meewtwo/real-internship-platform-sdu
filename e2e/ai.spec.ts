import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiEmployer, apiStudent, dbQuery, uiLogin } from './fixtures';
import { PASSWORD } from './helpers';

// The e2e server runs WITHOUT an AI key, so these tests cover consent, the UI and the rule-based fallbacks end to end.
async function csrf(req: APIRequestContext) { return (await (await req.get('/api/auth/csrf')).json()).token as string; }
async function activeEmployerWithVacancy(req: APIRequestContext) {
  const e = await apiEmployer(req);
  await dbQuery(`UPDATE users SET status = 'active' WHERE email = $1`, [e.email]);
  await dbQuery(`UPDATE employer_profiles SET review_status = 'approved' WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [e.email]); // approved like the admin flow does (publishing needs both)
  const login = await req.post('/api/auth/login', { data: { role: 'employer', identifier: e.email, password: PASSWORD }, headers: { 'x-csrf-token': await csrf(req) } });
  expect(login.ok()).toBeTruthy();
  const v = await req.post('/api/vacancies', { headers: { 'x-csrf-token': await csrf(req) }, data: { title: 'Python SQL Data Analyst Intern', description: 'Analyse data with Python and SQL and build dashboards for our analytics team.', kind: 'internship', industry: 'it_software', city: 'almaty', workFormat: 'onsite', requiredSkills: ['Python', 'SQL'] } });
  expect(v.status()).toBe(201);
  const id = (await v.json()).vacancy.id as string;
  expect((await req.post(`/api/vacancies/${id}/publish`, { headers: { 'x-csrf-token': await csrf(req) } })).ok()).toBeTruthy();
  return { e, id };
}
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};

test.describe('AI features (rule-based mode, no provider configured)', () => {
  test('student: consent gate → cover letter and interview questions from templates; accessible', async ({ browser }) => {
    const ctx = () => browser.newContext({ baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:4173', viewport: { width: 1366, height: 900 } });
    const [empCtx, stuCtx] = [await ctx(), await ctx()];
    await activeEmployerWithVacancy(empCtx.request);
    const stu = await apiStudent(stuCtx.request, ['Python']);
    const s = await stuCtx.newPage();
    await uiLogin(s, 'student', stu.id);
    await s.getByRole('navigation').getByRole('link', { name: 'AI Studio', exact: true }).first().click();
    await expect(s.getByRole('heading', { name: 'AI Studio' })).toBeVisible();

    // nothing is offered before consent
    await expect(s.getByRole('heading', { name: 'Use AI assistance?' })).toBeVisible();
    await expect(s.getByRole('tab', { name: 'Cover letter' })).toHaveCount(0);
    expect(await axe(s)).toEqual([]);
    await s.getByRole('button', { name: 'Allow AI features' }).click();
    await expect(s.getByText('AI service is not configured — rule-based mode.').first()).toBeVisible();

    await s.getByRole('tab', { name: 'Cover letter' }).click();
    await s.getByLabel('Vacancy').selectOption({ index: 1 });
    await s.getByRole('button', { name: 'Write cover letter' }).click();
    const letter = s.getByLabel('Your letter');
    await expect(letter).toBeVisible();
    await expect(letter).toHaveValue(/Aigerim Nurlanova/);
    await expect(letter).toHaveValue(/Python SQL Data Analyst Intern/);
    await expect(s.getByText('Rule-based').first()).toBeVisible();
    expect(await axe(s)).toEqual([]);

    await s.getByRole('tab', { name: 'Interview practice' }).click();
    await s.getByLabel('Vacancy').selectOption({ index: 1 });
    await s.getByRole('button', { name: 'Get questions' }).click();
    await expect(s.getByRole('button', { name: /^1\. Tell me about a project where you used/ })).toBeVisible();
    // feedback needs the AI (no fallback): the UI must say so instead of failing silently
    await s.getByRole('button', { name: /^1\./ }).click();
    await s.getByLabel('Your answer').fill('I built an analytics pipeline with Python for my class project last year.');
    await s.getByRole('button', { name: 'Get feedback' }).click();
    await expect(s.getByRole('alert')).toContainText('AI is temporarily unavailable');

    // consent can be withdrawn
    await s.getByRole('button', { name: 'Turn off AI' }).click();
    await expect(s.getByRole('heading', { name: 'Use AI assistance?' })).toBeVisible();
  });

  test('student: "Explain this match" on a vacancy uses the rule-based explanation', async ({ browser }) => {
    const ctx = () => browser.newContext({ baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:4173', viewport: { width: 1366, height: 900 } });
    const [empCtx, stuCtx] = [await ctx(), await ctx()];
    const { id } = await activeEmployerWithVacancy(empCtx.request);
    const stu = await apiStudent(stuCtx.request, ['Python']);
    const s = await stuCtx.newPage();
    await uiLogin(s, 'student', stu.id);
    await s.goto(`/vacancies/${id}`);
    await s.getByRole('button', { name: 'Allow AI features' }).click();
    await s.getByRole('button', { name: 'Explain this match' }).click();
    await expect(s.getByText(/^Match \d+%\. 1 of 2 required skills are covered\.$/)).toBeVisible();
    await expect(s.getByText('Rule-based').first()).toBeVisible();
  });

  test('employer: paste a posting → the new-vacancy form is filled and valid; accessible', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:4173', viewport: { width: 1366, height: 1000 } });
    const e = await apiEmployer(ctx.request);
    await dbQuery(`UPDATE users SET status = 'active' WHERE email = $1`, [e.email]);
    await dbQuery(`UPDATE employer_profiles SET review_status = 'approved' WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [e.email]); // approved like the admin flow does (publishing needs both)
    const p = await ctx.newPage();
    await uiLogin(p, 'employer', e.email);
    await p.goto('/vacancies/new');
    await p.getByText('Autofill from a job posting (AI)').click();
    await p.getByRole('button', { name: 'Allow AI features' }).click();
    await p.getByLabel('Autofill from a job posting (AI)', { exact: false }).first().fill('Backend Python Intern\nWe are looking for an intern in Astana. Hybrid format. Requirements: Python, SQL, Docker. Salary 250 000 - 400 000 KZT.');
    await p.getByRole('button', { name: 'Fill the form' }).click();
    await expect(p.getByText('Draft filled — review every field before saving.')).toBeVisible();
    await expect(p.getByLabel('Title', { exact: true })).toHaveValue('Backend Python Intern');
    await expect(p.getByLabel('Type', { exact: true })).toHaveValue('internship');
    await expect(p.getByLabel('Work format')).toHaveValue('hybrid');
    await expect(p.getByLabel('Salary from', { exact: false })).toHaveValue('250000');
    await expect(p.getByText('Python', { exact: true }).first()).toBeVisible();
    expect(await axe(p)).toEqual([]);
  });
});
