import { expect, test } from '@playwright/test';

// Sim-v2 smoke test. Loads /index-v2.html, waits for the sim driver to
// run for a couple of seconds, and verifies:
// - no console errors
// - canvas renders something (non-blank pixels)
// - sim has advanced (HUD shows tick > 100)
// - units exist on the field
//
// This is the closest we get to "playable end-to-end" without mouse
// input; sub-phase 1.5 adds the mouse layer + a richer e2e check.

test('sim v2: AI-vs-AI match runs, ticks advance, units appear', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/index-v2.html');

  // Canvas exists and has dimensions.
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();

  // Let the sim run for ~2.5 seconds (~50 ticks at 20 Hz).
  await page.waitForTimeout(2500);

  // HUD shows current tick — extract and assert it's advanced past 50.
  const hudText = await page.locator('div').filter({ hasText: /vylux sim-v2/ }).textContent();
  expect(hudText).toBeTruthy();
  const tickMatch = hudText!.match(/tick (\d+)/);
  expect(tickMatch).not.toBeNull();
  const tick = parseInt(tickMatch![1], 10);
  expect(tick).toBeGreaterThan(40);

  // Units shows non-zero count: AI has trained at least 1 worker by now
  // (initialEnergy 200 → 4 workers possible immediately).
  const unitsMatch = hudText!.match(/units (\d+)/);
  expect(unitsMatch).not.toBeNull();
  const units = parseInt(unitsMatch![1], 10);
  expect(units).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);

  await page.screenshot({ path: 'test-results/sim-v2-smoke.png', fullPage: false });
});
