import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getWorkerTaskPhase === 'function' &&
      typeof window.__vylux.getNodeOccupiedBy === 'function' &&
      typeof window.__vylux.getNodeReserve === 'function' &&
      typeof window.__vylux.getNodeExhausted === 'function' &&
      typeof window.__vylux.assignWorkerToNodeByIndex === 'function' &&
      typeof window.__vylux.setNodeReserve === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('node occupancy releases when worker departs', () => {
  test('node is free once worker leaves harvesting to walk back to HQ', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    // Assign worker 0 (blue) to node 0 and let it start harvesting.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));
    // Walk to node (~2.5s) + full harvest (4s) + a bit more = 8s total → worker departs.
    await page.evaluate(() => window.__vylux!.advanceTime!(8.5));

    const phase = await page.evaluate(() =>
      window.__vylux!.getWorkerTaskPhase!(0),
    );
    // Worker should now be walking back to HQ or offloading.
    expect(['walking-to-hq', 'offloading', 'walking-to-node']).toContain(phase);

    // Node occupancy must be released (null) once worker left harvesting.
    const occupiedBy = await page.evaluate(() =>
      window.__vylux!.getNodeOccupiedBy!(0),
    );
    expect(occupiedBy).toBeNull();
  });

  test('worker B can claim node while worker A is walking back to HQ', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    // Assign worker 0 to node 0; let it harvest fully and start walking back.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(0, 0));
    await page.evaluate(() => window.__vylux!.advanceTime!(8.5));

    // Confirm worker 0 is NOT harvesting (departed).
    const phase0 = await page.evaluate(() =>
      window.__vylux!.getWorkerTaskPhase!(0),
    );
    expect(phase0).not.toBe('harvesting');

    // Assign worker 1 (blue) to the same node — should succeed (occupancy released).
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(1, 0));
    await page.evaluate(() => window.__vylux!.advanceTime!(4.0));

    // Worker 1 should have reached the node and be harvesting.
    const phase1 = await page.evaluate(() =>
      window.__vylux!.getWorkerTaskPhase!(1),
    );
    expect(phase1).toBe('harvesting');
  });
});

test.describe('node regeneration', () => {
  test('depleted node regenerates and becomes eligible without human intervention', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    // Directly deplete node 0 to 0 for determinism.
    await page.evaluate(() => window.__vylux!.setNodeReserve!(0, 0));

    const exhaustedBefore = await page.evaluate(() =>
      window.__vylux!.getNodeExhausted!(0),
    );
    expect(exhaustedBefore).toBe(true);

    // Advance 20s with no worker assigned — regen brings node from 0 → MIN_REGEN_THRESHOLD (6) in ~15s.
    await page.evaluate(() => window.__vylux!.advanceTime!(20.0));

    const reserveAfterRegen = await page.evaluate(() =>
      window.__vylux!.getNodeReserve!(0),
    );
    const exhaustedAfterRegen = await page.evaluate(() =>
      window.__vylux!.getNodeExhausted!(0),
    );
    expect(reserveAfterRegen).toBeGreaterThan(0);
    // Node should be eligible again (reserve ≥ MIN_REGEN_THRESHOLD = 6).
    expect(exhaustedAfterRegen).toBe(false);
  });

  test('regenerated node can be harvested again', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

    // Directly deplete node 0 to 0.
    await page.evaluate(() => window.__vylux!.setNodeReserve!(0, 0));

    const exhaustedBefore = await page.evaluate(() =>
      window.__vylux!.getNodeExhausted!(0),
    );
    expect(exhaustedBefore).toBe(true);

    // Advance 20s — node regens past MIN_REGEN_THRESHOLD in ~15s.
    await page.evaluate(() => window.__vylux!.advanceTime!(20.0));

    const reserveAfterRegen = await page.evaluate(() =>
      window.__vylux!.getNodeReserve!(0),
    );
    expect(reserveAfterRegen).toBeGreaterThan(5);

    // Worker 1 should now be able to harvest node 0.
    await page.evaluate(() => window.__vylux!.assignWorkerToNodeByIndex!(1, 0));
    await page.evaluate(() => window.__vylux!.advanceTime!(4.0));

    const phase1 = await page.evaluate(() =>
      window.__vylux!.getWorkerTaskPhase!(1),
    );
    expect(phase1).toBe('harvesting');
  });
});
