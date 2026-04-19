import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getMatchState === 'function' &&
      typeof window.__vylux.getHqHp === 'function' &&
      typeof window.__vylux.getPoints === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function' &&
      typeof window.__vylux.dismissOnboardingCue === 'function',
    null,
    { timeout: 15_000 },
  );
}

// Sim deadline in seconds. If red hasn't won by this point the test fails.
const DEADLINE_SECONDS = 180;

test('idle-loses: player does nothing after onboarding cue dismissed — red wins by deadline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await waitForHook(page);

  // Enable AI — it's off by default in e2e mode to avoid interfering with
  // other specs. This test specifically validates AI-driven pressure.
  await page.evaluate(() => window.__vylux!.setAiEnabled!(true));

  // Simulate the player's only action: clicking the blue HQ to dismiss the
  // onboarding cue. No units trained, no tiles clicked after this.
  await page.evaluate(() => window.__vylux!.dismissOnboardingCue!());

  let elapsedSim = 0;
  let finalMatchState: { outcome: string | null; active: boolean } | null = null;

  // Advance in 1-second sim chunks. Stop as soon as the match ends.
  while (elapsedSim < DEADLINE_SECONDS) {
    await page.evaluate(() => window.__vylux!.advanceTime!(1.0));
    elapsedSim += 1;

    const matchState = await page.evaluate(
      () => window.__vylux!.getMatchState!(),
    );

    if (!matchState.active || matchState.outcome !== null) {
      finalMatchState = matchState;
      break;
    }
  }

  // Capture the end state for the PM.
  const blueHqHp = await page.evaluate(() => window.__vylux!.getHqHp!('blue'));
  const redPoints = await page.evaluate(() => window.__vylux!.getPoints!('red'));
  const bluePoints = await page.evaluate(() => window.__vylux!.getPoints!('blue'));

  await page.screenshot({ path: 'pm/screenshots/idle-loses-end.png' });

  // Match must have ended before the deadline.
  expect(
    finalMatchState,
    `Match still running at ${DEADLINE_SECONDS}s sim-time deadline. ` +
      `blue HQ HP=${blueHqHp}, blue pts=${bluePoints}, red pts=${redPoints}. ` +
      'Red AI failed to beat idle player — tune AI cadence or WIN_POINTS.',
  ).not.toBeNull();

  // Blue must not have won.
  expect(
    finalMatchState!.outcome,
    `Blue WON while doing nothing (outcome=${finalMatchState!.outcome}, ` +
      `blueHqHp=${blueHqHp}, bluePoints=${bluePoints}, redPoints=${redPoints}, ` +
      `elapsed=${elapsedSim}s). Doing nothing must be a losing strategy.`,
  ).toBe('red-wins');
});
