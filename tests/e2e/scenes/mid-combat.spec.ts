import { test } from '@playwright/test';

test('mid-combat scene snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');

  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.ready === 'function',
    null,
    { timeout: 15_000 },
  );

  await page.evaluate(() => window.__vylux!.setScene!('mid-combat'));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 58, red: 43 }));
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 145, red: 132 }));
  await page.evaluate(() => window.__vylux!.ready!());

  await page.screenshot({ path: 'pm/screenshots/mid-combat.png' });
});
