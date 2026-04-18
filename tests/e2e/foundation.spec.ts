import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

function attachConsoleGuard(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  return { consoleErrors, pageErrors };
}

test.describe('US-01 scene foundation', () => {
  test('page loads with scene mounted and no console errors', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    const debug = await page.evaluate(() => window.__vylux!.debug);
    expect(debug.backgroundColor).toBe('#0a0a0a');
    expect(debug.cameraType).toBe('OrthographicCamera');
    expect(Math.abs(debug.cameraRotation.yawDeg - 45)).toBeLessThan(0.5);
    expect(Math.abs(debug.cameraRotation.pitchDeg - -30)).toBeLessThan(0.5);
    expect(debug.lightCounts.ambient).toBeGreaterThanOrEqual(1);
    expect(debug.lightCounts.directional).toBeGreaterThanOrEqual(1);
    expect(debug.contextLost).toBe(false);

    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBe(1);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('canvas resizes when viewport changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas') as HTMLCanvasElement;
        return c.width === 800 && c.height === 600;
      },
      null,
      { timeout: 2000 },
    );

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas') as HTMLCanvasElement;
        return c.width === 1280 && c.height === 720;
      },
      null,
      { timeout: 2000 },
    );
  });

  test('webglcontextlost is handled without uncaught error', async ({ page }) => {
    const { pageErrors } = attachConsoleGuard(page);
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    });

    await page.waitForFunction(() => window.__vylux?.debug.contextLost === true, {
      timeout: 2000,
    });
    const flag = await page.evaluate(() => window.__vylux!.debug.contextLost);
    expect(flag).toBe(true);
    expect(pageErrors).toEqual([]);
  });
});
