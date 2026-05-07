import { expect, test } from '@playwright/test';

// Phase 2.1 exit-criterion in browser form: two clients connect via
// the signaling server, complete a WebRTC offer/answer + ICE handshake,
// and run a short lockstep match peer-to-peer over the datachannel.
//
// "Different networks" is the actual exit phrase, but we can't run a
// dual-network smoke from CI. Loopback host candidates exercise the
// same code path: signaling relay, RTCPeerConnection negotiation,
// trickle ICE, datachannel open, application traffic over the channel.
// Cross-network validation is a manual deploy step.

test('two-tab WebRTC lockstep handshake reaches matching hashes', async ({ context }) => {
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

  // Use a fixed valid room code from the confusable-free alphabet.
  const room = 'TEST23';

  await host.goto(`/?lockstep=host&room=${room}`);
  // Stagger the joiner slightly so the host's `peer-joined` path drives
  // the offer (matches the production flow: host creates the room, then
  // the joiner enters the code).
  await host.waitForTimeout(200);
  await join.goto(`/?lockstep=join&room=${room}`);

  await expect(host.locator('#canvas')).toBeVisible({ timeout: 10_000 });
  await expect(join.locator('#canvas')).toBeVisible({ timeout: 10_000 });

  // Allow time for: WebSocket signal connect, SDP exchange, ICE,
  // datachannel open, hello handshake, then a few seconds of sim. ICE
  // on loopback is fast (host candidates only) but Chromium still
  // takes a moment to negotiate.
  await host.waitForTimeout(4000);

  const readHud = async (label: string, page: typeof host): Promise<string> => {
    const txt = await page.locator('div').filter({ hasText: /vylux ·/ }).first().textContent();
    if (!txt) throw new Error(`${label}: HUD text not found`);
    return txt;
  };

  const hudHost = await readHud('host', host);
  const hudJoin = await readHud('join', join);

  expect(hudHost).toMatch(/peer connected/);
  expect(hudJoin).toMatch(/peer connected/);

  // Both clients should be ticking; tolerance ≤ 6 ticks because
  // WebRTC datachannel adds a small latency vs in-process
  // BroadcastChannel and Phase 3.0's structure advancement adds a tiny
  // amount of work per sim tick that widens cross-tab rAF jitter.
  const tickHost = parseInt(hudHost.match(/tick (\d+)/)![1], 10);
  const tickJoin = parseInt(hudJoin.match(/tick (\d+)/)![1], 10);
  expect(tickHost).toBeGreaterThan(20);
  expect(tickJoin).toBeGreaterThan(20);
  expect(Math.abs(tickHost - tickJoin)).toBeLessThanOrEqual(6);

  expect(hudHost).toMatch(/hash@\d+ match/);
  expect(hudJoin).toMatch(/hash@\d+ match/);
  expect(hudHost).not.toMatch(/DESYNC/);
  expect(hudJoin).not.toMatch(/DESYNC/);

  expect(consoleErrors).toEqual([]);
});
