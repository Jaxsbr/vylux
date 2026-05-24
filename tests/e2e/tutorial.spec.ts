import { expect, test } from '@playwright/test';

// Phase C.6 — tutorial sandbox.
//
// Verifies the guided phase launches, advances on the gating action, and is
// skippable, with no console errors. The completion-goal logic (energy /
// workers / find-enemy-HQ) is unit-tested in tutorial-steps.test.ts — driving
// it to 15 workers + 300 energy + a cross-map scout would be a slow,
// brittle e2e, so the browser test covers the launch / advance / skip wiring.

interface TutorialHooks {
  selectHq(): void;
  tutorial: { phase(): string | null; step(): string | null };
}

test('tutorial launches, advances on the gating action, and is skippable', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  // ?tutorial=1 deep-links into the sandbox (skips the menu); ?test-hooks=1
  // exposes __vyluxTest for programmatic selection + tutorial introspection.
  await page.goto('/?tutorial=1&test-hooks=1');

  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();

  // step() must be invoked inside the page — page.evaluate strips functions
  // from its return value, so we can't hand the hooks object back to Node.
  const currentStep = () =>
    page.evaluate(() => (window as unknown as { __vyluxTest?: TutorialHooks }).__vyluxTest?.tutorial.step());

  // 1. The first guided step is "select HQ", and its coach bubble is shown.
  await expect.poll(currentStep).toBe('selectHq');
  await expect(page.getByText('SELECT YOUR HQ', { exact: true })).toBeVisible();

  // 2. Performing the gated action (select the HQ) advances to the next step.
  await page.evaluate(() => (window as unknown as { __vyluxTest: TutorialHooks }).__vyluxTest.selectHq());
  await expect.poll(currentStep).toBe('trainWorker');

  await page.screenshot({ path: 'test-results/tutorial.png', fullPage: false });

  // 3. Skip exits the tutorial — navigates back to the menu (no ?tutorial).
  await page.getByRole('button', { name: /skip tutorial/i }).click();
  await page.waitForURL((url) => url.searchParams.get('tutorial') === null, { timeout: 5000 });
  expect(new URL(page.url()).searchParams.get('tutorial')).toBeNull();

  expect(consoleErrors).toEqual([]);
});
