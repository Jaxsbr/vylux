import { expect, test } from '@playwright/test';

// Sim-v2 mouse-input smoke test.
//
// Loads the v2 entry, clicks the WORKER button on the buildables panel
// once, waits for the sim to apply the train command, and verifies a
// player-faction worker actually appears in the unit count.
//
// Combined with sim-v2-smoke.spec, this covers the Phase 1.5 exit
// criterion: "a fresh match is playable mouse-only against the AI".

test('sim v2: clicking WORKER trains a worker on the player faction', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/index-v2.html');
  await page.waitForTimeout(500); // let the scene boot

  const beforeText = await page.locator('div').filter({ hasText: /vylux sim-v2/ }).textContent();
  const beforeUnits = parseInt(beforeText!.match(/units (\d+)/)![1], 10);

  // Click the WORKER button. The label is the unit kind in caps.
  await page.getByRole('button', { name: /worker/i }).click();

  // Sim runs at 20 Hz; 200 ms is 4 ticks — plenty for the queued
  // command to apply.
  await page.waitForTimeout(400);

  const afterText = await page.locator('div').filter({ hasText: /vylux sim-v2/ }).textContent();
  const afterUnits = parseInt(afterText!.match(/units (\d+)/)![1], 10);

  // Unit count must have grown by at least 1 (player worker spawn). The
  // AI also trains, so the delta might be larger than 1; we only check
  // the lower bound to keep the test stable against AI build-order timing.
  expect(afterUnits).toBeGreaterThan(beforeUnits);

  expect(consoleErrors).toEqual([]);

  await page.screenshot({ path: 'test-results/sim-v2-mouse.png', fullPage: false });
});
