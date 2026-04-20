// E2E spec for combat-rebalance-targeting-feedback (reopen-5 directives 3–6).
//
// Directive 3: fights last ≥3 combat ticks (worker vs raider, defender vs raider).
// Directive 4: raider damage pipeline — defenders and HQ take visible HP hits.
// Directive 5: retaliate-then-nearest targeting.
// Directive 6: HP bars shrink per-hit (HP values update on each hit).
import { test, expect, type Page } from '@playwright/test';

async function setupE2E(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function' &&
      typeof window.__vylux.spawnRaider === 'function' &&
      typeof window.__vylux.getUnitCount === 'function' &&
      typeof window.__vylux.getHqHp === 'function' &&
      typeof window.__vylux.setUnitHp === 'function',
    null,
    { timeout: 15_000 },
  );
  await page.evaluate(() => {
    window.__vylux!.setAiEnabled!(false);
    window.__vylux!.setScene!('idle-start');
    window.__vylux!.dismissOnboardingCue?.();
  });
}

test.describe('directive 3 — fights last ≥3 combat ticks', () => {
  test('raider needs ≥3 hits to kill a worker (balance assertion)', async ({ page }) => {
    // Pure math: WORKER_HP / RAIDER_DAMAGE >= 3.
    // This is covered by the unit tests. Here we verify via simulation.
    await setupE2E(page);

    await page.evaluate(() => {
      const v = window.__vylux!;
      // Move red worker[2] to (10,9), spawn blue raider at (10,8) — Chebyshev dist 1.
      v.moveWorker!(2, 10, 9);
      v.spawnRaider!('blue', 10, 8);
    });

    // Advance in 0.8s steps (each >= attackCooldown 0.8s → 1 hit per step).
    // Count steps until a red worker dies.
    const result = await page.evaluate(() => {
      const v = window.__vylux!;
      let steps = 0;
      const initial = v.getUnitCount!({ faction: 'red', kind: 'worker' });
      for (let i = 0; i < 15; i++) {
        const now = v.getUnitCount!({ faction: 'red', kind: 'worker' });
        if (now < initial) break;
        v.advanceTime!(0.85); // slightly over attackCooldown to ensure one fire per step
        steps++;
      }
      return { steps, initial, after: v.getUnitCount!({ faction: 'red', kind: 'worker' }) };
    });

    // Worker died (count dropped).
    expect(result.after).toBeLessThan(result.initial);
    // It took at least 3 steps (3 hits).
    expect(result.steps).toBeGreaterThanOrEqual(3);
  });

  test('defender needs ≥3 hits to kill a raider (balance assertion)', async ({ page }) => {
    await setupE2E(page);

    // Use mid-combat scene: blue raiders vs red defenders adjacent.
    await page.evaluate(() => {
      window.__vylux!.setScene!('mid-combat');
    });

    // Advance in 1.05s steps (each >= defender cooldown 1.0s → 1 hit per step).
    const result = await page.evaluate(() => {
      const v = window.__vylux!;
      let steps = 0;
      const initial = v.getUnitCount!({ faction: 'blue', kind: 'raider' });
      for (let i = 0; i < 15; i++) {
        const now = v.getUnitCount!({ faction: 'blue', kind: 'raider' });
        if (now < initial) break;
        v.advanceTime!(1.05);
        steps++;
      }
      return { steps, initial, after: v.getUnitCount!({ faction: 'blue', kind: 'raider' }) };
    });

    // A raider died.
    expect(result.after).toBeLessThan(result.initial);
    // It took at least 3 steps (3 hits).
    expect(result.steps).toBeGreaterThanOrEqual(3);
  });
});

test.describe('directive 4 — raider damage pipeline (defenders + HQ)', () => {
  test('raider kills defender eventually (visible HP drain)', async ({ page }) => {
    await setupE2E(page);

    // mid-combat: blue raiders adjacent to red defenders.
    await page.evaluate(() => {
      window.__vylux!.setScene!('mid-combat');
    });

    const initial = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'red', kind: 'defender' }),
    );

    // Advance enough for raiders to kill at least one defender.
    await page.evaluate(() => window.__vylux!.advanceTime!(12.0));

    const after = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'red', kind: 'defender' }),
    );

    expect(after).toBeLessThan(initial);
  });

  test('raider deals visible damage to red HQ when adjacent', async ({ page }) => {
    await setupE2E(page);

    // Spawn multiple blue raiders adjacent to red HQ at (16,9).
    await page.evaluate(() => {
      const v = window.__vylux!;
      v.spawnRaider!('blue', 15, 9);  // dist 1
      v.spawnRaider!('blue', 16, 8);  // dist 1
      v.spawnRaider!('blue', 16, 10); // dist 1
    });

    const initialHp = await page.evaluate(() => window.__vylux!.getHqHp!('red'));
    expect(initialHp).toBe(500);

    await page.evaluate(() => window.__vylux!.advanceTime!(3.0));

    const afterHp = await page.evaluate(() => window.__vylux!.getHqHp!('red'));

    // HP must have visibly dropped.
    expect(afterHp).toBeLessThan(initialHp);
    // Not dead yet — just visible damage.
    expect(afterHp).toBeGreaterThan(0);
  });

  test('raider reduces defender HP across consecutive ticks', async ({ page }) => {
    await setupE2E(page);

    await page.evaluate(() => {
      window.__vylux!.setScene!('mid-combat');
      window.__vylux!.setPoints!({ blue: 0, red: 0 });
    });

    // Advance step by step and verify red-defender count eventually drops (HP drained).
    const died = await page.evaluate(() => {
      const v = window.__vylux!;
      const initial = v.getUnitCount!({ faction: 'red', kind: 'defender' });
      for (let i = 0; i < 20; i++) {
        v.advanceTime!(0.85);
        const now = v.getUnitCount!({ faction: 'red', kind: 'defender' });
        if (now < initial) return true;
      }
      return false;
    });

    expect(died).toBe(true);
  });
});

test.describe('directive 5 — retaliate-then-nearest targeting', () => {
  test('raider engages closer defender before distant HQ', async ({ page }) => {
    await setupE2E(page);

    // mid-combat: blue raiders at (14,8..10), red HQ at (16,9), red defenders at (15,10),(16,8).
    // Raiders are closer to defenders (dist ~1-2) than HQ (dist ~2-3).
    await page.evaluate(() => {
      window.__vylux!.setScene!('mid-combat');
    });

    // Advance enough for combat to happen.
    await page.evaluate(() => window.__vylux!.advanceTime!(8.0));

    const result = await page.evaluate(() => ({
      redDefenders: window.__vylux!.getUnitCount!({ faction: 'red', kind: 'defender' }),
      redHqHp: window.__vylux!.getHqHp!('red'),
    }));

    // If raiders were pure HQ-beeline, defenders would be alive and HQ dead.
    // With nearest-targeting, defenders die first (or at least take damage).
    // Assert: at least one defender died (raiders engaged defenders, not just HQ).
    expect(result.redDefenders).toBeLessThan(2);
  });

  test('raider with no defender or worker present targets HQ (valid target)', async ({ page }) => {
    await setupE2E(page);

    // Kill red starter workers so the raider has no worker targets — goes straight for HQ.
    // (With higher WORKER_HP the raider would spend too long on workers to reach HQ in time.)
    await page.evaluate(() => {
      window.__vylux!.killUnit!({ kind: 'worker', faction: 'red', index: 0 });
      window.__vylux!.killUnit!({ kind: 'worker', faction: 'red', index: 0 });
    });
    // Advance briefly to let death pulses clear.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.3));

    // Spawn a single blue raider at (10,9) — no workers or defenders remain.
    // Red HQ at (16,9), distance 6 tiles.
    await page.evaluate(() => {
      window.__vylux!.spawnRaider!('blue', 10, 9);
    });

    const initialHqHp = await page.evaluate(() => window.__vylux!.getHqHp!('red'));

    // Advance enough for the raider to travel to HQ (~6 tiles at 2.8 t/s = ~2.1s) and attack.
    await page.evaluate(() => window.__vylux!.advanceTime!(8.0));

    const afterHqHp = await page.evaluate(() => window.__vylux!.getHqHp!('red'));

    // Raider should have reached HQ and damaged it.
    expect(afterHqHp).toBeLessThan(initialHqHp);
  });
});

test.describe('directive 6 — HP bars shrink per hit', () => {
  test('HQ HP bar shrinks per-hit as raiders attack', async ({ page }) => {
    await setupE2E(page);

    // Kill all red workers first so raiders go for HQ, not workers.
    // Then spawn raiders adjacent to red HQ (16,9).
    await page.evaluate(() => {
      const v = window.__vylux!;
      // Kill red starters so raiders have no workers to target.
      v.killUnit!({ kind: 'worker', faction: 'red', index: 0 });
      v.killUnit!({ kind: 'worker', faction: 'red', index: 0 }); // index 0 again after first splice
      // Spawn blue raiders directly adjacent to red HQ (16,9).
      v.spawnRaider!('blue', 15, 9);
      v.spawnRaider!('blue', 16, 8);
    });

    const before = await page.evaluate(() => window.__vylux!.getHqHp!('red'));
    expect(before).toBe(500);

    // Advance 0.9s — raiders have cooldown 0.8s, so one hit each fires.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.9));
    const after1 = await page.evaluate(() => window.__vylux!.getHqHp!('red'));

    // Advance another 0.9s — second round of hits.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.9));
    const after2 = await page.evaluate(() => window.__vylux!.getHqHp!('red'));

    // HP should decrease step by step (each attack round reduces it).
    expect(after1).toBeLessThan(before);
    expect(after2).toBeLessThan(after1);
  });
});
