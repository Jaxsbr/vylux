import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getRedWorkerTaskPhase === 'function' &&
      typeof window.__vylux.getRedWorkerTargetTile === 'function' &&
      typeof window.__vylux.assignRedWorkerToNodeByIndex === 'function' &&
      typeof window.__vylux.getNodeReserve === 'function' &&
      typeof window.__vylux.setEnergy === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('AI worker parity — red workers follow walk/harvest/offload loop', () => {
  test('red worker assigned to node transitions through task phases', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Use the red-worker-specific hook (red starters are workers 0,1 of red faction).
    const initialPhase = await page.evaluate(() =>
      window.__vylux!.getRedWorkerTaskPhase!(0),
    );
    expect(initialPhase).toBe('idle');

    // Assign red worker 0 to node 3 (14,14) — nearest to red HQ (16,9).
    await page.evaluate(() => window.__vylux!.assignRedWorkerToNodeByIndex!(0, 3));

    const phaseAfterAssign = await page.evaluate(() =>
      window.__vylux!.getRedWorkerTaskPhase!(0),
    );
    expect(phaseAfterAssign).toBe('walking-to-node');

    // Advance time for the worker to reach node 3 (distance from (15,9) to (14,14) ≈ 5.1 tiles at 2 t/s ≈ 2.6s).
    await page.evaluate(() => window.__vylux!.advanceTime!(4.0));

    const phaseAtNode = await page.evaluate(() =>
      window.__vylux!.getRedWorkerTaskPhase!(0),
    );
    expect(phaseAtNode).toBe('harvesting');

    // Advance harvest (4s) + walk-back time.
    await page.evaluate(() => window.__vylux!.advanceTime!(6.0));

    const phaseAfterHarvest = await page.evaluate(() =>
      window.__vylux!.getRedWorkerTaskPhase!(0),
    );
    // Should now be walking to HQ or offloading.
    expect(['walking-to-hq', 'offloading', 'walking-to-node']).toContain(
      phaseAfterHarvest,
    );
  });

  test('red worker completes a full trip and offloads energy to red pool', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Zero out energy.
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 0, red: 0 }));

    // Assign red worker 0 to node 3.
    await page.evaluate(() => window.__vylux!.assignRedWorkerToNodeByIndex!(0, 3));

    // Full trip: walk (~3s) + harvest (4s) + walk-back (~3s) + offload (0.5s) = ~11s + buffer.
    await page.evaluate(() => window.__vylux!.advanceTime!(14.0));

    const energy = await page.evaluate(() => window.__vylux!.getEnergy!());
    // Red should have received BASE_INCOME × 14 + at least one HARVEST_YIELD.
    expect(energy.red).toBeGreaterThan(14); // > 14 means at least one harvest offloaded
  });

  test('red worker travels node → red HQ → node (screenshot)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');

    await page.waitForFunction(
      () =>
        typeof window.__vylux !== 'undefined' &&
        typeof window.__vylux.assignRedWorkerToNodeByIndex === 'function' &&
        typeof window.__vylux.advanceTime === 'function' &&
        typeof window.__vylux.dismissOnboardingCue === 'function' &&
        typeof window.__vylux.ready === 'function',
      null,
      { timeout: 15_000 },
    );

    await page.evaluate(() => window.__vylux!.dismissOnboardingCue!());
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 20, red: 20 }));

    // Assign both red workers to nodes for visual density.
    await page.evaluate(() => window.__vylux!.assignRedWorkerToNodeByIndex!(0, 3));
    await page.evaluate(() => window.__vylux!.assignRedWorkerToNodeByIndex!(1, 2));

    // Advance to mid-harvest state.
    await page.evaluate(() => window.__vylux!.advanceTime!(6.0));

    await page.evaluate(() => window.__vylux!.ready!());
    await page.screenshot({ path: 'pm/screenshots/ai-worker-parity.png' });
  });
});
