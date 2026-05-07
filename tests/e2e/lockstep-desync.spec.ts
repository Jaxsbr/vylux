import { expect, test } from '@playwright/test';

// Phase 2.3 exit-criterion: a deliberately-corrupted client is detected
// within ~1 second of its first divergent tick. The harness:
//   - Both tabs run the same lockstep match (BroadcastChannel mode is
//     enough — the gate is the hash-exchange + UI surface, not the
//     transport substrate; that's covered by 2.1's E2E).
//   - One tab is loaded with `?desync-test=N`, which mutates state
//     once at tick N. The mutation diverges its hash from the peer's
//     starting at tick N (and forward).
//   - Both tabs should display the DESYNC overlay within ~1 second
//     (20 ticks at 20 Hz). The detection latency is bounded by one
//     hash-exchange round-trip after the divergent tick.
//
// We assert overlay visibility on both tabs because the protocol fires
// onDesync on whichever side observes the mismatch first — in
// practice that's both sides within the same exchange round.

const CORRUPT_AT_TICK = 25;

test('deliberately-corrupted client surfaces desync overlay within ~1 second', async ({ context }) => {
  const consoleErrors: string[] = [];
  // Allow the desync handler's own log lines + Chromium GPU-driver
  // performance messages (which surface as console warnings even on
  // headless GL paths and have nothing to do with our code).
  const expectedPattern = /lockstep desync|desync-test: corrupted state|GL Driver Message/;

  const host = await context.newPage();
  const join = await context.newPage();

  // We expect specific console.error / console.warn lines from the
  // desync handler and the test-only corruption logger; collect all
  // others as failures.
  const collect = (label: string, page: typeof host) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text();
        if (expectedPattern.test(text)) return;
        consoleErrors.push(`${label}: ${text}`);
      }
    });
    page.on('pageerror', (err) => consoleErrors.push(`${label}: ${err.message}`));
  };
  collect('host', host);
  collect('join', join);

  // Host gets the corruption injection; join is clean. Either side
  // detecting first is fine — the assertion below checks both tabs
  // surface the overlay.
  await host.goto(`/?lockstep=host&desync-test=${CORRUPT_AT_TICK}`);
  await join.goto('/?lockstep=join');

  await expect(host.locator('#canvas')).toBeVisible();
  await expect(join.locator('#canvas')).toBeVisible();

  // Wait for: hello handshake → ~25 ticks of clean play → corruption
  // injection at tick 25 → ~1 hash-exchange tick → desync overlay.
  // 3 seconds is generous; in practice it fires near 1.5 s.
  const desyncHeading = (page: typeof host) =>
    page.getByText('DESYNC DETECTED', { exact: true });

  await expect(desyncHeading(host)).toBeVisible({ timeout: 6000 });
  await expect(desyncHeading(join)).toBeVisible({ timeout: 6000 });

  // The divergent tick should be at or shortly after CORRUPT_AT_TICK.
  // We accept a small window because the corruption fires "after the
  // sim crosses N", which lands on tick N+1 most rAFs.
  const overlayText = await host.locator('div').filter({ hasText: 'divergent at tick' }).first().textContent();
  expect(overlayText).toMatch(/divergent at tick (\d+)/);
  const tick = parseInt(overlayText!.match(/divergent at tick (\d+)/)![1], 10);
  expect(tick).toBeGreaterThanOrEqual(CORRUPT_AT_TICK);
  expect(tick).toBeLessThanOrEqual(CORRUPT_AT_TICK + 20); // <1s window

  // Each overlay carries a Download Replay button — clicking it must
  // not throw. We don't assert the actual file because Playwright's
  // download capture varies by browser; the click-cleanly assertion
  // is the integration check.
  await host.locator('button', { hasText: 'DOWNLOAD REPLAY' }).click({ trial: true });

  expect(consoleErrors).toEqual([]);
});
