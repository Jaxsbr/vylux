import { expect, test } from '@playwright/test';

// Mouse-input smoke test. Loads the dev server, clicks the WORKER button
// on the buildables panel once, and verifies a player-faction worker
// actually appears in the unit count.
//
// Combined with smoke.spec, this is the Phase 1 exit-criterion check:
// "a fresh match is playable mouse-only against the AI".

test('clicking WORKER trains a worker on the player faction', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');
  await page.waitForTimeout(500);

  const beforeText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const beforeUnits = parseInt(beforeText!.match(/units (\d+)/)![1], 10);

  await page.getByRole('button', { name: /worker/i }).click();

  // Sim runs at 20 Hz; 400 ms is 8 ticks — plenty for the queued command
  // to apply.
  await page.waitForTimeout(400);

  const afterText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const afterUnits = parseInt(afterText!.match(/units (\d+)/)![1], 10);

  // Unit count must have grown. AI also trains, so the delta may be > 1;
  // only check the lower bound to keep the test stable against AI
  // build-order timing.
  expect(afterUnits).toBeGreaterThan(beforeUnits);

  expect(consoleErrors).toEqual([]);

  await page.screenshot({ path: 'test-results/mouse.png', fullPage: false });
});
