import { expect, test } from '@playwright/test';

// Mouse-input test for the Phase 1.7 click-to-place flow.
//
// 1. Click WORKER on the buildables panel → enters placement mode.
// 2. Click somewhere on the grid → unit spawns at that tile.
// 3. Verify the unit count grew.

test('click-to-place: WORKER button + tile click trains a worker', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');
  await page.waitForTimeout(500);

  const beforeText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const beforeUnits = parseInt(beforeText!.match(/units (\d+)/)![1], 10);

  // 1. Pick the kind.
  await page.getByRole('button', { name: /worker/i }).click();

  // 2. Click somewhere on the grid. The canvas is 100vw/100vh; the grid
  //    sits roughly in the centre. Pick a point near the middle.
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

  // Sim runs at 20 Hz; 400ms is 8 ticks — plenty for the queued train
  // command to apply.
  await page.waitForTimeout(400);

  const afterText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const afterUnits = parseInt(afterText!.match(/units (\d+)/)![1], 10);

  // The player's worker spawned. AI may have trained too, so just check
  // the lower bound.
  expect(afterUnits).toBeGreaterThan(beforeUnits);

  expect(consoleErrors).toEqual([]);

  await page.screenshot({ path: 'test-results/mouse-place.png', fullPage: false });
});

test('Esc cancels placement without spawning', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');
  await page.waitForTimeout(500);

  const beforeText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const beforeUnits = parseInt(beforeText!.match(/units (\d+)/)![1], 10);
  const beforeEnergy = parseInt(beforeText!.match(/you  hp \d+ {2}pts \d+ {2}e (\d+)/)![1], 10);

  // Enter placement mode, then bail with Esc.
  await page.getByRole('button', { name: /worker/i }).click();
  await page.keyboard.press('Escape');

  // Wait one sim tick so any phantom command would have applied.
  await page.waitForTimeout(200);

  const afterText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  const afterEnergy = parseInt(afterText!.match(/you  hp \d+ {2}pts \d+ {2}e (\d+)/)![1], 10);

  // Energy must not have been spent on a TrainUnit (would have decremented).
  // Workers may auto-assign and harvest, so afterEnergy can be > beforeEnergy
  // (deposit from harvest) but never beforeEnergy − 50 (the worker cost).
  expect(afterEnergy).toBeGreaterThanOrEqual(beforeEnergy - 1);

  // Unit count should be sane (might have grown from AI; not from us).
  // The strict invariant we care about is "no console error from the
  // cancelled placement."
  void beforeUnits;
  expect(consoleErrors).toEqual([]);
});
