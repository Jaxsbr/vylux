import { expect, test } from '@playwright/test';

// Smoke test. Loads the dev server, waits for the sim driver to run for
// a couple of seconds, and verifies:
// - no console errors
// - canvas renders
// - sim has advanced (HUD shows tick > 40)
// - units exist on the field

test('AI-vs-AI match runs, ticks advance, units appear', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/?menu=skip');

  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();

  // Let the sim run for ~2.5 seconds (~50 ticks at 20 Hz).
  await page.waitForTimeout(2500);

  const hudText = await page.locator('div').filter({ hasText: /vylux ·/ }).textContent();
  expect(hudText).toBeTruthy();
  const tickMatch = hudText!.match(/tick (\d+)/);
  expect(tickMatch).not.toBeNull();
  const tick = parseInt(tickMatch![1], 10);
  expect(tick).toBeGreaterThan(40);

  const unitsMatch = hudText!.match(/units (\d+)/);
  expect(unitsMatch).not.toBeNull();
  const units = parseInt(unitsMatch![1], 10);
  expect(units).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);

  await page.screenshot({ path: 'test-results/smoke.png', fullPage: false });
});
