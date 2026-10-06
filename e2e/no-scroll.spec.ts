import { expect, test, type Page } from '@playwright/test';
import { LANGS, isWizardViewport, setLang } from './helpers';

const VIEWPORTS = [
  { width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 720 },
  { width: 1024, height: 768 }, { width: 1024, height: 700 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 360, height: 640 },
];

/** Types deliberately INVALID values into every visible control so each field shows its error text. */
async function showAllErrors(page: Page) {
  await page.locator('input:visible').first().waitFor(); // route chunks are lazy-loaded: wait until the form has mounted
  const bad: Record<string, string> = {
    studentId: '123', name: 'A', surname: 'B', phone: '70112', email: 'a@gmail.com', gpa: '4.5', password: 'abc', confirmPassword: 'x',
    companyName: 'X', bin: '12', contactName: 'T', contactSurname: 'O', position: 'H', website: 'ftp://x', description: 'ok',
  };
  for (const el of await page.locator('input:visible:not([type=checkbox]):not([type=radio]), select:visible, textarea:visible').all()) {
    const name = (await el.getAttribute('name')) ?? '';
    const tag = await el.evaluate((e) => e.tagName);
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (name in bad) await el.fill(bad[name]);
      await el.focus();
    } else await el.focus();
    await el.blur();
  }
  // dropdowns / pickers: touch them so "required" errors show
  await page.locator('body').click({ position: { x: 2, y: 2 } });
}

async function assertFits(page: Page, label: string, minErrors = 0) {
  const visibleErrors = await page.locator('p[id$="-err"]:visible').filter({ hasText: /\S/ }).count();
  expect(visibleErrors, `${label}: expected error messages to be visible`).toBeGreaterThanOrEqual(minErrors);
  const m = await page.evaluate(() => {
    const se = document.scrollingElement!;
    const clippedErrors = [...document.querySelectorAll<HTMLElement>('p[id$="-err"]')].filter((p) => p.scrollHeight > p.clientHeight + 1).map((p) => p.textContent);
    const widest = Math.max(...[...document.querySelectorAll<HTMLElement>('main *')].map((e) => e.getBoundingClientRect().right));
    return { sh: se.scrollHeight, ih: window.innerHeight, sw: se.scrollWidth, iw: window.innerWidth, clippedErrors, widest };
  });
  expect(m.sh, `${label}: vertical scroll (scrollHeight ${m.sh} > innerHeight ${m.ih})`).toBeLessThanOrEqual(m.ih);
  expect(m.sw, `${label}: horizontal scroll`).toBeLessThanOrEqual(m.iw);
  expect(m.clippedErrors, `${label}: clipped error text`).toEqual([]);
  expect(m.widest, `${label}: element past right edge`).toBeLessThanOrEqual(m.iw + 1);
}

for (const role of ['student', 'employer'] as const) {
  for (const lang of LANGS) {
    for (const vp of VIEWPORTS) {
      test(`register/${role} fits without scrolling — ${vp.width}x${vp.height} ${lang} (empty + all errors visible)`, async ({ page }) => {
        await setLang(page, lang);
        await page.setViewportSize(vp);
        await page.goto(`/register?role=${role}`);
        await page.evaluate(() => sessionStorage.clear());
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        const wizard = isWizardViewport(vp.width, vp.height);
        const steps = wizard ? 3 : 1;
        for (let s = 0; s < steps; s++) {
          await assertFits(page, `${role} ${lang} ${vp.width}x${vp.height} step ${s + 1} (clean)`);
          await showAllErrors(page);
          await assertFits(page, `${role} ${lang} ${vp.width}x${vp.height} step ${s + 1} (errors visible)`, 3);
          if (wizard && s < 2) {
            // jump to the next step through the stored step index (Next is disabled while the step is invalid — by design)
            await page.evaluate(([k, i]) => sessionStorage.setItem(k, String(i)), [`step:${role}`, s + 1] as const);
            await page.reload();
          }
        }
      });
    }
  }
}

for (const lang of LANGS) {
  for (const vp of VIEWPORTS) {
    for (const path of ['/login', '/recover']) {
      test(`${path} fits without scrolling — ${vp.width}x${vp.height} ${lang}`, async ({ page }) => {
        await setLang(page, lang);
        await page.setViewportSize(vp);
        await page.goto(path);
        await showAllErrors(page);
        await assertFits(page, `${path} ${lang} ${vp.width}x${vp.height}`, path === '/login' ? 1 : 0);
        await page.goto(`${path}?role=employer`);
        await showAllErrors(page);
        await assertFits(page, `${path} employer ${lang} ${vp.width}x${vp.height}`);
      });
    }
  }
}
