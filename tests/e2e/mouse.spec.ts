import { expect, test } from '@playwright/test';

// Mouse-input test: clicking a buildables button trains the unit at HQ
// (standard RTS macro flow). No tile click required.

test('clicking WORKER trains a worker (spawns at HQ)', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  // Phase 3.10: action bar is selection-driven; the WORKER button only
  // appears once the HQ is selected. ?test-hooks=1 exposes a window
  // helper that does that programmatically (see main.ts).
  // Phase 3.10.9: ?debug=1 enables the legacy text HUD this test
  // scrapes (the new player-facing HUD is DOM cards, not parseable
  // text). The debug panel carries the same dense "units N / you hp X
  // e Y" format the player-facing HUD used to expose by default.
  await page.goto('/?menu=skip&test-hooks=1&debug=1');
  await page.waitForTimeout(500);

  const beforeText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const beforeUnits = parseInt(beforeText!.match(/units (\d+)/)![1], 10);
  const beforeEnergy = parseInt(beforeText!.match(/you  hp \d+ {2}e (\d+)/)![1], 10);

  await page.evaluate(() => (window as unknown as { __vyluxTest: { selectHq(): void } }).__vyluxTest.selectHq());
  await page.waitForTimeout(50);
  await page.getByRole('button', { name: /worker/i }).click();

  // 400ms = 8 sim ticks at 20 Hz. The TrainUnit command queues for the
  // next tick and the worker spawns then.
  await page.waitForTimeout(400);

  const afterText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const afterUnits = parseInt(afterText!.match(/units (\d+)/)![1], 10);
  const afterEnergy = parseInt(afterText!.match(/you  hp \d+ {2}e (\d+)/)![1], 10);

  // Unit count grew (player worker + AI activity).
  expect(afterUnits).toBeGreaterThan(beforeUnits);
  // Player energy decreased — proves the train actually charged us.
  // Worker costs 50; we may have gained back some from harvest deposits
  // by tick 8, so allow a wide band but require we spent at least 30.
  expect(beforeEnergy - afterEnergy).toBeGreaterThanOrEqual(30);

  expect(consoleErrors).toEqual([]);

  await page.screenshot({ path: 'test-results/mouse.png', fullPage: false });
});
