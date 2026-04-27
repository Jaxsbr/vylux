import { expect, test } from '@playwright/test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { parseReplay, playReplay } from '../../src/sim/replay';

// Phase 2.4 exit-criterion: save a replay from a live multiplayer
// match, replay it via the headless runner, final hashes match.
//
// This test exercises the path end-to-end:
//   - Two browser tabs run a lockstep match (BroadcastChannel mode is
//     enough — the replay format is transport-agnostic).
//   - Host presses R after enough ticks for non-trivial state.
//   - Playwright captures the download.
//   - The test process imports playReplay and runs the replay against
//     a fresh Sim. playReplay throws if the recorded finalHash does
//     not match the reproduced one — passing it IS the assertion.

test('replay saved mid-match round-trips through playReplay() to the same final hash', async ({ context }) => {
  const tmp = mkdtempSync(joinPath(tmpdir(), 'vylux-replay-'));
  try {
    const host = await context.newPage();
    const join = await context.newPage();

    const consoleErrors: string[] = [];
    const allow = /GL Driver Message/;
    for (const [label, page] of [['host', host], ['join', join]] as const) {
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
          if (allow.test(msg.text())) return;
          consoleErrors.push(`${label}: ${msg.text()}`);
        }
      });
      page.on('pageerror', (err) => consoleErrors.push(`${label}: ${err.message}`));
    }

    await host.goto('/?lockstep=host');
    await join.goto('/?lockstep=join');

    await expect(host.locator('#canvas')).toBeVisible();
    await expect(join.locator('#canvas')).toBeVisible();

    // Let the lockstep loop run past the input-delay warm-up (6 ticks)
    // and into a few seconds of paired play. By tick 50 the sims have
    // produced training commands, harvest progress, and a non-trivial
    // hash — enough that the replay is meaningful.
    await host.waitForTimeout(3000);

    // Trigger the replay download with the R-key binding from main.ts.
    const downloadPromise = host.waitForEvent('download', { timeout: 5000 });
    await host.keyboard.press('r');
    const download = await downloadPromise;

    // The filename embeds the role and the tick at save time —
    // self-describing for bug reports.
    expect(download.suggestedFilename()).toMatch(/^vylux-replay-tick\d+-host\.json$/);

    const savedAt = joinPath(tmp, download.suggestedFilename());
    await download.saveAs(savedAt);

    const json = readFileSync(savedAt, 'utf-8');
    const replay = parseReplay(json);
    // Phase 3 bumps the replay format ≥ v2 as state shape extends
    // each sub-phase. Test asserts forward-compatibility rather than
    // a specific number.
    expect(replay.version).toBeGreaterThanOrEqual(2);
    expect(replay.frames.length).toBeGreaterThan(20);

    // playReplay throws if finalHash on the file doesn't match what it
    // reproduces. That's the round-trip gate — same property the
    // cross-OS CI workflow validates against the committed golden
    // fixtures, applied here to a live-match-derived replay.
    const result = playReplay(replay);
    expect(result.finalHash).toBe(replay.finalHash);
    expect(result.tick).toBe(replay.frames.length);

    expect(consoleErrors).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
