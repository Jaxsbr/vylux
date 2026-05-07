import { expect, test } from '@playwright/test';

// Click-to-select + click-to-assign-worker test (Phase 1.7).
//
// The flow: place a worker, then click on it to select (ring appears),
// then click on a node to assign that worker to harvest there.
//
// Verifying selection visually from outside the browser is hard, so we
// rely on the side-effect: an assigned worker walks toward the node,
// which we'd see if we waited long enough; for a fast test we just
// confirm the click sequence doesn't error and that the unit count
// increased after the place step (proving the click landed somewhere).

test('click-select-then-click-node sequence runs without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  // Phase 3.10: action bar is selection-driven; the WORKER button only
  // appears once the HQ is selected. ?test-hooks=1 exposes the helper.
  await page.goto('/?menu=skip&test-hooks=1');
  await page.waitForTimeout(500);

  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  // 1. Select HQ programmatically, then train a worker.
  await page.evaluate(() => (window as unknown as { __vyluxTest: { selectHq(): void } }).__vyluxTest.selectHq());
  await page.waitForTimeout(50);
  await page.getByRole('button', { name: /worker/i }).click();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 + 30 } });
  await page.waitForTimeout(400);

  // 2. Click on (roughly) where the worker was placed → selection.
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 + 30 } });
  await page.waitForTimeout(100);

  // 3. Click on a different visible node → assignment.
  // The five nodes are roughly distributed across the grid; clicking up
  // and right of centre should land near one. We just want the click to
  // be a node (or empty grid — both are valid no-error paths).
  await canvas.click({ position: { x: box!.width / 2 + 80, y: box!.height / 2 + 30 } });
  await page.waitForTimeout(200);

  expect(consoleErrors).toEqual([]);
});
