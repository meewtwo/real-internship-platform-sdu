import { expect, test } from '@playwright/test';
import { apiEmployer, apiStudent, dbQuery, makePdf, nav, seedAdmin, uiLogin } from './fixtures';
import { setLang } from './helpers';

test.describe('phases 2-6 end to end', () => {
  // the DB is shared by all spec files: vacancies published by earlier specs (same titles!) must not leak into this flow
  test.beforeAll(async () => { await dbQuery('DELETE FROM vacancies'); });
  test('admin approves employer → employer posts & publishes → student sees match %, applies → employer ranks, changes status → notifications → analytics', async ({ browser }) => {
    const ctx = () => browser.newContext({ baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:4173', viewport: { width: 1366, height: 900 } });
    const [adminCtx, empCtx, stuCtx] = [await ctx(), await ctx(), await ctx()];
    const emp = await apiEmployer(empCtx.request);
    const stu = await apiStudent(stuCtx.request, ['Python', 'SQL']);
    const adminEmail = await seedAdmin();

    // admin approves the pending employer through the UI
    const a = await adminCtx.newPage();
    await uiLogin(a, 'employer', adminEmail, 'Cm!Root2026#Safe');
    await nav(a, 'Employer approvals').click();
    const row = a.getByRole('listitem').filter({ hasText: emp.email });
    await expect(row.getByText('Acme Technologies LLP')).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(a.getByText('Employer approved')).toBeVisible();

    // employer creates a vacancy (validation first), then publishes it
    const e = await empCtx.newPage();
    await uiLogin(e, 'employer', emp.email);
    await e.goto('/vacancies/new');
    const save = e.getByRole('button', { name: 'Save draft' });
    await expect(save).toBeDisabled();
    await e.getByLabel('Title').fill('Python SQL Data Analyst Intern');
    await e.getByLabel('Description').fill('short');
    await e.getByLabel('Description').blur();
    await expect(e.getByText('Describe the role (at least 20 characters)')).toBeVisible();
    await e.getByLabel('Description').fill('Analyse data with Python and SQL and build dashboards for our analytics team.');
    await e.getByLabel('Type', { exact: true }).selectOption('internship');
    await e.getByLabel('Work format').selectOption('onsite');
    await e.getByLabel('Industry').selectOption('it_software');
    const city = e.getByRole('combobox', { name: 'City' });
    await city.click(); await city.fill('Alm'); await e.getByRole('listbox').getByRole('option').first().click();
    const skills = e.getByLabel('Required skills');
    await skills.fill('pyth'); await e.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name: 'Python' }).click().catch(async () => { await skills.fill('Python'); await skills.press('Enter'); });
    await skills.fill('SQL'); await skills.press('Enter');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(e).toHaveURL(/\/vacancies\/mine/);
    await expect(e.getByText('Python SQL Data Analyst Intern')).toBeVisible();
    await e.getByRole('button', { name: 'Publish' }).click();
    await expect(e.getByText(/Published — \d+ matching students notified/)).toBeVisible();

    // student: sees the vacancy with a match %, the explanation, then applies in one click
    const s = await stuCtx.newPage();
    await uiLogin(s, 'student', stu.id);
    await nav(s, 'Internships').click();
    const card = s.getByRole('listitem').filter({ hasText: 'Python SQL Data Analyst Intern' });
    await expect(card.getByRole('img', { name: /Match: \d+ percent/ })).toBeVisible();
    await expect(s.getByRole('button', { name: 'Bell' }).or(s.getByRole('link', { name: /Notifications \(\d+ unread\)/ }))).toBeVisible();
    await card.getByRole('link', { name: 'Python SQL Data Analyst Intern' }).click();
    await expect(s.getByText('Why this match')).toBeVisible();
    await s.getByLabel('Cover note (optional)').fill('I love data <b>science</b>');
    await s.getByRole('button', { name: 'Apply with one click' }).click();
    await expect(s.getByText(/You applied on/)).toBeVisible();
    await nav(s, 'Applications').click();
    await expect(s.getByText('Python SQL Data Analyst Intern')).toBeVisible();
    await expect(s.getByText('Applied', { exact: true }).first()).toBeVisible();

    // employer: notification, ranked candidate, status change
    await e.goto('/notifications');
    await expect(e.getByText(/Aigerim Nurlanova applied to “Python SQL Data Analyst Intern”/)).toBeVisible();
    await e.goto('/candidates');
    await expect(e.getByRole('heading', { name: 'Aigerim Nurlanova' })).toBeVisible();
    await expect(e.getByText('I love data <b>science</b>')).toBeVisible(); // escaped, shown as text
    await e.getByLabel('Set status').selectOption('shortlisted');
    await expect(e.getByText('Status updated')).toBeVisible();

    // student sees the status change + notification
    await s.goto('/applications');
    await expect(s.getByText('Shortlisted').first()).toBeVisible();
    await s.goto('/notifications');
    await expect(s.getByText(/Python SQL Data Analyst Intern” at Acme Technologies LLP: Shortlisted/)).toBeVisible();
    await expect(s.getByText(/New \d+% match/)).toBeVisible();
    await s.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(s.getByRole('link', { name: 'Notifications (0 unread)' })).toBeVisible();

    // student recommendations (applied vacancy is excluded) and role guards
    await s.goto('/recommendations');
    await expect(s.getByRole('link', { name: 'Python SQL Data Analyst Intern' })).toHaveCount(0); // applied vacancies are not recommended again
    await s.goto('/vacancies/mine');
    await expect(s).toHaveURL(/\/dashboard/);

    // admin analytics reflect the activity
    await nav(a, 'Analytics').click();
    await expect(a.getByRole('heading', { name: 'Platform analytics' })).toBeVisible();
    await expect(a.getByText('Top skills required by employers')).toBeVisible();
    await expect(a.getByRole('list', { name: 'Top skills required by employers' }).getByText('Python')).toBeVisible();
    await expect(a.getByText('Application funnel')).toBeVisible();
    for (const c of [adminCtx, empCtx, stuCtx]) await c.close();
  });

  test('CV upload: analysed skills + experience, add to profile, errors for fake files, download', async ({ page }) => {
    const stu = await apiStudent(page.request, []);
    await uiLogin(page, 'student', stu.id);
    await page.goto('/cv');
    await expect(page.getByText('You have not uploaded a CV yet.')).toBeVisible();
    await page.locator('#cv-file').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is plainly not a pdf file at all, sorry') });
    await expect(page.getByText('Only real PDF or DOCX files are accepted')).toBeVisible();
    await page.locator('#cv-file').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: makePdf(['Aigerim Nurlanova', 'Data Analyst, Acme 2021 - 2023', 'Skills: Python, SQL, Docker, Machine Learning', '3 years of experience']) });
    await expect(page.getByText('CV uploaded and analysed')).toBeVisible();
    const skills = page.getByRole('listitem').filter({ hasText: /^Docker$|^Python$|^SQL$|^Machine Learning$/ });
    await expect(skills).toHaveCount(4);
    await expect(page.getByText(/≈ [\d.]+ years in total/)).toBeVisible();
    await page.getByRole('button', { name: 'Add these skills to my profile' }).click();
    await expect(page.getByText('Added 4 skills to your profile')).toBeVisible();
    await page.goto('/profile');
    await expect(page.getByText('Docker', { exact: true })).toBeVisible();
    const dl = await page.request.get('/api/cv/file');
    expect(dl.status()).toBe(200);
    expect(dl.headers()['content-type']).toBe('application/pdf');
    await page.goto('/cv');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete CV' }).click();
    await expect(page.getByText('CV deleted')).toBeVisible();
  });

  test('the whole app is translated: Russian and Kazakh app pages show no raw keys', async ({ page }) => {
    const stu = await apiStudent(page.request, ['Python']);
    await uiLogin(page, 'student', stu.id);
    for (const lang of ['ru', 'kk'] as const) {
      await page.getByRole('button', { name: lang === 'ru' ? 'RU' : 'KZ', exact: true }).click(); // saved to users.preferred_language
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      for (const path of ['/dashboard', '/vacancies', '/recommendations', '/applications', '/cv', '/notifications', '/profile']) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await page.waitForLoadState('networkidle');
        const body = await page.locator('body').innerText();
        expect(body, `${lang} ${path}`).not.toMatch(/\b(app|common|auth|errors|options|profile):[a-zA-Z_.]+/);
        expect(body, `${lang} ${path}`).not.toMatch(/\b(nav|cv|search|detail|apps|rec|mine|form|appl|cand|notif|approvals|an)\.[a-zA-Z]+\b/);
        expect(body.length, `${lang} ${path} rendered`).toBeGreaterThan(50);
      }
    }
  });
});
