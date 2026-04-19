import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

function attachConsoleGuard(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { consoleErrors, pageErrors };
}

test.describe('worker unit — hook helpers', () => {
  test('page boots, __vylux exposes getWorkerTile in dev mode', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForFunction(
      () => typeof window.__vylux !== 'undefined' && typeof window.__vylux.getWorkerTile === 'function',
      null,
      { timeout: 15_000 },
    );

    // 4 starter workers should exist (2 blue + 2 red).
    const workerInfo = await page.evaluate(() => {
      const tiles = [];
      for (let i = 0; i < 4; i++) {
        const t = window.__vylux?.getWorkerTile?.(i);
        tiles.push(t);
      }
      return tiles;
    });

    expect(workerInfo[0]).not.toBeNull();
    expect(workerInfo[1]).not.toBeNull();
    expect(workerInfo[2]).not.toBeNull();
    expect(workerInfo[3]).not.toBeNull();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('getWorkerTile returns correct starter positions in dev mode', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForFunction(
      () => typeof window.__vylux !== 'undefined' && typeof window.__vylux.getWorkerTile === 'function',
      null,
      { timeout: 15_000 },
    );

    const tiles = await page.evaluate(() => ({
      w0: window.__vylux?.getWorkerTile?.(0),
      w1: window.__vylux?.getWorkerTile?.(1),
      w2: window.__vylux?.getWorkerTile?.(2),
      w3: window.__vylux?.getWorkerTile?.(3),
    }));

    // Blue HQ at (3,9): blue workers start at (4,9) and (3,10).
    expect(tiles.w0).toEqual({ tileX: 4, tileY: 9 });
    expect(tiles.w1).toEqual({ tileX: 3, tileY: 10 });
    // Red HQ at (16,9): red workers start at (15,9) and (16,10).
    expect(tiles.w2).toEqual({ tileX: 15, tileY: 9 });
    expect(tiles.w3).toEqual({ tileX: 16, tileY: 10 });
  });

  test('moveWorker teleports the worker to the given tile (?e2e=1)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await page.waitForFunction(
      () =>
        typeof window.__vylux !== 'undefined' &&
        typeof window.__vylux.moveWorker === 'function' &&
        typeof window.__vylux.getWorkerTile === 'function',
      null,
      { timeout: 15_000 },
    );

    await page.evaluate(() => window.__vylux!.moveWorker!(0, 8, 8));

    const tile = await page.evaluate(() => window.__vylux!.getWorkerTile!(0));
    expect(tile).toEqual({ tileX: 8, tileY: 8 });
  });

  test('spawnWorker creates a new worker and getWorkerTile returns its position (?e2e=1)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await page.waitForFunction(
      () =>
        typeof window.__vylux !== 'undefined' &&
        typeof window.__vylux.spawnWorker === 'function' &&
        typeof window.__vylux.getWorkerTile === 'function',
      null,
      { timeout: 15_000 },
    );

    const idx = await page.evaluate(() => window.__vylux!.spawnWorker!('blue', 6, 6));
    expect(typeof idx).toBe('number');

    const tile = await page.evaluate((i: number) => window.__vylux!.getWorkerTile!(i), idx);
    expect(tile).toEqual({ tileX: 6, tileY: 6 });
  });
});

test.describe('worker unit — click-to-move via hook', () => {
  test('moveWorker + getWorkerTile: worker tile changes after command (?e2e=1)', async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await page.waitForFunction(
      () =>
        typeof window.__vylux !== 'undefined' &&
        typeof window.__vylux.moveWorker === 'function' &&
        typeof window.__vylux.getWorkerTile === 'function' &&
        typeof window.__vylux.ready === 'function',
      null,
      { timeout: 15_000 },
    );

    // Worker 0 (blue) starts at (4,9) — adjacent to blue HQ (3,9).
    const before = await page.evaluate(() => window.__vylux!.getWorkerTile!(0));
    expect(before).toEqual({ tileX: 4, tileY: 9 });

    // Teleport worker 0 to (10,10) via the hook.
    await page.evaluate(() => window.__vylux!.moveWorker!(0, 10, 10));

    // Allow a couple animation frames for the position to propagate.
    await page.evaluate(() => window.__vylux!.ready!());

    const after = await page.evaluate(() => window.__vylux!.getWorkerTile!(0));
    expect(after).toEqual({ tileX: 10, tileY: 10 });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
