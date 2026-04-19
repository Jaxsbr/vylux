import { test, expect } from '@playwright/test';

const E2E_READY = `
  typeof window.__vylux !== 'undefined' &&
  typeof window.__vylux.setScene === 'function' &&
  typeof window.__vylux.advanceTime === 'function' &&
  typeof window.__vylux.getMatchState === 'function' &&
  typeof window.__vylux.playAgain === 'function'
`;

test.describe('win / lose screen', () => {
  test('blue-wins-points: blue reaches WIN_POINTS → VICTORY overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await page.waitForFunction(E2E_READY, null, { timeout: 15_000 });

    await page.evaluate(() => {
      window.__vylux!.setScene!('idle-start');
      window.__vylux!.setPoints!({ blue: 500, red: 0 });
    });
    await page.evaluate(() => window.__vylux!.ready!());

    // Advance one frame — evaluateMatch fires inside advanceTime loop.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.016));

    const outcome = await page.evaluate(() => window.__vylux!.getMatchState!().outcome);
    expect(outcome).toBe('blue-wins');

    const overlayVisible = await page.locator('#vylux-match-overlay').isVisible();
    expect(overlayVisible).toBe(true);

    const headingText = await page.locator('#vylux-overlay-heading').textContent();
    expect(headingText).toBe('VICTORY');
  });

  test('red-wins-hq: blue HQ hp=0 → red wins, DEFEAT overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await page.waitForFunction(E2E_READY, null, { timeout: 15_000 });

    await page.evaluate(() => {
      window.__vylux!.setScene!('idle-start');
      window.__vylux!.setPoints!({ blue: 0, red: 0 });
    });
    await page.evaluate(() => window.__vylux!.ready!());

    // Set blue HQ hp to 0 — red wins.
    await page.evaluate(() =>
      window.__vylux!.setUnitHp!({ kind: 'hq', faction: 'blue', hp: 0 }),
    );

    await page.evaluate(() => window.__vylux!.advanceTime!(0.016));

    const outcome = await page.evaluate(() => window.__vylux!.getMatchState!().outcome);
    expect(outcome).toBe('red-wins');

    const overlayVisible = await page.locator('#vylux-match-overlay').isVisible();
    expect(overlayVisible).toBe(true);

    const headingText = await page.locator('#vylux-overlay-heading').textContent();
    expect(headingText).toBe('DEFEAT');
  });

  test('play-again resets state and does not re-trigger overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await page.waitForFunction(E2E_READY, null, { timeout: 15_000 });

    // Trigger blue win.
    await page.evaluate(() => {
      window.__vylux!.setScene!('idle-start');
      window.__vylux!.setPoints!({ blue: 500, red: 0 });
    });
    await page.evaluate(() => window.__vylux!.ready!());
    await page.evaluate(() => window.__vylux!.advanceTime!(0.016));

    const outcomeBeforeReset = await page.evaluate(() => window.__vylux!.getMatchState!().outcome);
    expect(outcomeBeforeReset).toBe('blue-wins');

    // Play again — resets state.
    await page.evaluate(() => window.__vylux!.playAgain!());

    // Overlay should be gone.
    const overlayVisible = await page.locator('#vylux-match-overlay').isVisible();
    expect(overlayVisible).toBe(false);

    // Points reset to 0.
    const bluePoints = await page.evaluate(() => window.__vylux!.getPoints!('blue'));
    expect(bluePoints).toBe(0);

    // Blue HQ HP back to 500.
    const blueHqHp = await page.evaluate(() => window.__vylux!.getHqHp!('blue'));
    expect(blueHqHp).toBe(500);

    // Match state reset.
    const matchState = await page.evaluate(() => window.__vylux!.getMatchState!());
    expect(matchState.outcome).toBeNull();
    expect(matchState.active).toBe(true);

    // Starter workers restored — 2 blue workers.
    const blueWorkerCount = await page.evaluate(
      () => window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
    );
    expect(blueWorkerCount).toBe(2);

    // Advance 0.2s — should NOT re-trigger overlay (points are 0).
    await page.evaluate(() => window.__vylux!.advanceTime!(0.2));
    const overlayAfterAdvance = await page.locator('#vylux-match-overlay').isVisible();
    expect(overlayAfterAdvance).toBe(false);

    const outcomeAfterReset = await page.evaluate(() => window.__vylux!.getMatchState!().outcome);
    expect(outcomeAfterReset).toBeNull();
  });
});
