import { expect, test } from '@playwright/test';

// Phase 2.0 exit-criterion in browser form: two tabs of the same origin
// connect via BroadcastChannel, both run the same merged input stream
// every tick, and both reach identical per-tick state hashes. The HUD
// reports `hash@<tick> match` once both peers have exchanged hashes for
// a given tick — that's what we assert.
//
// We open the host first and the joiner second; the lockstep channel's
// auto-echo on first peer-hello means both connect even though the host
// said hello before the joiner existed in the channel.

test('two-tab lockstep host + join reach matching hashes and run a match', async ({ context }) => {
  const consoleErrors: string[] = [];
  context.on('weberror', (err) => consoleErrors.push(err.error().message));

  const host = await context.newPage();
  const join = await context.newPage();

  host.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`host: ${msg.text()}`);
  });
  join.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`join: ${msg.text()}`);
  });
  host.on('pageerror', (err) => consoleErrors.push(`host: ${err.message}`));
  join.on('pageerror', (err) => consoleErrors.push(`join: ${err.message}`));

  // Phase 3.10.9: ?debug=1 enables the legacy text HUD the assertions
  // scrape (the player-facing HUD is now DOM cards, not parseable text).
  await host.goto('/?lockstep=host&debug=1');
  await join.goto('/?lockstep=join&debug=1');

  await expect(host.locator('#canvas')).toBeVisible();
  await expect(join.locator('#canvas')).toBeVisible();

  // Let both sims advance ~3 seconds (~60 ticks at 20 Hz).
  await host.waitForTimeout(3000);

  const readHud = async (tabName: string, page: typeof host): Promise<string> => {
    const txt = await page.locator('div').filter({ hasText: /vylux ·/ }).first().textContent();
    if (!txt) throw new Error(`${tabName}: HUD text not found`);
    return txt;
  };

  const hudHost = await readHud('host', host);
  const hudJoin = await readHud('join', join);

  // Both peers report `peer connected` (hello handshake landed).
  expect(hudHost).toMatch(/peer connected/);
  expect(hudJoin).toMatch(/peer connected/);

  // Tick should have advanced past trivial values on both sides.
  const tickHost = parseInt(hudHost.match(/tick (\d+)/)![1], 10);
  const tickJoin = parseInt(hudJoin.match(/tick (\d+)/)![1], 10);
  expect(tickHost).toBeGreaterThan(20);
  expect(tickJoin).toBeGreaterThan(20);
  // Tabs may be off by a tick or two due to rAF scheduling between
  // pages; lockstep only requires they agree on the SAME state at the
  // same tick number. The hash-status check below verifies that.
  // Bound bumped from 2 to 5 in Phase 3.0 — structure advancement adds
  // a small amount of per-tick work that widens cross-tab rAF jitter.
  expect(Math.abs(tickHost - tickJoin)).toBeLessThanOrEqual(5);

  // The per-tick hash exchange line. Once both peers have exchanged
  // hashes for the previous tick, the HUD reads `hash@<n> match`.
  // A `desync` here would be the production form of the Phase 0 hash
  // gate firing — never expected in 2.0 same-machine play.
  expect(hudHost).toMatch(/hash@\d+ match/);
  expect(hudJoin).toMatch(/hash@\d+ match/);
  expect(hudHost).not.toMatch(/DESYNC/);
  expect(hudJoin).not.toMatch(/DESYNC/);

  expect(consoleErrors).toEqual([]);
});
