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

  test('grid is mounted with 400 tiles and emissive-white dividers', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    const debug = await page.evaluate(() => window.__vylux!.debug);
    expect(debug.tileCount).toBe(400);
    expect(debug.tileColors).toHaveLength(400);

    for (let i = 0; i < 10; i++) {
      const idx = Math.floor(Math.random() * 400);
      expect(debug.tileColors[idx]).toBe('#0a0a0a');
    }

    expect(debug.gridLineMaterial.emissive).toBe('ffffff');
    expect(debug.gridLineMaterial.emissiveIntensity).toBeGreaterThanOrEqual(0.1);
    expect(debug.gridLineMaterial.emissiveIntensity).toBeLessThanOrEqual(0.4);
  });

  test('raycast from viewport center hits a tile and returns a valid (tileX, tileY)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    const hit = await page.evaluate(() => window.__vylux!.raycastCenter());
    expect(hit).not.toBeNull();
    expect(Number.isInteger(hit!.tileX)).toBe(true);
    expect(Number.isInteger(hit!.tileY)).toBe(true);
    expect(hit!.tileX).toBeGreaterThanOrEqual(0);
    expect(hit!.tileX).toBeLessThan(20);
    expect(hit!.tileY).toBeGreaterThanOrEqual(0);
    expect(hit!.tileY).toBeLessThan(20);
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

  test('keyboard drives placement state and cursor (US-03)', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    const initial = await page.evaluate(() => ({
      mode: window.__vylux!.state.mode,
      selectedUnitType: window.__vylux!.state.selectedUnitType,
      cursor: (document.querySelector('canvas') as HTMLCanvasElement).style.cursor,
    }));
    expect(initial.mode).toBe('idle');
    expect(initial.selectedUnitType).toBeNull();
    expect(initial.cursor).toBe('default');

    await page.keyboard.press('1');
    const afterBlue = await page.evaluate(() => ({
      mode: window.__vylux!.state.mode,
      selectedUnitType: window.__vylux!.state.selectedUnitType,
      cursor: (document.querySelector('canvas') as HTMLCanvasElement).style.cursor,
    }));
    expect(afterBlue.mode).toBe('placement');
    expect(afterBlue.selectedUnitType).toBe('blue');
    expect(afterBlue.cursor).toBe('none');

    await page.keyboard.press('2');
    const afterRed = await page.evaluate(() => ({
      mode: window.__vylux!.state.mode,
      selectedUnitType: window.__vylux!.state.selectedUnitType,
      cursor: (document.querySelector('canvas') as HTMLCanvasElement).style.cursor,
    }));
    expect(afterRed.mode).toBe('placement');
    expect(afterRed.selectedUnitType).toBe('red');
    expect(afterRed.cursor).toBe('none');

    await page.keyboard.press('Escape');
    const afterEscape = await page.evaluate(() => ({
      mode: window.__vylux!.state.mode,
      selectedUnitType: window.__vylux!.state.selectedUnitType,
      cursor: (document.querySelector('canvas') as HTMLCanvasElement).style.cursor,
    }));
    expect(afterEscape.mode).toBe('idle');
    expect(afterEscape.selectedUnitType).toBeNull();
    expect(afterEscape.cursor).toBe('default');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('hover preview: ghost mesh appears, switches faction, clears on Escape and off-grid (US-04)', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    const initial = await page.evaluate(() => {
      const d = window.__vylux!.debug;
      return {
        ghostVisible: d.ghost.visible,
        opacity: d.ghost.material.opacity,
        transparent: d.ghost.material.transparent,
        ghostCount: d.ghostCount,
      };
    });
    expect(initial.ghostVisible).toBe(false);
    expect(initial.transparent).toBe(true);
    expect(initial.opacity).toBeGreaterThanOrEqual(0.35);
    expect(initial.opacity).toBeLessThanOrEqual(0.45);
    expect(initial.ghostCount).toBe(1);

    await page.keyboard.press('1');
    await page.mouse.move(400, 300);
    await page.waitForFunction(
      () => window.__vylux!.state.hoveredTile !== null && window.__vylux!.debug.ghost.visible,
      null,
      { timeout: 2000 },
    );
    const afterMove = await page.evaluate(() => {
      const v = window.__vylux!;
      return {
        hovered: v.state.hoveredTile,
        visible: v.debug.ghost.visible,
        emissive: v.debug.ghost.material.emissive,
      };
    });
    expect(afterMove.hovered).not.toBeNull();
    expect(afterMove.visible).toBe(true);
    expect(afterMove.emissive).toBe('00e5ff');

    const hoveredIdx = afterMove.hovered!.tileY * 20 + afterMove.hovered!.tileX;
    const hoverColor = await page.evaluate(
      (idx: number) => window.__vylux!.debug.tileColors[idx],
      hoveredIdx,
    );
    expect(hoverColor).toBe('#0d4d57');

    await page.keyboard.press('2');
    await page.waitForFunction(
      () => window.__vylux!.debug.ghost.material.emissive === 'ff5a1f',
      null,
      { timeout: 2000 },
    );
    const redHoverColor = await page.evaluate(
      (idx: number) => window.__vylux!.debug.tileColors[idx],
      hoveredIdx,
    );
    expect(redHoverColor).toBe('#5a2311');

    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => window.__vylux!.debug.ghost.visible === false,
      null,
      { timeout: 2000 },
    );
    const allDefault = await page.evaluate(() =>
      window.__vylux!.debug.tileColors.every((c: string) => c === '#0a0a0a'),
    );
    expect(allDefault).toBe(true);

    await page.keyboard.press('1');
    await page.mouse.move(400, 300);
    await page.waitForFunction(() => window.__vylux!.state.hoveredTile !== null);
    await page.mouse.move(10, 10);
    await page.waitForFunction(
      () => window.__vylux!.state.hoveredTile === null && !window.__vylux!.debug.ghost.visible,
      null,
      { timeout: 2000 },
    );

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('rapid mouse sweep never leaks ghost meshes (US-04 L54)', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__vylux !== 'undefined');

    await page.keyboard.press('1');
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      const x = 200 + i * 20;
      const y = 200 + (i % 5) * 30;
      await page.mouse.move(x, y);
    }
    expect(Date.now() - start).toBeLessThan(2000);

    const { ghostCount, hoveredTile } = await page.evaluate(() => ({
      ghostCount: window.__vylux!.debug.ghostCount,
      hoveredTile: window.__vylux!.state.hoveredTile,
    }));
    expect(ghostCount).toBe(1);
    expect(hoveredTile).not.toBeNull();
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
