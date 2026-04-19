import { test, expect, type Page } from '@playwright/test';

async function waitForHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.spawnRaider === 'function' &&
      typeof window.__vylux.getRaiderTile === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.getHqHp === 'function' &&
      typeof window.__vylux.setScene === 'function',
    null,
    { timeout: 15_000 },
  );
}

test('offensive-reach: blue raider placed at blue HQ travels to red side and damages red HQ', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');
  await waitForHook(page);

  // Reset to clean idle-start — removes any previously seeded units.
  await page.evaluate(() => window.__vylux!.setScene!('idle-start'));

  // Seed blue energy so we don't need to wait for income.
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 500, red: 0 }));

  // Record initial red HQ HP.
  const initialRedHqHp = await page.evaluate(() => window.__vylux!.getHqHp!('red'));
  expect(initialRedHqHp).toBeGreaterThan(0);

  // Spawn a blue raider at (1, 0) — near the blue HQ at (0,0), bottom-left region.
  const raiderIndex = await page.evaluate(() =>
    window.__vylux!.spawnRaider!('blue', 1, 0),
  );

  // Confirm spawn position.
  const spawnTile = await page.evaluate((idx) =>
    window.__vylux!.getRaiderTile!('blue', idx),
    raiderIndex,
  );
  expect(spawnTile).not.toBeNull();
  expect(spawnTile!.tileX).toBe(1);
  expect(spawnTile!.tileY).toBe(0);

  // Advance 12 seconds of simulated time so the raider crosses the map.
  // Distance from (1,0) to red HQ at (19,19) is ~26 tiles; at 2.8 t/s that's ~9.3s.
  // We add buffer to ensure at least one attack fires.
  await page.evaluate(() => window.__vylux!.advanceTime!(12));

  // Assert: raider moved from spawn tile.
  const midTile = await page.evaluate((idx) =>
    window.__vylux!.getRaiderTile!('blue', idx),
    raiderIndex,
  );
  // If raider died in combat that's also fine — it reached the red side and fought.
  // We check the raider is no longer at spawn OR red HQ took damage.

  const redHqHpAfter = await page.evaluate(() => window.__vylux!.getHqHp!('red'));

  // Take screenshot before assertions so we always capture the mid-combat state.
  await page.screenshot({ path: 'pm/screenshots/mid-combat.png' });

  // Either the raider is no longer at its spawn tile (moved across map) …
  const raiderMoved =
    midTile === null || // raider died — it reached the red side and was destroyed
    midTile.tileX !== 1 ||
    midTile.tileY !== 0;

  // … or the red HQ took damage (raider reached attack range and fired).
  const hqDamaged = redHqHpAfter < initialRedHqHp;

  expect(raiderMoved || hqDamaged).toBe(true);

  // If raider is still alive, assert it reached the red half of the grid (tile > midpoint 9).
  if (midTile !== null) {
    // At least one coordinate should be in the red half (col > 9 or row > 9).
    const onRedSide = midTile.tileX > 9 || midTile.tileY > 9;
    expect(onRedSide).toBe(true);
  }

  // Red HQ must have taken at least some damage (raider reached and attacked).
  expect(redHqHpAfter).toBeLessThan(initialRedHqHp);
});
