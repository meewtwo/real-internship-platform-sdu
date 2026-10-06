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

  test('résumé from SDU portal: demo import, pasted transcript, skills → profile, print layout, edit text', async ({ page }) => {
    const stu = await apiStudent(page.request, []);
    await uiLogin(page, 'student', stu.id);
    await expect(page.getByRole('link', { name: 'Build your résumé from SDU courses' })).toBeVisible(); // dashboard checklist step
    await nav(page, 'Résumé').click();
    await expect(page.getByRole('button', { name: 'Build résumé' })).toBeDisabled();
    await page.getByLabel('Paste transcript text').fill('nothing useful here');
    await page.getByRole('button', { name: 'Build résumé' }).click();
    await expect(page.getByText('No courses recognised in this text')).toBeVisible();
    await page.getByLabel('Paste transcript text').fill('2025 Fall  CSC 210  Database Systems  6  A\n2025 Fall  CSC 230  Web Programming  6  A-\n2026 Spring CSC 310  Machine Learning  6  B+');
    await page.getByRole('button', { name: 'Build résumé' }).click();
    await expect(page.getByText('Imported from transcript')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Database Systems' })).toBeVisible();
    await expect(page.getByText(/GPA 3\.65 · 18 credits/)).toBeVisible();
    await page.getByRole('button', { name: 'Add skills to my profile' }).click();
    await expect(page.getByText(/Added \d+ skills to your profile/)).toBeVisible();
    await page.getByRole('button', { name: 'Edit text' }).click();
    await page.getByLabel('About me').fill('Hello <script>window.__xss=1</script> recruiters');
    await page.getByRole('button', { name: 'Save changes' }).click().catch(async () => { await page.getByRole('button', { name: 'Save' }).click(); });
    await expect(page.getByText('Hello <script>window.__xss=1</script> recruiters')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Build your résumé from SDU courses' }).locator('span.line-through')).toBeVisible(); // step is ticked off
    await page.goto('/profile');
    await expect(page.getByText('SQL', { exact: true })).toBeVisible();
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
