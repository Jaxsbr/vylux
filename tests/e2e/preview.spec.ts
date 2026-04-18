import { test, expect } from '@playwright/test';

test.describe('US-01 production build guard', () => {
  test('window.__vylux is undefined on the production bundle', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    const exposed = await page.evaluate(() => typeof window.__vylux !== 'undefined');
    expect(exposed).toBe(false);
  });
});
