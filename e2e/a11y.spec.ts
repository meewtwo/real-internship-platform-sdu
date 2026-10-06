import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LANGS, setLang } from './helpers';

// Automated WCAG 2.x A/AA scan of the public pages in every language. Serious/critical violations fail the build.
for (const lang of LANGS) {
  for (const path of ['/', '/login', '/register', '/recover']) {
    test(`axe: ${path} (${lang})`, async ({ page }) => {
      await setLang(page, lang);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
}
