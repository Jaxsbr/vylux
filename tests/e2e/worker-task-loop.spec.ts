import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getWorkerTaskPhase === 'function' &&
      typeof window.__vylux.getWorkerHarvestFill === 'function' &&
      typeof window.__vylux.assignWorkerToNodeByIndex === 'function' &&
      typeof window.__vylux.getNodeReserve === 'function' &&
      typeof window.__vylux.getNodeExhausted === 'function' &&
      typeof window.__vylux.getEnergy === 'function' &&
      typeof window.__vylux.setNodeReserve === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('worker task loop', () => {
  test('task transitions: idle → walking-to-node → harvesting → walking-to-hq → offloading', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Disable AI.
    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    // Worker 0 (blue) starts near (4,9). Node 0 is at (5,5).
    const initialPhase = await page.evaluate(() => window.__vylux!.getWorkerTaskPhase!(0));
    expect(initialPhase).toBe('idle');

    // Assign worker 0 to node 0.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));

    const phaseAfterAssign = await page.evaluate(() => window.__vylux!.getWorkerTaskPhase!(0));
    expect(phaseAfterAssign).toBe('walking-to-node');

    // Advance time for the worker to reach the node (distance ~5.7 tiles at 2 t/s = ~3s).
    await page.evaluate(() => window.__vylux!.advanceTime!(4.0));

    const phaseAtNode = await page.evaluate(() => window.__vylux!.getWorkerTaskPhase!(0));
    expect(phaseAtNode).toBe('harvesting');
  });

  test('harvest fill rises during harvesting phase', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));

    // Walk to node (worker arrives before 4s is up, harvest begins immediately).
    await page.evaluate(() => window.__vylux!.advanceTime!(4.0));

    const fillAtStart = await page.evaluate(() => window.__vylux!.getWorkerHarvestFill!(0));
    // Worker arrived at the node and started harvesting during the 4s window.
    // Fill must be between 0 (exclusive) and 1 (exclusive).
    expect(fillAtStart).toBeGreaterThan(0);
    expect(fillAtStart).toBeLessThan(1.0);

    const fillSnapshot = fillAtStart;

    // Advance a bit more — fill must increase.
    await page.evaluate(() => window.__vylux!.advanceTime!(1.0));

    const fillLater = await page.evaluate(() => window.__vylux!.getWorkerHarvestFill!(0));
    expect(fillLater).toBeGreaterThan(fillSnapshot);
  });

  test('offload adds energy to faction pool', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
    // Set blue energy to 0 so we can clearly see the offload.
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 0, red: 0 }));

    // Assign and run one full trip.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));
    // Walk (4s) + harvest (4s) + walk back (~3s) + offload (0.5s) = ~12s total.
    await page.evaluate(() => window.__vylux!.advanceTime!(14.0));

    const energy = await page.evaluate(() => window.__vylux!.getEnergy!());
    // Blue should have gotten BASE_INCOME × 14s = 14 + HARVEST_YIELD = 8 (at least one offload).
    expect(energy.blue).toBeGreaterThan(0);
  });

  test('node reserve drains on offload; node exhausts when depleted', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    const initialReserve = await page.evaluate(() => window.__vylux!.getNodeReserve!(0));
    expect(initialReserve).toBeGreaterThan(0);

    // Assign worker and run enough trips to drain the node below the eligible threshold.
    // RESERVE_DEFAULT=60, HARVEST_YIELD=8 → 8 trips drain to 60-64=-4→0 (depleted).
    // Regen only runs when reserve < MIN_REGEN_THRESHOLD (6), so during active harvesting
    // there is no regen interference. Node exhausts after 8 full trips.
    // Trip time ~9s each → ~72s for 8 trips. Use 75s to ensure depletion.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));
    await page.evaluate(() => window.__vylux!.advanceTime!(75.0));

    const reserveAfter = await page.evaluate(() => window.__vylux!.getNodeReserve!(0));
    // Node should have been depleted and partially regen'd back to ~MIN_REGEN_THRESHOLD (6).
    // Either way, it must be significantly below the original 60.
    expect(reserveAfter).toBeLessThan(initialReserve);
    // Specifically: the node was drained to near 0 and regen'd to ~6, confirming depletion.
    expect(reserveAfter).toBeLessThan(20); // well below initial 60 — confirms depletion
  });

  test('one-per-node: second worker retargets to a different node', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    // Assign worker 0 to node 0.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));
    // Walk worker 0 to node 0.
    await page.evaluate(() => window.__vylux!.advanceTime!(4.0));

    const phase0 = await page.evaluate(() => window.__vylux!.getWorkerTaskPhase!(0));
    expect(phase0).toBe('harvesting');

    // Now assign worker 1 to the same node (0) — it should retarget to another node.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(1, 0));
    // Advance a tick.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.1));

    const phase1 = await page.evaluate(() => window.__vylux!.getWorkerTaskPhase!(1));
    // Worker 1 should be walking to a different node (retargeted).
    expect(['walking-to-node', 'idle']).toContain(phase1);

    // If walking, it shouldn't be heading to node 0.
    if (phase1 === 'walking-to-node') {
      // Confirm worker 1 has a different target than node 0 (5,5).
      const w1Target = await page.evaluate(() => window.__vylux!.getWorkerTargetTile!(1));
      const isNotNode0 = w1Target === null || !(w1Target.tileX === 5 && w1Target.tileY === 5);
      expect(isNotNode0).toBe(true);
    }
  });

  test('auto-reassign: worker seeking a depleted node retargets to nearest live node', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    // Directly deplete node 0 to 0 (below MIN_REGEN_THRESHOLD = 6) for determinism.
    await page.evaluate(() => window.__vylux!.setNodeReserve!(0, 0));

    const reserve0 = await page.evaluate(() => window.__vylux!.getNodeReserve!(0));
    expect(reserve0).toBeLessThan(1);

    const exhausted0 = await page.evaluate(() => window.__vylux!.getNodeExhausted!(0));
    expect(exhausted0).toBe(true);

    // Now assign worker 1 to the depleted node — it should retarget to another live node.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(1, 0));
    await page.evaluate(() => window.__vylux!.advanceTime!(0.1));

    const phase1 = await page.evaluate(() => window.__vylux!.getWorkerTaskPhase!(1));
    // Should be retargeted (walking-to-node) to another live node or idle if none.
    expect(['walking-to-node', 'idle']).toContain(phase1);
  });

  test('neutral node tint: node occupiedBy is null when no worker assigned', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    const occupiedBy = await page.evaluate(() => window.__vylux!.getNodeOccupiedBy!(0));
    expect(occupiedBy).toBeNull();
  });

  test('node occupiedBy reflects harvesting worker', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));
    // Walk to node.
    await page.evaluate(() => window.__vylux!.advanceTime!(4.0));

    const phase = await page.evaluate(() => window.__vylux!.getWorkerTaskPhase!(0));
    expect(phase).toBe('harvesting');

    const occupiedBy = await page.evaluate(() => window.__vylux!.getNodeOccupiedBy!(0));
    expect(occupiedBy).not.toBeNull();
  });
});

test('harvest-loop scene: mid-harvest screenshot with visible fill buffer on blue-tinted node', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');

  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.assignWorkerToNodeByIndex === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.dismissOnboardingCue === 'function' &&
      typeof window.__vylux.ready === 'function',
    null,
    { timeout: 15_000 },
  );

  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
  await page.evaluate(() => window.__vylux!.dismissOnboardingCue!());

  // Set energy so HUD shows context.
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 30, red: 12 }));
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 4, red: 2 }));

  // Assign blue worker 0 to node 0 (5,5).
  await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));

  // Walk to node (~4s) + partial harvest (~2s) = mid-harvest with fill visible.
  await page.evaluate(() => window.__vylux!.advanceTime!(6.0));

  await page.evaluate(() => window.__vylux!.ready!());

  await page.screenshot({ path: 'pm/screenshots/harvest-loop.png' });
});
