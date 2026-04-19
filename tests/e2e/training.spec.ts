import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

function attachConsoleGuard(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { consoleErrors, pageErrors };
}

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.selectHq === 'function' &&
      typeof window.__vylux.pressTrainKey === 'function' &&
      typeof window.__vylux.getUnitCount === 'function' &&
      typeof window.__vylux.setEnergy === 'function',
    null,
    { timeout: 15_000 },
  );
}

test.describe('unit-training — HQ selection + Q/W/E hotkeys', () => {
  test('selectHq(blue) + pressTrainKey(q): worker count +1, energy -20', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Set blue energy to 200 so all three trains succeed.
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));

    const before = await page.evaluate(() => ({
      count: window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
      energy: (window.__vylux as unknown as { _energy?: unknown })['_energy'],
    }));

    await page.evaluate(() => window.__vylux!.selectHq!('blue'));
    await page.evaluate(() => window.__vylux!.pressTrainKey!('q'));

    const after = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
    );

    expect(after).toBe(before.count + 1);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('selectHq(blue) + pressTrainKey(w): defender count +1, energy -60', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));

    const beforeCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'defender' }),
    );

    await page.evaluate(() => window.__vylux!.selectHq!('blue'));
    await page.evaluate(() => window.__vylux!.pressTrainKey!('w'));

    const afterCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'defender' }),
    );

    expect(afterCount).toBe(beforeCount + 1);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('selectHq(blue) + pressTrainKey(e): raider count +1, energy -100', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));

    const beforeCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
    );

    await page.evaluate(() => window.__vylux!.selectHq!('blue'));
    await page.evaluate(() => window.__vylux!.pressTrainKey!('e'));

    const afterCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
    );

    expect(afterCount).toBe(beforeCount + 1);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('insufficient energy: training fails silently, no unit spawned', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Set energy below worker cost.
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 5, red: 0 }));

    const beforeCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
    );

    await page.evaluate(() => window.__vylux!.selectHq!('blue'));
    await page.evaluate(() => window.__vylux!.pressTrainKey!('q'));

    const afterCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
    );

    expect(afterCount).toBe(beforeCount);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('training three unit types in sequence deducts correct total energy', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    // Move both starter blue workers away from the HQ so all 3 valid
    // in-bounds neighbours of (0,0) are free for training spawns.
    await page.evaluate(() => {
      window.__vylux!.moveWorker!(0, 10, 10);
      window.__vylux!.moveWorker!(1, 11, 10);
    });

    // Start with 200 energy. Train worker(20) + defender(60) + raider(100) = 180 total.
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));

    await page.evaluate(() => window.__vylux!.selectHq!('blue'));
    await page.evaluate(() => window.__vylux!.pressTrainKey!('q'));
    await page.evaluate(() => window.__vylux!.pressTrainKey!('w'));
    await page.evaluate(() => window.__vylux!.pressTrainKey!('e'));

    // After training all three, unit counts should all be up.
    const counts = await page.evaluate(() => ({
      workers: window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
      defenders: window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'defender' }),
      raiders: window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
    }));

    // 2 starter workers (moved away) + 1 trained = 3 workers; 1 defender; 1 raider.
    expect(counts.workers).toBeGreaterThanOrEqual(3);
    expect(counts.defenders).toBeGreaterThanOrEqual(1);
    expect(counts.raiders).toBeGreaterThanOrEqual(1);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('pressTrainKey with no HQ selected does nothing', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachConsoleGuard(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?e2e=1');
    await waitForHook(page);

    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 200, red: 0 }));

    // Do NOT call selectHq — selection should be empty.
    const beforeCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
    );

    // pressTrainKey without HQ selected should be a no-op.
    await page.evaluate(() => window.__vylux!.pressTrainKey!('q'));

    const afterCount = await page.evaluate(() =>
      window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'worker' }),
    );

    expect(afterCount).toBe(beforeCount);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
