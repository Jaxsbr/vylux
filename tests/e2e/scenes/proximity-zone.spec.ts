import { test } from '@playwright/test';

test('proximity-zone scene: ghost zone highlight around blue HQ with buildable armed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');

  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.ready === 'function' &&
      typeof window.__vylux.openBuildablesPanel === 'function' &&
      typeof window.__vylux.armBuildable === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function',
    null,
    { timeout: 15_000 },
  );

  // Disable AI so the scene stays clean.
  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
  await page.evaluate(() => window.__vylux!.setScene!('idle-start'));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 0, red: 0 }));

  // Open the buildables panel and arm the Worker buildable.
  // This triggers the proximity zone highlight around the blue HQ in scene.ts reconcile.
  await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
  await page.evaluate(() => window.__vylux!.armBuildable!('worker'));

  await page.evaluate(() => window.__vylux!.ready!());

  await page.screenshot({ path: 'pm/screenshots/proximity-zone.png' });
});
