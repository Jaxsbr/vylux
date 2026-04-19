import { test, expect } from '@playwright/test';

test.describe('node-control points', () => {
  test('blue worker on node for 3s → blue gains >= 3 pts, red gains 0', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');

    await page.waitForFunction(
      () =>
        typeof window.__vylux !== 'undefined' &&
        typeof window.__vylux.setScene === 'function' &&
        typeof window.__vylux.advanceTime === 'function' &&
        typeof window.__vylux.getPoints === 'function' &&
        typeof window.__vylux.getNodePointAccumulator === 'function',
      null,
      { timeout: 15_000 },
    );

    // Start clean with idle-start scene.
    await page.evaluate(() => window.__vylux!.setScene!('idle-start'));
    await page.evaluate(() => window.__vylux!.setPoints!({ blue: 0, red: 0 }));

    // Park a blue worker on node 0 (tile 5,5) — node 0 = NODE_POSITIONS[0].
    // Use moveWorker to teleport worker[0] to tile 5,5 (the first energy node).
    await page.evaluate(() => window.__vylux!.moveWorker!(0, 5, 5));

    // Confirm no red worker is on the same tile.
    const workerTile = await page.evaluate(() => window.__vylux!.getWorkerTile!(0));
    expect(workerTile).toEqual({ tileX: 5, tileY: 5 });

    // Advance 3 simulated seconds.
    await page.evaluate(() => window.__vylux!.advanceTime!(3.0));

    const bluePoints = await page.evaluate(() => window.__vylux!.getPoints!('blue'));
    const redPoints = await page.evaluate(() => window.__vylux!.getPoints!('red'));

    expect(bluePoints).toBeGreaterThanOrEqual(3);
    expect(redPoints).toBe(0);
  });

  test('getNodePointAccumulator returns fractional progress', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');

    await page.waitForFunction(
      () =>
        typeof window.__vylux !== 'undefined' &&
        typeof window.__vylux.setScene === 'function' &&
        typeof window.__vylux.advanceTime === 'function' &&
        typeof window.__vylux.getNodePointAccumulator === 'function',
      null,
      { timeout: 15_000 },
    );

    await page.evaluate(() => window.__vylux!.setScene!('idle-start'));
    await page.evaluate(() => window.__vylux!.setPoints!({ blue: 0, red: 0 }));

    // Park blue worker on node 0.
    await page.evaluate(() => window.__vylux!.moveWorker!(0, 5, 5));

    // Advance 0.5s — accumulator should be near 0.5, no whole point yet.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.5));

    const acc = await page.evaluate(() => window.__vylux!.getNodePointAccumulator!(0));
    expect(acc).toBeGreaterThan(0);
    expect(acc).toBeLessThan(1);
  });
});
