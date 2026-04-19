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

test('walled-HQ: raider trains when HQ is surrounded by defenders; walks to spawn point', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await waitForHook(page);

  // Disable AI to keep the scene deterministic.
  await page.evaluate(() => window.__vylux!.setAiEnabled!(false));

  // Seed energy so we can afford 4 defenders (60 each = 240) + 1 raider (100).
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 800, red: 0 }));

  // Move the 2 starter workers out of the proximity zone so they don't block tile checks.
  await page.evaluate(() => {
    window.__vylux!.moveWorker!(0, 10, 10);
    window.__vylux!.moveWorker!(1, 11, 10);
  });

  // Blue HQ is at (3,9). The 8 adjacent tiles are:
  // (4,9),(3,10),(2,9),(3,8),(4,10),(2,10),(4,8),(2,8)
  // Train 4 defenders to fill all 4 cardinal adjacents (the most important ones).
  // Use mouseTrainUnit which validates proximity zone, then spawns at HQ and walks to spawn.
  // We place tiles within the proximity zone that surround the HQ.
  const wallTiles: [number, number][] = [
    [4, 9],  // right
    [3, 10], // below
    [2, 9],  // left
    [3, 8],  // above
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

  // 4 defenders should now be trained.
  const defCount = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'defender' }),
  );
  expect(defCount).toBe(4);

  // Now the 4 cardinal tiles are "occupied" by defenders walking to them.
  // Training a Raider should still succeed — unit spawns at HQ tile (3,9)
  // and walks to the spawn point regardless of adjacency.
  const raiderCountBefore = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );

  await page.evaluate(() => window.__vylux!.openBuildablesPanel!());
  await page.evaluate(() => window.__vylux!.armBuildable!('raider'));
  const raiderPlaced = await page.evaluate(() =>
    // Place within proximity zone — any valid tile in zone
    window.__vylux!.mouseTrainUnit!('raider', 5, 9),
  );
  expect(raiderPlaced).toBe(true);

  const raiderCountAfter = await page.evaluate(() =>
    window.__vylux!.getUnitCount!({ faction: 'blue', kind: 'raider' }),
  );
  expect(raiderCountAfter).toBe(raiderCountBefore + 1);

  // Advance a few seconds so the raider walks toward the spawn point (4,9 default for blue HQ).
  await page.evaluate(() => window.__vylux!.advanceTime!(2.0));

  // Raider should have moved away from the HQ tile (3,9) toward the spawn tile.
  // Default spawn for blue HQ at (3,9) is (4,9) — raider may land near there.
  const raiderTile = await page.evaluate(() =>
    window.__vylux!.getRaiderTile!('blue', 0),
  );
  expect(raiderTile).not.toBeNull();
  // After 2s the raider should not still be exactly at the HQ tile.
  // (It's a 1-tile move so it should reach the spawn point quickly.)
  const notAtHqTile =
    raiderTile!.tileX !== 3 || raiderTile!.tileY !== 9;
  expect(notAtHqTile).toBe(true);

  await page.screenshot({ path: 'pm/screenshots/walled-hq-spawn.png' });
});
