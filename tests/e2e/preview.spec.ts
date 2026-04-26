import { expect, test } from '@playwright/test';

// Production-bundle guard: the preview server returns a working page and
// no debug globals are leaked. Sim-driven build has no debug hook today;
// this test asserts the bundle stays clean if one is added later.

test('production bundle renders without leaking debug globals', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  const exposed = await page.evaluate(
    () => typeof (window as unknown as { __vylux: unknown }).__vylux !== 'undefined',
  );
  expect(exposed).toBe(false);
});
