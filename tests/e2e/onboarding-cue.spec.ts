import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.getOnboardingCueVisible === 'function' &&
      typeof window.__vylux.dismissOnboardingCue === 'function' &&
      typeof window.__vylux.openBuildablesPanel === 'function' &&
      typeof window.__vylux.playAgain === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('onboarding-cue — show / dismiss / reappear-on-reset', () => {
  test('prompt is visible on fresh match start', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Prompt DOM element should be in the document and visible.
    await expect(page.locator('#vylux-onboarding-cue')).toBeVisible();

    // Hook also reports it as visible.
    const visible = await page.evaluate(() => window.__vylux!.getOnboardingCueVisible!());
    expect(visible).toBe(true);
  });

  test('prompt disappears after first HQ click (panel open)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Confirm visible first.
    await expect(page.locator('#vylux-onboarding-cue')).toBeVisible();

    // Simulate opening the buildables panel (same as clicking the blue HQ).
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    // Cue should now be hidden.
    await expect(page.locator('#vylux-onboarding-cue')).toBeHidden();

    const visible = await page.evaluate(() => window.__vylux!.getOnboardingCueVisible!());
    expect(visible).toBe(false);
  });

  test('prompt does not reappear if panel is opened a second time', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
    await expect(page.locator('#vylux-onboarding-cue')).toBeHidden();

    // Close and reopen panel.
    await page.evaluate(() => window.__vylux!.closeBuildablesPanel!());
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());

    // Still hidden — dismissed is permanent for this match.
    await expect(page.locator('#vylux-onboarding-cue')).toBeHidden();
  });

  test('prompt reappears after PLAY AGAIN (resetMatch)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Dismiss the cue.
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
    await expect(page.locator('#vylux-onboarding-cue')).toBeHidden();

    // Simulate PLAY AGAIN.
    await page.evaluate(() => window.__vylux!.playAgain!());

    // Cue should be visible again for the fresh match.
    await expect(page.locator('#vylux-onboarding-cue')).toBeVisible();

    const visible = await page.evaluate(() => window.__vylux!.getOnboardingCueVisible!());
    expect(visible).toBe(true);
  });
});
