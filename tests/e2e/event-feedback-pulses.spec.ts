import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getUnitPlacementPulseElapsed === 'function' &&
      typeof window.__vylux.getUnitDeathPulseActive === 'function' &&
      typeof window.__vylux.getNodeCapturePulseElapsed === 'function' &&
      typeof window.__vylux.getPointFlashClass === 'function' &&
      typeof window.__vylux.killUnit === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('event feedback pulses', () => {
  // ── 1. Unit-placement pulse ───────────────────────────────────────────────
  test('unit placement: scale-in pulse is active immediately after mouseTrainUnit and settles by 400ms', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('idle-start'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Give blue enough energy to train a worker.
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 100 }));

    // Open panel and arm worker.
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
    await page.evaluate(() => window.__vylux!.armBuildable!('worker'));

    // Count blue workers before placement to find the index of the new unit.
    const blueWorkersBefore = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
    );

    // Place a worker within proximity zone of blue HQ (3,9 → tile 4,9).
    const placed = await page.evaluate(() =>
      window.__vylux!.mouseTrainUnit!('worker', 4, 9),
    );
    expect(placed).toBe(true);

    // The new worker is at the last blue worker index.
    const newWorkerIndex = blueWorkersBefore;

    // Sample placement pulse elapsed within ~100ms of placement (before animation ends).
    // The pulse duration is 200ms, so at t=0 it should be active (elapsed ≥ 0).
    const elapsedImmediately = await page.evaluate(
      (idx) => window.__vylux!.getUnitPlacementPulseElapsed!({ kind: 'worker', faction: 'blue', index: idx }),
      newWorkerIndex,
    );
    // Placement pulse should be active: elapsed is 0 or slightly positive (not -1).
    expect(elapsedImmediately).toBeGreaterThanOrEqual(0);

    // Advance 400ms — pulse should have settled (elapsed returns -1 after duration).
    await page.evaluate(() => window.__vylux!.advanceTime!(0.4));
    const elapsedSettled = await page.evaluate(
      (idx) => window.__vylux!.getUnitPlacementPulseElapsed!({ kind: 'worker', faction: 'blue', index: idx }),
      newWorkerIndex,
    );
    expect(elapsedSettled).toBe(-1);
  });

  // ── 2. Unit-death pulse ───────────────────────────────────────────────────
  test('unit death: death pulse fires and unit is removed after pulse decays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('mid-combat'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Spawn a blue raider (blue faction has raiders in mid-combat scene).
    // Use spawnRaider to add a raider we can control.
    await page.evaluate(() => window.__vylux!.spawnRaider!('blue', 5, 5));

    // Count blue raiders before kill.
    const countBefore = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
    );
    expect(countBefore).toBeGreaterThan(0);

    // Kill the first blue raider via killUnit hook.
    await page.evaluate(() =>
      window.__vylux!.killUnit!({ kind: 'raider', faction: 'blue', index: 0 }),
    );

    // Run one combat tick to trigger the death pulse (removeDead fires triggerDeathPulse).
    await page.evaluate(() => window.__vylux!.advanceTime!(0.016));

    // Death pulse should now be active.
    const deathPulseActive = await page.evaluate(() =>
      window.__vylux!.getUnitDeathPulseActive!({ kind: 'raider', faction: 'blue', index: 0 }),
    );
    expect(deathPulseActive).toBe(true);

    // Advance 300ms — well past the 150ms death pulse duration.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.3));

    // After the pulse decays, the unit should be disposed (count decreases).
    const countAfter = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
    );
    expect(countAfter).toBeLessThan(countBefore);
  });

  // ── 3. Node-capture pulse ─────────────────────────────────────────────────
  test('node-capture: pulse fires on ownership flip, not on subsequent holds', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('idle-start'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Move blue starter worker 0 onto node 0 at (5,5).
    await page.evaluate(() => window.__vylux!.moveWorker!(0, 5, 5));

    // Advance one step AND sample elapsed within the same evaluate to avoid
    // real-time rAF frames completing the pulse between calls.
    const pulseDuringCapture = await page.evaluate(() => {
      window.__vylux!.advanceTime!(0.016);
      return window.__vylux!.getNodeCapturePulseElapsed!(0);
    });
    // Pulse should be active: elapsed is slightly positive (one step = ~0.016s, duration = 0.25s).
    expect(pulseDuringCapture).toBeGreaterThanOrEqual(0);

    // Advance 300ms beyond the 250ms capture duration — pulse should have ended.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.55));

    // Pulse should be fully decayed (elapsed = -1). Sample within same evaluate.
    const pulseDecayed = await page.evaluate(() =>
      window.__vylux!.getNodeCapturePulseElapsed!(0),
    );
    expect(pulseDecayed).toBe(-1);

    // Hold the node for another second — no new pulse fires while held.
    const pulseWhileHeld = await page.evaluate(() => {
      window.__vylux!.advanceTime!(1.0);
      return window.__vylux!.getNodeCapturePulseElapsed!(0);
    });
    expect(pulseWhileHeld).toBe(-1);
  });

  // ── 4. Point-tick flash ───────────────────────────────────────────────────
  test('point-tick: HUD counter has flash class applied when points change', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('idle-start'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Initialise points so prevBluePoints is set (not -1).
    await page.evaluate(() => window.__vylux!.setPoints!({ blue: 0, red: 0 }));

    // Directly set points to a new value — updatePoints diffs against previous.
    await page.evaluate(() => window.__vylux!.setPoints!({ blue: 1 }));

    // CSS animation is applied by the DOM; query the flash class via the hook.
    const hasFlash = await page.evaluate(() =>
      window.__vylux!.getPointFlashClass!('blue'),
    );
    expect(hasFlash).toBe(true);

    // Wait for animation to complete (180ms duration + buffer).
    await page.waitForTimeout(250);

    // After the CSS animation the class should still be present (it's only removed
    // on the next setPoints call via classList.remove → re-add cycle).
    // The key assertion is that it WAS applied during the change — verified above.
  });

  // ── Screenshot: mid-combat with live event cue ────────────────────────────
  test('screenshots: mid-combat captures a live event cue', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('mid-combat'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Give blue energy and place a unit to trigger a placement pulse.
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200 }));
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
    await page.evaluate(() => window.__vylux!.armBuildable!('worker'));
    // (4,9) is within proximity zone of blue HQ (3,9).
    await page.evaluate(() => window.__vylux!.mouseTrainUnit!('worker', 4, 9));

    // Advance a tiny step so the placement pulse is in-progress.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.04));

    // Capture screenshot at pulse peak — placement pulse unit should be visibly
    // smaller than normal (scale 0.4 → 1.0, we're at ~20% of 200ms).
    await page.screenshot({ path: 'pm/screenshots/mid-combat.png' });
  });
});
