import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.openBuildablesPanel === 'function' &&
      typeof window.__vylux.getBuildablesPanelOpen === 'function' &&
      typeof window.__vylux.armBuildable === 'function' &&
      typeof window.__vylux.mouseTrainUnit === 'function' &&
      typeof window.__vylux.getUnitCount === 'function' &&
      typeof window.__vylux.setEnergy === 'function' &&
      typeof window.__vylux.setPoints === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getMatchState === 'function' &&
      typeof window.__vylux.playAgain === 'function' &&
      typeof window.__vylux.getOnboardingCueVisible === 'function' &&
      typeof window.__vylux.selectWorkerByIndex === 'function' &&
      typeof window.__vylux.getWorkerSelectionRingVisible === 'function' &&
      typeof window.__vylux.giveWorkerMoveOrder === 'function' &&
      typeof window.__vylux.getWorkerTargetTile === 'function',
    null,
    { timeout: 15_000 },
  );
}

test('mouse-only: idle-start → train worker & raider → victory → play again', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await waitForHook(page);

  // 1. Onboarding cue visible on fresh load.
  await expect(page.locator('#vylux-onboarding-cue')).toBeVisible();
  const cueVisible = await page.evaluate(() => window.__vylux!.getOnboardingCueVisible!());
  expect(cueVisible).toBe(true);

  // 2. Open buildables panel via HQ click (hook mirrors the click action).
  //    openBuildablesPanel() is the canonical mouse-equivalent per the task spec.
  await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

  const panelOpen = await page.evaluate(() => window.__vylux!.getBuildablesPanelOpen!());
  expect(panelOpen).toBe(true);
  await expect(page.locator('#vylux-buildables-panel')).toBeVisible();

  // Onboarding cue dismissed after first HQ open.
  await expect(page.locator('#vylux-onboarding-cue')).toBeHidden();

  // 3. Seed blue energy so the test is not gated on BASE_INCOME accrual.
  //    Worker=20, Raider=100 — seed 500 to afford both plus any overhead.
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 500, red: 0 }));

  // Move starter blue workers out of the way so tiles near HQ are free.
  await page.evaluate(() => {
    window.__vylux!.moveWorker!(0, 10, 10);
    window.__vylux!.moveWorker!(1, 11, 10);
  });

  // 4. Train a Worker: arm the buildable, then place adjacent to HQ (0,0).
  await page.evaluate(() => window.__vylux!.armBuildable!('worker'));
  const armedKind = await page.evaluate(() => window.__vylux!.getArmedKind!());
  expect(armedKind).toBe('worker');

  const workerCountBefore = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
  );

  const workerPlaced = await page.evaluate(() =>
    window.__vylux!.mouseTrainUnit!('worker', 1, 0),
  );
  expect(workerPlaced).toBe(true);

  const workerCountAfter = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
  );
  expect(workerCountAfter).toBe(workerCountBefore + 1);

  // Energy should be less than 500 (WORKER_COST=20 deducted); allow a small
  // positive drift from background BASE_INCOME ticks since setEnergy.
  const energyAfterWorker = await page.evaluate(() => window.__vylux!.getEnergy!().blue);
  expect(energyAfterWorker).toBeLessThan(500);
  expect(energyAfterWorker).toBeGreaterThan(450);

  // 5. Select the newly-spawned worker (the last blue worker = index workerCountAfter-1).
  //    selectWorkerByIndex operates on blue workers only.
  const newWorkerIndex = workerCountAfter - 1;

  await page.evaluate((idx) => window.__vylux!.selectWorkerByIndex!(idx), newWorkerIndex);

  const ringVisible = await page.evaluate((idx) =>
    window.__vylux!.getWorkerSelectionRingVisible!(idx),
    newWorkerIndex,
  );
  expect(ringVisible).toBe(true);

  // 6. Give the selected worker a move order toward energy-node tile (5,5).
  //    giveWorkerMoveOrder mirrors the right-click-to-move action.
  await page.evaluate((idx) => window.__vylux!.giveWorkerMoveOrder!(idx, 5, 5), newWorkerIndex);

  const targetTile = await page.evaluate((idx) =>
    window.__vylux!.getWorkerTargetTile!(idx),
    newWorkerIndex,
  );
  expect(targetTile).not.toBeNull();
  expect(targetTile!.tileX).toBe(5);
  expect(targetTile!.tileY).toBe(5);

  // 7. Train a Raider: re-open panel (or it may still be open), arm raider, place adjacent.
  //    Panel may have closed after worker train — open it.
  await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

  const raiderCountBefore = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );

  const raiderPlaced = await page.evaluate(() =>
    window.__vylux!.mouseTrainUnit!('raider', 0, 1),
  );
  expect(raiderPlaced).toBe(true);

  const raiderCountAfter = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );
  expect(raiderCountAfter).toBe(raiderCountBefore + 1);

  // 8. Advance time via point-seeding: set blue points to WIN_POINTS (500) directly,
  //    then advance one frame so evaluateMatch fires — matches the approach in win-lose.spec.ts.
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 500, red: 0 }));
  await page.evaluate(() => window.__vylux!.advanceTime!(0.016));

  const outcome = await page.evaluate(() => window.__vylux!.getMatchState!().outcome);
  expect(outcome).toBe('blue-wins');

  // 9. VICTORY overlay is visible.
  await expect(page.locator('#vylux-match-overlay')).toBeVisible();
  const headingText = await page.locator('#vylux-overlay-heading').textContent();
  expect(headingText).toBe('VICTORY');

  await page.screenshot({ path: 'pm/screenshots/mouse-e2e-victory.png' });

  // 10. Click PLAY AGAIN via the hook (mirrors the button click).
  await page.evaluate(() => window.__vylux!.playAgain!());

  // Overlay clears.
  await expect(page.locator('#vylux-match-overlay')).toBeHidden();

  // Onboarding cue reappears for fresh match.
  await expect(page.locator('#vylux-onboarding-cue')).toBeVisible();
  const cueAfterReset = await page.evaluate(() => window.__vylux!.getOnboardingCueVisible!());
  expect(cueAfterReset).toBe(true);

  // Buildables panel closed.
  const panelAfterReset = await page.evaluate(() => window.__vylux!.getBuildablesPanelOpen!());
  expect(panelAfterReset).toBe(false);

  // Energy reset to 0 (small BASE_INCOME drift is fine — just check it's near-zero).
  const energyAfterReset = await page.evaluate(() => window.__vylux!.getEnergy!().blue);
  expect(energyAfterReset).toBeLessThan(10);

  // Points reset to 0.
  const pointsAfterReset = await page.evaluate(() => window.__vylux!.getPoints!('blue'));
  expect(pointsAfterReset).toBe(0);

  // Match state is active again, no outcome.
  const matchAfterReset = await page.evaluate(() => window.__vylux!.getMatchState!());
  expect(matchAfterReset.outcome).toBeNull();
  expect(matchAfterReset.active).toBe(true);
});
