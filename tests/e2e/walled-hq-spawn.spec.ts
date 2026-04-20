import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.openBuildablesPanel === 'function' &&
      typeof window.__vylux.armBuildable === 'function' &&
      typeof window.__vylux.mouseTrainUnit === 'function' &&
      typeof window.__vylux.getUnitCount === 'function' &&
      typeof window.__vylux.setEnergy === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getRaiderTile === 'function' &&
      typeof window.__vylux.spawnWorker === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function',
    null,
    { timeout: 15_000 },
  );
}

test('single-click raider training: unit appears adjacent to HQ, no spawn-marker step', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await waitForHook(page);

  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 500, red: 0 }));

  // Move starter workers out of the way.
  await page.evaluate(() => {
    window.__vylux!.moveWorker!(0, 10, 10);
    window.__vylux!.moveWorker!(1, 11, 10);
  });

  const raidersBefore = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );

  // Single action: open panel, arm raider, click a proximity-zone tile.
  // This is ALL it should take — no spawn-marker step required.
  await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
  await page.evaluate(() => window.__vylux!.armBuildable!('raider'));
  const placed = await page.evaluate(() =>
    window.__vylux!.mouseTrainUnit!('raider', 4, 9),
  );
  expect(placed).toBe(true);

  const raidersAfter = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );
  expect(raidersAfter).toBe(raidersBefore + 1);

  // The raider must be on a tile adjacent to the blue HQ (3,9), not on the HQ tile itself.
  const raiderTile = await page.evaluate(() =>
    window.__vylux!.getRaiderTile!('blue', 0),
  );
  expect(raiderTile).not.toBeNull();
  const dx = Math.abs(raiderTile!.tileX - 3);
  const dy = Math.abs(raiderTile!.tileY - 9);
  expect(dx <= 1 && dy <= 1).toBe(true);
  // Must not be at the HQ tile itself.
  expect(raiderTile!.tileX === 3 && raiderTile!.tileY === 9).toBe(false);
});

test('HQ-enclosure guard: placing on last free adjacent tile is rejected with cue', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await waitForHook(page);

  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 2000, red: 0 }));

  // Move starter workers away.
  await page.evaluate(() => {
    window.__vylux!.moveWorker!(0, 10, 10);
    window.__vylux!.moveWorker!(1, 11, 10);
  });

  // Blue HQ is at (3,9). The 8 adjacent tiles are:
  // (4,9),(3,10),(2,9),(3,8),(4,10),(2,10),(4,8),(2,8)
  // Fill 7 of the 8 adjacents by training defenders onto them.
  // We use proximity-zone tiles that are also adjacent to HQ.
  const wallTiles: [number, number][] = [
    [4, 9],
    [3, 10],
    [2, 9],
    [3, 8],
    [4, 10],
    [2, 10],
    [4, 8],
  ];

  for (const [tx, ty] of wallTiles) {
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
    await page.evaluate(() => window.__vylux!.armBuildable!('defender'));
    const placed = await page.evaluate(
      ([x, y]) => window.__vylux!.mouseTrainUnit!('defender', x, y),
      [tx, ty],
    );
    expect(placed).toBe(true);
  }

  // At this point 7 of 8 HQ-adjacent tiles are occupied.
  // The only remaining free adjacent tile is (2,8).
  // Attempting to place on (2,8) should be REJECTED (would seal HQ).
  await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
  await page.evaluate(() => window.__vylux!.armBuildable!('defender'));
  const lastPlaced = await page.evaluate(() =>
    window.__vylux!.mouseTrainUnit!('defender', 2, 8),
  );
  expect(lastPlaced).toBe(false);

  // Confirm defender count is still 7 (not 8).
  const defCount = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'defender' }),
  );
  expect(defCount).toBe(7);

  await page.screenshot({ path: 'pm/screenshots/hq-enclosure-rejected.png' });
});

test('walled-HQ guard ensures Raider can still train after 7 defenders placed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await waitForHook(page);

  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 2000, red: 0 }));

  // Move starter workers away.
  await page.evaluate(() => {
    window.__vylux!.moveWorker!(0, 10, 10);
    window.__vylux!.moveWorker!(1, 11, 10);
  });

  // Fill 7 of 8 adjacents — enclosure guard prevents filling the last one.
  const wallTiles: [number, number][] = [
    [4, 9],
    [3, 10],
    [2, 9],
    [3, 8],
    [4, 10],
    [2, 10],
    [4, 8],
  ];
  for (const [tx, ty] of wallTiles) {
    await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
    await page.evaluate(() => window.__vylux!.armBuildable!('defender'));
    await page.evaluate(
      ([x, y]) => window.__vylux!.mouseTrainUnit!('defender', x, y),
      [tx, ty],
    );
  }

  // HQ still has 1 free adjacent tile (the one that was blocked by the enclosure guard).
  // Train a Raider — it must succeed and spawn on that last free tile.
  const raidersBefore = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );

  await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
  await page.evaluate(() => window.__vylux!.armBuildable!('raider'));
  // Use any proximity-zone tile as the "click" — spawn location is determined by
  // findFreeNeighbour, not by the clicked tile.
  const raiderPlaced = await page.evaluate(() =>
    window.__vylux!.mouseTrainUnit!('raider', 5, 9),
  );
  expect(raiderPlaced).toBe(true);

  const raidersAfter = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );
  expect(raidersAfter).toBe(raidersBefore + 1);

  // Raider must be adjacent to HQ.
  const raiderTile = await page.evaluate(() =>
    window.__vylux!.getRaiderTile!('blue', 0),
  );
  expect(raiderTile).not.toBeNull();
  const dx = Math.abs(raiderTile!.tileX - 3);
  const dy = Math.abs(raiderTile!.tileY - 9);
  expect(dx <= 1 && dy <= 1).toBe(true);

  await page.screenshot({ path: 'pm/screenshots/walled-hq-spawn.png' });
});
