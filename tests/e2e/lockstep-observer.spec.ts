import { expect, test } from '@playwright/test';

// Phase 2.5 exit-criterion: one observer can attach to a 2-player
// match and watch it through to completion in sync.
//
// Three browser tabs in BroadcastChannel mode: host (faction 0), join
// (faction 1), and observer. The observer listens on the same
// BroadcastChannel that carries the lockstep frames; its sim is driven
// read-only. After ~3 s of paired play, the observer's tick should be
// within a tiny window of the players' ticks (BroadcastChannel
// delivery is fast, but rAF scheduling between three tabs adds noise).

test('observer attaches to a 2-player match and ticks in sync', async ({ context }) => {
  const consoleErrors: string[] = [];
  const allow = /GL Driver Message/;
  const collect = (label: string, page: ReturnType<typeof context.newPage> extends Promise<infer P> ? P : never) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        if (allow.test(msg.text())) return;
        consoleErrors.push(`${label}: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => consoleErrors.push(`${label}: ${err.message}`));
  };

  const host = await context.newPage();
  const join = await context.newPage();
  const observe = await context.newPage();
  collect('host', host);
  collect('join', join);
  collect('observe', observe);

  // Observer goes first so it's listening before any player frame is
  // sent — same flow a tournament caster would use ("attach to room
  // first, tell players when to start").
  // Phase 3.10.9: ?debug=1 enables the legacy text HUD the assertions
  // scrape (the player-facing HUD is now DOM cards, not parseable text).
  await observe.goto('/?lockstep=observe&debug=1');
  await host.goto('/?lockstep=host&debug=1');
  await join.goto('/?lockstep=join&debug=1');

  await expect(host.locator('#canvas')).toBeVisible();
  await expect(join.locator('#canvas')).toBeVisible();
  await expect(observe.locator('#canvas')).toBeVisible();

  await host.waitForTimeout(3000);

  const readHud = async (label: string, page: typeof host): Promise<string> => {
    const txt = await page.locator('div').filter({ hasText: /vylux ·/ }).first().textContent();
    if (!txt) throw new Error(`${label}: HUD text not found`);
    return txt;
  };

  const hudHost = await readHud('host', host);
  const hudJoin = await readHud('join', join);
  const hudObs = await readHud('observe', observe);

  // Observer mode label should be present on the third tab and absent
  // on the players.
  expect(hudObs).toMatch(/observer/);
  expect(hudObs).toMatch(/both factions live/);
  expect(hudHost).not.toMatch(/observer/);
  expect(hudJoin).not.toMatch(/observer/);

  const tickHost = parseInt(hudHost.match(/tick (\d+)/)![1], 10);
  const tickJoin = parseInt(hudJoin.match(/tick (\d+)/)![1], 10);
  const tickObs = parseInt(hudObs.match(/tick (\d+)/)![1], 10);

  expect(tickHost).toBeGreaterThan(20);
  expect(tickJoin).toBeGreaterThan(20);
  expect(tickObs).toBeGreaterThan(20);

  // Observer tick stays within a small window of the players. rAF
  // scheduling between three tabs can put the observer ahead of the
  // slowest player or behind the fastest by a couple of ticks; we
  // require a bounded skew, not strict ordering. The determinism
  // property — same hash on the same tick — is what actually matters
  // and is verified by the channel-level gate.
  const slowestPlayer = Math.min(tickHost, tickJoin);
  const fastestPlayer = Math.max(tickHost, tickJoin);
  expect(slowestPlayer - tickObs).toBeLessThanOrEqual(8);
  expect(tickObs - fastestPlayer).toBeLessThanOrEqual(8);

  expect(consoleErrors).toEqual([]);
});
