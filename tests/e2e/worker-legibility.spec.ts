import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getWorkerPulseElapsed === 'function' &&
      typeof window.__vylux.getWorkerAccentIntensity === 'function' &&
      typeof window.__vylux.getWorkerTile === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('worker behaviour legibility', () => {
  test('off-node worker accent intensity never varies from baseline', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Use early-economy scene: worker 0 is on node (5,5); worker 4 is off-node at (5,6).
    await page.evaluate(() => window.__vylux!.setScene!('early-economy'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Confirm worker 4 is off-node — tile (5,6) is not a node.
    const offNodeTile = await page.evaluate(() => window.__vylux!.getWorkerTile!(4));
    expect(offNodeTile).toEqual({ tileX: 5, tileY: 6 });

    // Sample off-node worker accent intensity over 0.5s in 0.05s steps.
    const offNodeSamples: number[] = [];
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.__vylux!.advanceTime!(0.05));
      const intensity = await page.evaluate(() => window.__vylux!.getWorkerAccentIntensity!(4));
      offNodeSamples.push(intensity);
    }

    // All samples must equal the baseline (2.0) within a small epsilon.
    const BASE_INTENSITY = 2.0;
    const EPSILON = 0.01;
    for (const s of offNodeSamples) {
      expect(s).toBeGreaterThanOrEqual(BASE_INTENSITY - EPSILON);
      expect(s).toBeLessThanOrEqual(BASE_INTENSITY + EPSILON);
    }
  });

  test('on-node worker shows emissive spike that peaks above baseline and returns to baseline', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Use early-economy scene: worker 0 is on node (5,5).
    await page.evaluate(() => window.__vylux!.setScene!('early-economy'));
    await page.evaluate(() => window.__vylux!.ready!());

    const onNodeTile = await page.evaluate(() => window.__vylux!.getWorkerTile!(0));
    expect(onNodeTile).toEqual({ tileX: 5, tileY: 5 });

    // Advance until a pulse fires. VISUAL_PULSE_RATE=2 so a tick fires every 0.5s.
    // Advance in small steps sampling intensity each time over ~0.6s.
    const onNodeSamples: number[] = [];
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.__vylux!.advanceTime!(0.05));
      const intensity = await page.evaluate(() => window.__vylux!.getWorkerAccentIntensity!(0));
      onNodeSamples.push(intensity);
    }

    const BASE_INTENSITY = 2.0;
    const peak = Math.max(...onNodeSamples);
    const variation = peak - Math.min(...onNodeSamples);

    // Peak must clearly exceed baseline.
    expect(peak).toBeGreaterThan(BASE_INTENSITY + 1.0);
    // There must be meaningful variation — pulse fired and decayed.
    expect(variation).toBeGreaterThan(1.0);
  });

  test('off-node worker does not pulse even after on-node worker fires', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('early-economy'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Advance through a full pulse cycle (~0.5s to trigger, ~0.18s to decay).
    await page.evaluate(() => window.__vylux!.advanceTime!(0.7));

    // Off-node worker (index 4, tile 5,6) must still be at baseline.
    const intensity = await page.evaluate(() => window.__vylux!.getWorkerAccentIntensity!(4));
    const BASE_INTENSITY = 2.0;
    const EPSILON = 0.01;
    expect(intensity).toBeGreaterThanOrEqual(BASE_INTENSITY - EPSILON);
    expect(intensity).toBeLessThanOrEqual(BASE_INTENSITY + EPSILON);
  });

  test('pulse elapsed is -1 for off-node worker at all times', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('early-economy'));
    await page.evaluate(() => window.__vylux!.ready!());

    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.__vylux!.advanceTime!(0.05));
      const elapsed = await page.evaluate(() => window.__vylux!.getWorkerPulseElapsed!(4));
      // Off-node: always -1 (no active pulse).
      expect(elapsed).toBe(-1);
    }
  });

  test('screenshots: early-economy scene captures visible harvest pulse', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setScene!('early-economy'));
    await page.evaluate(() => window.__vylux!.ready!());

    // Advance just past the first pulse trigger (~0.5s), then step until pulse is active.
    // VISUAL_PULSE_RATE=2 → pulse fires every ~0.5s. Capture at the attack peak (~30ms in).
    // Advance 0.5s to trigger the pulse.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.5));

    // Step forward ~30ms to hit the peak of the attack curve.
    await page.evaluate(() => window.__vylux!.advanceTime!(0.03));

    // Capture screenshot with at least one worker near pulse peak.
    await page.screenshot({ path: 'pm/screenshots/early-economy.png' });
  });
});
