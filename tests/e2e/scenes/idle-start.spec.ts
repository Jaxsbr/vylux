import { test } from '@playwright/test';

test('idle-start scene snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');

  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.ready === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function',
    null,
    { timeout: 15_000 },
  );

  // Disable AI so the peaceful idle-start stays quiet.
  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
  await page.evaluate(() => window.__vylux!.setScene!('idle-start'));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 0, red: 0 }));
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 0, red: 0 }));
  await page.evaluate(() => window.__vylux!.ready!());

  await page.screenshot({ path: 'pm/screenshots/idle-start.png' });
});
