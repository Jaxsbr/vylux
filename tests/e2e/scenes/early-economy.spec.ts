import { test } from '@playwright/test';

test('early-economy scene snapshot', async ({ page }) => {
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

  await page.evaluate(() => window.__vylux!.setScene!('early-economy'));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 24, red: 17 }));
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 6, red: 4 }));
  // Node 0 (5,5) and node 1 (14,5) held by blue; node 3 (14,14) held by red.
  await page.evaluate(() => window.__vylux!.setNodeHolds!({ 0: 'blue', 1: 'blue', 3: 'red' }));
  await page.evaluate(() => window.__vylux!.ready!());

  await page.screenshot({ path: 'pm/screenshots/early-economy.png' });
});
