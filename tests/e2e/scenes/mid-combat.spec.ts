import { test } from '@playwright/test';

test('mid-combat scene snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2e=1');

  await page.waitForFunction(
    () =>
      typeof window.__vylux !== 'undefined' &&
      typeof window.__vylux.setScene === 'function' &&
      typeof window.__vylux.ready === 'function' &&
      typeof window.__vylux.advanceTime === 'function' &&
      typeof window.__vylux.setAiEnabled === 'function',
    null,
    { timeout: 15_000 },
  );

  // Let AI run — red will organically produce raiders + defenders and push toward blue.
  await page.evaluate(() => window.__vylux!.setAiEnabled!(true));
  await page.evaluate(() => window.__vylux!.setScene!('mid-combat'));
  await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 58, red: 200 }));
  await page.evaluate(() => window.__vylux!.setPoints!({ blue: 145, red: 132 }));
  // Node 0 (5,5) held by blue economy; node 2 (5,14) contested → blue; node 3 (14,14) held by red.
  await page.evaluate(() => window.__vylux!.setNodeHolds!({ 0: 'blue', 2: 'blue', 3: 'red' }));

  // Let AI run for 12s — should organically produce red raiders + defenders pushing toward blue.
  await page.evaluate(() => window.__vylux!.advanceTime!(12.0));

  // Safety floor: if fewer than 2 red units alive, fall back to hand-seeded tableau
  // so the screenshot still shows a combat scene.
  // (Fallback path — only runs if AI didn't produce enough units in time.)
  const redUnitCount = await page.evaluate(() => {
    const h = window.__vylux!;
    if (typeof h.getUnitCount !== 'function') return 0;
    return (
      h.getUnitCount!({ faction: 'red', kind: 'worker' }) +
      h.getUnitCount!({ faction: 'red', kind: 'defender' }) +
      h.getUnitCount!({ faction: 'red', kind: 'raider' })
    );
  });

  if (redUnitCount < 2) {
    // Fallback: hand-seed the old tableau so the screenshot isn't empty.
    await page.evaluate(() => window.__vylux!.setScene!('mid-combat'));
    await page.evaluate(() => window.__vylux!.setEnergy!({ blue: 58, red: 43 }));
    await page.evaluate(() => window.__vylux!.setPoints!({ blue: 145, red: 132 }));
    await page.evaluate(() => window.__vylux!.setNodeHolds!({ 0: 'blue', 2: 'blue', 3: 'red' }));
    await page.evaluate(() => window.__vylux!.advanceTime!(1.2));
  }

  await page.evaluate(() => window.__vylux!.ready!());

  await page.screenshot({ path: 'pm/screenshots/mid-combat.png' });
});
