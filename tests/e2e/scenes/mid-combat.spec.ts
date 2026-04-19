import { test } from '@playwright/test';

test('mid-combat scene snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');

  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.ready === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function' &&
      typeof window.__vylux.dismissOnboardingCue === 'function',
    null,
    { timeout: 15_000 },
  );

  // AI off — use hand-seeded tableau for deterministic mid-combat composition.
  // Raiders are seeded directly adjacent to red HQ so combat fires immediately.
  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
  await page.evaluate(() => window.__vylux!.setScene!('mid-combat'));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 58, red: 43 }));
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 145, red: 132 }));
  // Node 0 (5,5) held by blue economy; node 3 (14,14) held by red.
  await page.evaluate(() => window.__vylux!.setNodeHolds!({ 0: 'blue', 3: 'red' }));

  // Dismiss onboarding cue — match is clearly underway.
  await page.evaluate(() => window.__vylux!.dismissOnboardingCue!());

  // Advance briefly so HP bars update and attack beams fire.
  await page.evaluate(() => window.__vylux!.advanceTime!(1.0));

  await page.evaluate(() => window.__vylux!.ready!());

  await page.screenshot({ path: 'pm/screenshots/mid-combat.png' });
});
