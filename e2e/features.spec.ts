import { expect, test } from '@playwright/test';
import { apiEmployer, apiStudent, dbQuery, nav, uiLogin } from './fixtures';

const post = async (req: import('@playwright/test').APIRequestContext, path: string, data: unknown) =>
  req.post(path, { data, headers: { 'x-csrf-token': (await (await req.get('/api/auth/csrf')).json()).token } });

test.describe('hh-style features', () => {
  test('public landing page: official SDU assets, live stats, no login needed, translated', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Find your first job');
    for (const asset of ['/brand/graduate.jpg', '/brand/sdu-emblem-navy.svg', '/brand/anniversary-30.png']) expect((await page.request.get(asset)).status()).toBe(200);
    await expect(page.getByRole('img', { name: 'SDU University' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'RU', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Найдите первую работу');
    await page.getByRole('link', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.locator('body').innerText()).not.toMatch(/\bhome\.[a-z]/i);
  });

  test('student: favourites, what-if skill simulator, salary filter; employer: talent pool + invitation → student notification', async ({ browser }) => {
    const mk = () => browser.newContext({ baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:4173', viewport: { width: 1366, height: 900 } });
    const [ec, sc] = [await mk(), await mk()];
    const emp = await apiEmployer(ec.request);
    await dbQuery(`UPDATE users SET status='active' WHERE email=$1`, [emp.email]);
    await dbQuery(`UPDATE employer_profiles SET review_status = 'approved' WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [emp.email]); // approved like the admin flow does (publishing needs both)
    const stu = await apiStudent(sc.request, ['Python', 'SQL']);
    const e = await ec.newPage();
    await uiLogin(e, 'employer', emp.email);
    const title = `Cloud Data Intern ${Date.now() % 100000}`;
    const created = await post(e.request, '/api/vacancies', { title, description: 'Build data pipelines on cloud infrastructure with Python, SQL and Docker every day.', kind: 'internship', industry: 'it_software', city: 'almaty', workFormat: 'onsite', salaryMin: 321000, salaryMax: 421000, requiredSkills: ['Python', 'SQL', 'Docker'] });
    const id = (await created.json()).vacancy.id;
    await post(e.request, `/api/vacancies/${id}/publish`, {});

    const s = await sc.newPage();
    await uiLogin(s, 'student', stu.id);
    await nav(s, 'Internships').click();
    await s.getByLabel('Salary from, ₸').fill('321000');
    const card = s.getByRole('listitem').filter({ hasText: title });
    await expect(card.getByText('321,000 – 421,000 ₸')).toBeVisible();
    await s.getByLabel('Salary from, ₸').fill('900000');
    await expect(card).toHaveCount(0);
    await s.getByLabel('Salary from, ₸').fill('');
    await card.getByRole('button', { name: 'Add to favourites' }).click();
    await expect(card.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true');
    await nav(s, 'Favourites').click();
    await expect(s.getByRole('link', { name: title })).toBeVisible();
    await s.getByRole('link', { name: title }).click();
    await expect(s.getByText('What if you learn…')).toBeVisible();
    await expect(s.getByText('+ SQL')).toHaveCount(0); // already has SQL
    await expect(s.getByText('+ Docker')).toBeVisible();
    await expect(s.getByText('Learn all missing skills')).toBeVisible();

    // employer: talent pool shows the student; invite once
    await e.goto(`/vacancies/${id}/applicants`);
    await expect(e.getByRole('heading', { name: 'Talent pool' })).toBeVisible();
    const cand = e.getByRole('listitem').filter({ hasText: 'Aigerim Nurlanova' }).first();
    await cand.getByRole('button', { name: 'Invite to apply' }).click();
    await expect(e.getByText('Invitation sent')).toBeVisible();
    await expect(cand.getByRole('button', { name: 'Invited' })).toBeDisabled();
    await s.goto('/notifications');
    await expect(s.getByText(new RegExp(`invites you to apply: “${title}”`))).toBeVisible();
    for (const c of [ec, sc]) await c.close();
  });

  test('Résumé section: opens the Builder, only Builder and My CV sub-tabs, old /resume link redirects', async ({ page }) => {
    const stu = await apiStudent(page.request, []);
    await uiLogin(page, 'student', stu.id);
    await expect(page.getByRole('link', { name: 'Create a résumé in the Builder' })).toBeVisible(); // dashboard checklist step
    await nav(page, 'Résumé').click();
    await expect(page).toHaveURL(/\/resume\/builder$/);
    await expect(page.getByRole('heading', { name: 'Résumé builder' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Sections' }).getByRole('link');
    await expect(tabs).toHaveText(['Builder', 'My CV']);
    await expect(page.getByText('Import from SDU portal')).toHaveCount(0);
    await page.goto('/resume');
    await expect(page).toHaveURL(/\/resume\/builder$/);
    await page.getByRole('link', { name: 'My CV' }).click();
    await expect(page).toHaveURL(/\/cv$/);
  });

  test('student profile: "Other" interest asks for the student\'s own words and keeps them', async ({ page }) => {
    const stu = await apiStudent(page.request, ['Python']);
    await uiLogin(page, 'student', stu.id);
    await page.goto('/profile');
    const area = page.getByLabel('Internship interest', { exact: true });
    await expect(page.getByLabel('Your interest')).toHaveCount(0);
    await area.selectOption('other');
    const own = page.getByLabel('Your interest');
    await expect(own).toHaveAttribute('placeholder', 'Please specify your interest');
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeDisabled(); // required while "Other" is selected
    await own.fill('Game design');
    await save.click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await page.reload();
    await expect(area).toHaveValue('other');
    await expect(page.getByLabel('Your interest')).toHaveValue('Game design');
    await area.selectOption('data_ai'); // switching away hides and clears it
    await expect(page.getByLabel('Your interest')).toHaveCount(0);
    await area.selectOption('other');
    await expect(page.getByLabel('Your interest')).toHaveValue('');
  });

  test('animations respect prefers-reduced-motion', async ({ browser }) => {
    const c = await browser.newContext({ reducedMotion: 'reduce', baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:4173' });
    const p = await c.newPage();
    await p.goto('/');
    const anim = await p.locator('h1').evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
    await c.close();
  });
});
