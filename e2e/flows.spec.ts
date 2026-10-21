import { expect, test, type Page } from '@playwright/test';
import { logout } from './fixtures';
import { PASSWORD, fillStudentDesktop, gotoStep, gradIn, lastCode, mailCount, pickCity, setLang, typeCode, uniqueEmployer, uniqueStudent } from './helpers';

const register = (page: Page) => page.goto('/register');
const createBtn = (page: Page) => page.getByRole('button', { name: 'Create account' });

test.describe('student registration (desktop single screen)', () => {
  test('QA: valid ID + name + email + matching passwords → account created, verified by emailed code, persisted in DB', async ({ page }) => {
    const s = uniqueStudent();
    await register(page);
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    await fillStudentDesktop(page, s);
    await expect(createBtn(page)).toBeEnabled();
    await createBtn(page).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await typeCode(page, await lastCode(page, s.email));
    await expect(page.getByRole('heading', { name: /Hello, Aigerim/ })).toBeVisible();
    // data came from the DB: reload keeps the session and shows the profile with persisted values
    await page.goto('/profile');
    await expect(page.getByLabel('First name')).toHaveValue('Aigerim');
    await expect(page.getByLabel('GPA (0–4)')).toHaveValue('3.65');
    await expect(page.getByLabel(/Student ID/)).toHaveValue(s.id);
    await expect(page.getByLabel(/Student ID/)).toHaveJSProperty('readOnly', true);
  });

  test('QA: letters in Student ID are stripped and a wrong length is blocked with an error; button stays disabled', async ({ page }) => {
    const s = uniqueStudent();
    await register(page);
    const id = page.getByLabel('Student ID');
    await id.pressSequentially('12ab34cd-56 7٣');
    await expect(id).toHaveValue('1234567');
    await id.blur();
    await expect(page.getByText('Student ID must be exactly 9 digits')).toBeVisible();
    await fillStudentDesktop(page, s, { studentId: '12345678' });
    await expect(page.getByText('Student ID must be exactly 9 digits')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    await id.fill('123456789');
    await expect(page.getByText('Student ID must be exactly 9 digits')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('QA: passwords that do not match block submit; error re-checked when the first field changes', async ({ page }) => {
    await register(page);
    await fillStudentDesktop(page, uniqueStudent(), { confirm: 'Different#1234' });
    await expect(page.getByText('Passwords do not match')).toBeVisible();
    await expect(createBtn(page)).toBeDisabled();
    await page.getByLabel('Password', { exact: true }).fill('Different#1234');
    await expect(page.getByText('Passwords do not match')).toHaveCount(0);
    await expect(createBtn(page)).toBeEnabled();
    await page.getByLabel('Password', { exact: true }).fill('Another#Pass99');
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });

  test('QA: switching language keeps entered values and re-translates visible errors immediately', async ({ page }) => {
    await register(page);
    await page.getByLabel('Student ID').fill('123');
    await page.getByLabel('First name').fill('Aigerim');
    await page.getByLabel('Student ID').blur();
    await expect(page.getByText('Student ID must be exactly 9 digits')).toBeVisible();
    await page.getByRole('button', { name: 'RU' }).click();
    await expect(page.getByText('ID студента — ровно 9 цифр')).toBeVisible();
    await expect(page.getByLabel('ID студента')).toHaveValue('123');
    await expect(page.getByLabel('Имя')).toHaveValue('Aigerim');
    await page.getByRole('button', { name: 'KZ' }).click();
    await expect(page.getByText('Студент ID — дәл 9 сан')).toBeVisible();
    await expect(page.getByLabel('Студент ID')).toHaveValue('123');
    await expect(page).toHaveTitle(/Тіркелу/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'kk'); // persisted
  });

  test('Enter cannot bypass the disabled button; no request is sent for an invalid form', async ({ page }) => {
    await register(page);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/api/auth/register')) requests.push(r.url()); });
    await page.getByLabel('Student ID').fill('123456789');
    await page.getByLabel('Student ID').press('Enter');
    await page.getByLabel('First name').press('Enter');
    await page.waitForTimeout(400);
    expect(requests).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toHaveCount(0);
  });

  test('double-click on submit creates exactly one account (one code email)', async ({ page }) => {
    const s = uniqueStudent();
    await register(page);
    await fillStudentDesktop(page, s);
    await createBtn(page).dblclick();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    expect(await mailCount(page, s.email)).toBe(1);
  });

  test('duplicate Student ID / email are rejected with clean field errors', async ({ page, browser }) => {
    const s = uniqueStudent();
    await register(page);
    await fillStudentDesktop(page, s);
    await createBtn(page).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    const p2 = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    await p2.goto('/register');
    const other = uniqueStudent();
    await fillStudentDesktop(p2, { ...other, phone7: s.phone7 }, { studentId: s.id, email: s.email.toUpperCase() });
    await p2.getByRole('button', { name: 'Create account' }).click();
    await expect(p2.getByText('This Student ID is already registered')).toBeVisible();
    await expect(p2.getByText('This email is already registered')).toBeVisible();
    await expect(p2.getByText('This phone is already registered')).toBeVisible();
    await p2.context().close();
  });

  test('email domain rules: lookalikes and other domains are blocked', async ({ page }) => {
    await register(page);
    const email = page.getByLabel('University email');
    for (const bad of ['a@gmail.com', 'a@sdu.edu.kz.evil.com', 'a@sdu-edu.kz', 'a@xsdu.edu.kz', 'a@mail.sdu.edu.kz', 'a@@sdu.edu.kz']) {
      await email.fill(bad);
      await email.blur();
      await expect(page.locator('p[id$="-err"]').filter({ hasText: /@sdu\.edu\.kz|valid email/ }).first(), bad).toBeVisible();
    }
    await email.fill('Valid.Name@SDU.EDU.KZ');
    await expect(page.locator('p[id$="-err"]').filter({ hasText: /@sdu\.edu\.kz|valid email/ })).toHaveCount(0);
  });

  test('GPA control blocks e, +, -, letters and more than 2 decimals; comma becomes dot', async ({ page }) => {
    await gotoStep(page, 'student', 2);
    const gpa = page.getByLabel('GPA (0–4)');
    await gpa.pressSequentially('e+-x3,999');
    await expect(gpa).toHaveValue('3.99');
    await gpa.fill('4');
    await gpa.pressSequentially('.5');
    await expect(page.getByText('GPA must be between 0.00 and 4.00')).toBeVisible();
  });

  test('graduation date rules: past, too far, inconsistent with year of study', async ({ page }) => {
    await gotoStep(page, 'student', 2);
    await page.getByLabel('Year of study').selectOption('4');
    await page.getByLabel('Month').selectOption('6');
    await page.getByLabel('Year', { exact: true }).selectOption({ index: 1 }); // current year
    const g = gradIn(60);
    await page.getByLabel('Month').selectOption(g.month);
    await page.getByLabel('Year', { exact: true }).selectOption(g.year);
    await expect(page.getByText("Doesn't match your year of study").or(page.getByText('No more than 6 years ahead'))).toBeVisible();
    const ok = gradIn(10);
    await page.getByLabel('Month').selectOption(ok.month);
    await page.getByLabel('Year', { exact: true }).selectOption(ok.year);
    await expect(page.getByText("Doesn't match your year of study")).toHaveCount(0);
  });

  test('city: searchable, translated, "Other" accepts letters-only free text', async ({ page }) => {
    await setLang(page, 'ru');
    await gotoStep(page, 'student', 2);
    const box = page.getByRole('combobox', { name: /Город проживания/ });
    await box.click();
    await box.fill('карага');
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2); // Караганда + "Другой…"
    await box.fill('');
    await page.getByRole('option', { name: 'Другой…' }).click();
    const other = page.getByPlaceholder('Введите город');
    await other.fill('Ala2ty');
    await other.blur();
    await expect(page.getByText('Город: только буквы, 2–60 символов')).toBeVisible();
    await other.fill('Мариуполь');
    await expect(page.getByText('Город: только буквы, 2–60 символов')).toHaveCount(0);
  });

  test('wizard draft survives refresh (values + step) but passwords are never stored', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page);
    await page.getByLabel('Student ID').fill('230107010');
    await page.getByLabel('First name').fill('Aigerim');
    await page.getByLabel('Last name').fill('Nurlanova');
    await page.getByLabel('University email').fill('ai@sdu.edu.kz');
    await page.getByLabel('Phone').fill('7011234567');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 3')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Step 2 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Student ID')).toHaveValue('230107010');
    await expect(page.getByLabel('University email')).toHaveValue('ai@sdu.edu.kz');
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
    expect(stored).not.toMatch(/password/i);
  });
});

test.describe('wizard on a phone', () => {
  test('complete 3-step registration at 360x640 with Back/Next', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const s = uniqueStudent();
    const g = gradIn(24);
    await register(page);
    const next = page.getByRole('button', { name: 'Next' });
    await expect(next).toBeDisabled();
    await page.getByLabel('Student ID').fill(s.id);
    await page.getByLabel('First name').fill('Aigerim');
    await page.getByLabel('Last name').fill('Nurlanova');
    await page.getByLabel('University email').fill(s.email);
    await expect(next).toBeDisabled(); // phone missing
    await page.getByLabel('Phone').fill(s.phone7);
    await next.click();
    await pickCity(page, 'Ast');
    await page.getByLabel('Major').selectOption('finance');
    await page.getByLabel('Year of study').selectOption('3');
    await page.getByLabel('GPA (0–4)').fill('3.2');
    await page.getByLabel('Month').selectOption(g.month);
    await page.getByLabel('Year', { exact: true }).selectOption(g.year);
    await next.click();
    await page.getByLabel('Internship interest').selectOption('finance_banking');
    await page.getByRole('radiogroup', { name: /relocation/i }).getByText('Remote only').click();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await expect(createBtn(page)).toBeDisabled(); // terms
    await page.getByRole('checkbox').check();
    await expect(createBtn(page)).toBeEnabled();
    await createBtn(page).click();
    await typeCode(page, await lastCode(page, s.email));
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
  });
});

test.describe('verification, login, recovery', () => {
  async function registerAndLeave(page: Page) {
    const s = uniqueStudent();
    await register(page);
    await fillStudentDesktop(page, s);
    await createBtn(page).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    return s;
  }

  test('wrong code shows an error, paste fills all 6 boxes, resend has a 60 s countdown', async ({ page }) => {
    const s = await registerAndLeave(page);
    await expect(page.getByRole('button', { name: /Resend in \d+ s/ })).toBeDisabled();
    const real = await lastCode(page, s.email);
    const wrong = real === '000000' ? '111111' : '000000';
    await typeCode(page, wrong);
    await expect(page.getByText('Incorrect code')).toBeVisible();
    // paste the right code into the first box
    const first = page.getByRole('group', { name: '6-digit code' }).locator('input').first();
    await first.click();
    await page.evaluate((c) => {
      const el = document.activeElement as HTMLInputElement;
      const dt = new DataTransfer(); dt.setData('text', c);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, real);
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
  });

  test('refresh keeps the verification screen; unverified login offers a new code', async ({ page }) => {
    const s = await registerAndLeave(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/login');
    await page.getByLabel('Student ID').fill(s.id);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).last().click();
    await expect(page.getByText('Email not verified')).toBeVisible();
    await page.getByRole('button', { name: 'Send a new code' }).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await typeCode(page, await lastCode(page, s.email));
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
  });

  test('login: button disabled until valid; generic error; lockout after 5 failures; logout', async ({ page }) => {
    const s = await registerAndLeave(page);
    await typeCode(page, await lastCode(page, s.email));
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
    const submit = page.locator('form').getByRole('button', { name: 'Sign In' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Student ID').fill('123');
    await page.getByLabel('Password', { exact: true }).fill('x');
    await expect(submit).toBeDisabled();
    await page.getByLabel('Student ID').fill(s.id);
    await expect(submit).toBeEnabled();
    for (let i = 0; i < 4; i++) { await submit.click(); await expect(page.getByText('Invalid ID/email or password')).toBeVisible(); }
    await submit.click();
    await expect(page.getByText(/Too many failed attempts/)).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await submit.click();
    await expect(page.getByText(/Too many failed attempts/)).toBeVisible(); // still locked with the right password
  });

  test('password recovery: generic message, code + new password, old password stops working', async ({ page }) => {
    const s = await registerAndLeave(page);
    await typeCode(page, await lastCode(page, s.email));
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
    await logout(page);
    await page.goto('/recover');
    await page.getByLabel('Student ID').fill(s.id);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('If the account exists, a code was sent.')).toBeVisible();
    await typeCode(page, await lastCode(page, s.email, 'reset'));
    await page.getByLabel('New password').fill('Nw7$kTq9!vBn');
    await page.getByLabel('Confirm password').fill('Nw7$kTq9!vBn');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();
    await page.getByRole('link', { name: 'Go to sign in' }).click();
    await page.getByLabel('Student ID').fill(s.id);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.locator('form').getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Invalid ID/email or password')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('Nw7$kTq9!vBn');
    await page.locator('form').getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
  });
});

test.describe('profiles (persisted through the API)', () => {
  test('student: edit, skills autocomplete, XSS stays inert, reload shows saved data', async ({ page }) => {
    const s = uniqueStudent();
    await register(page);
    await fillStudentDesktop(page, s);
    await createBtn(page).click();
    await typeCode(page, await lastCode(page, s.email));
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
    await page.goto('/profile');
    await page.getByLabel('First name').fill('Dana');
    await page.getByLabel('GPA (0–4)').fill('3,9');
    const skills = page.getByLabel('Skills');
    await skills.fill('pyth');
    await page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name: 'Python' }).click();
    await skills.fill('<img src=x onerror="window.__xss=1">');
    await skills.press('Enter');
    await expect(page.getByText(/2–40 characters/)).toBeVisible();
    await skills.fill('Machine Learning');
    await skills.press('Enter');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('First name')).toHaveValue('Dana');
    await expect(page.getByLabel('GPA (0–4)')).toHaveValue('3.90');
    await expect(page.getByText('Python', { exact: true })).toBeVisible();
    await expect(page.getByText('Machine Learning', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('employer: registers on its own form, verifies, is "pending", edits company profile, description XSS is escaped', async ({ page }) => {
    const e = uniqueEmployer();
    await page.goto('/register?role=employer');
    const next = page.getByRole('button', { name: 'Next' });
    await page.getByLabel('Company name').fill('Acme Technologies LLP');
    await page.getByLabel('IIN', { exact: true }).fill(e.bin);
    await pickCity(page, 'Ast');
    // "Other" industry asks for the company's own words below the dropdown, and Next waits for them
    await expect(page.getByLabel('Your industry')).toHaveCount(0);
    await page.getByLabel('Industry', { exact: true }).selectOption('other');
    await expect(page.getByPlaceholder('Please specify your industry')).toBeVisible();
    await page.getByLabel('Company size').selectOption('s51_200');
    await expect(next).toBeDisabled();
    await page.getByLabel('Your industry').fill('  Esports');
    await next.click();
    await page.getByLabel('Contact first name').fill('Timur');
    await page.getByLabel('Contact last name').fill('Ospanov');
    await page.getByLabel('Contact position').fill('HR Manager');
    await page.getByLabel('Phone').fill(e.phone7);
    await page.getByLabel('Work email').fill('boss@gmail.com');
    await page.getByLabel('Work email').blur();
    await expect(page.getByText('Use a corporate email (no free providers)')).toBeVisible();
    await expect(next).toBeDisabled();
    await page.getByLabel('Work email').fill(e.email);
    await next.click();
    await page.getByLabel('About the company (optional)').fill('<script>window.__xss=1</script> We build things');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await typeCode(page, await lastCode(page, e.email));
    await expect(page.getByText(/awaiting administrator approval/)).toBeVisible();
    await page.goto('/profile');
    await expect(page.getByLabel(/IIN/)).toHaveValue(e.bin);
    await expect(page.getByLabel('Industry', { exact: true })).toHaveValue('other');
    await expect(page.getByLabel('Your industry')).toHaveValue('Esports');
    await page.getByLabel('Company name').fill('Acme Renamed LLP');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Company name')).toHaveValue('Acme Renamed LLP');
    await expect(page.getByLabel('About the company (optional)')).toHaveValue(/<script>window\.__xss=1<\/script> We build things/);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});

test.describe('security through the browser session', () => {
  test('API rejects a missing CSRF token and mass-assignment even with a valid session', async ({ page }) => {
    const s = uniqueStudent();
    await register(page);
    await fillStudentDesktop(page, s);
    await createBtn(page).click();
    await typeCode(page, await lastCode(page, s.email));
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
    const noCsrf = await page.request.put('/api/profile/student', { data: {} });
    expect(noCsrf.status()).toBe(403);
    expect((await noCsrf.json()).error.code).toBe('CSRF_INVALID');
    const csrf = (await (await page.request.get('/api/auth/csrf')).json()).token;
    const me = await page.request.put('/api/profile/student', { headers: { 'x-csrf-token': csrf }, data: { role: 'admin', status: 'active' } });
    expect(me.status()).toBe(400);
    expect((await me.json()).error.code).toBe('UNKNOWN_FIELDS');
    const big = await page.request.post('/api/auth/login', { headers: { 'x-csrf-token': csrf }, data: { role: 'student', identifier: '1', password: 'x'.repeat(200_000) } });
    expect(big.status()).toBe(413);
  });
});
