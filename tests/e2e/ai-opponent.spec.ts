import { test, expect } from '@playwright/test';

test('AI opponent trains worker, defender, and raider; at least one unit is dispatched', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');

  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function' &&
      typeof window.__vylux.getUnitCount === 'function',
    null,
    { timeout: 15_000 },
  );

  // Enable AI. Give red a large energy reserve so the build queue fires immediately
  // without waiting on the 1/sec base income. Blue stays at 0 (no player action).
  await page.evaluate(() => {
    window.__vylux!.setAiEnabled!(true);
    window.__vylux!.setEnergy!({ blue: 0, red: 1000 });
  });

  // Advance 30s — enough for the build order to train worker + defender + raider
  // and for worker movement to unblock the HQ spawn tiles.
  await page.evaluate(() => window.__vylux!.advanceTime!(30.0));

  const counts = await page.evaluate(() => ({
    redWorkers: window.__vylux!.getUnitCount!({ faction: 'red', kind: 'worker' }),
    redDefenders: window.__vylux!.getUnitCount!({ faction: 'red', kind: 'defender' }),
    redRaiders: window.__vylux!.getUnitCount!({ faction: 'red', kind: 'raider' }),
  }));

  expect(counts.redWorkers).toBeGreaterThanOrEqual(1);
  expect(counts.redDefenders).toBeGreaterThanOrEqual(1);
  expect(counts.redRaiders).toBeGreaterThanOrEqual(1);

  // Assert raider muster fired — evidence that ≥3 raiders were trained and
  // dispatched toward blue HQ. Accept either mustering=true OR ≥3 living raiders.
  const aiSt = await page.evaluate(() => {
    const h = window.__vylux! as unknown as {
      getAiState?: () => { trainCooldown: number; workerAssignTimer: number; mustering: boolean };
      getUnitCount?: (q: { faction: string; kind: string }) => number;
    };
    const state = h.getAiState?.();
    const raiders = h.getUnitCount?.({ faction: 'red', kind: 'raider' }) ?? 0;
    return { mustering: state?.mustering ?? false, raiders };
  });

  const dispatched = aiSt.mustering || aiSt.raiders >= 3;
  expect(dispatched).toBe(true);
});
