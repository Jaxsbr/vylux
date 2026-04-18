import { test, expect } from '@playwright/test';

const DEV_PORT = 5180;

test.describe('US-01 dev HTTP smoke', () => {
  test('dev port is unprivileged (>= 1024)', async () => {
    expect(DEV_PORT).toBeGreaterThanOrEqual(1024);
  });

  test('dev server returns HTTP 200 on /', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
  });
});
