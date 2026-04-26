// The determinism gate, tested.
//
// Every test in this file backs one of the success criteria from
// docs/investigation/00-determinism-and-netcode.md. If anything here goes
// red, the spike's contract is broken and Phase 1 cannot start.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import type { InitialMatchSpec } from './state';
import { CommandKind, type InputFrame } from './commands';

function defaultSpec(seed = 42): InitialMatchSpec {
  return {
    seed,
    hqs: {
      faction0: { x: 2, y: 2 },
      faction1: { x: 18, y: 18 },
    },
    nodes: [
      { x: 8, y: 5, energy: 100 },
      { x: 12, y: 14, energy: 100 },
      { x: 5, y: 12, energy: 100 },
    ],
  };
}

// Build a synthetic match: spawn a worker on each side at tick 0, point
// them at a node on tick 1, and let them harvest/return forever.
function scriptedMatch(durationTicks: number): InputFrame[] {
  const frames: InputFrame[] = [];
  for (let t = 0; t < durationTicks; t++) {
    if (t === 0) {
      frames.push({
        tick: 0,
        commands: [
          { kind: CommandKind.SpawnWorker, faction: 0, x: 2, y: 2 },
          { kind: CommandKind.SpawnWorker, faction: 1, x: 18, y: 18 },
        ],
      });
    } else if (t === 1) {
      frames.push({
        tick: 1,
        commands: [
          { kind: CommandKind.AssignWorkerToNode, workerId: 4, nodeId: 1 },
          { kind: CommandKind.AssignWorkerToNode, workerId: 5, nodeId: 2 },
        ],
      });
    } else {
      frames.push({ tick: t, commands: [] });
    }
  }
  return frames;
}

function runMatch(spec: InitialMatchSpec, frames: InputFrame[]): string[] {
  const sim = new Sim(spec);
  const hashes: string[] = [];
  hashes.push(sim.stateHash()); // tick-0 hash before any step
  for (const frame of frames) {
    sim.step(frame);
    hashes.push(sim.stateHash());
  }
  return hashes;
}

describe('Sim — determinism gate', () => {
  it('two runs with identical inputs produce identical hash sequences (10s of sim)', () => {
    // 10 seconds at 20 Hz = 200 ticks. Smaller than the spike's 10-min
    // target but enough to catch any first-order non-determinism.
    const frames = scriptedMatch(200);
    const a = runMatch(defaultSpec(), frames);
    const b = runMatch(defaultSpec(), frames);
    expect(a).toEqual(b);
    expect(a).toHaveLength(201);
  });

  it('two runs with identical inputs produce identical hash sequences (12000 ticks ≈ 10 min)', () => {
    // 10 minutes at 20 Hz = 12,000 ticks. This is the actual spike
    // duration target. A real cross-machine run would do this against
    // a recorded log; here we prove it on a single machine.
    const frames = scriptedMatch(12000);
    const a = runMatch(defaultSpec(), frames);
    const b = runMatch(defaultSpec(), frames);
    expect(a).toEqual(b);
  });

  it('different seeds produce different hash sequences', () => {
    // Seed currently doesn't drive any sim mechanics (no RNG-using code),
    // but it's mixed into stateHash via rngState and bumped via the Rng
    // owned by Sim. Different seeds → different snapshots immediately.
    // If this fails it means seed is being ignored — caught here.
    const frames = scriptedMatch(50);
    const a = runMatch(defaultSpec(1), frames);
    const b = runMatch(defaultSpec(2), frames);
    expect(a[0]).not.toBe(b[0]);
  });

  it('a corrupted command produces a divergent hash within one tick', () => {
    // The desync-detection criterion. Run two sims with identical inputs
    // for the first 50 ticks, then on tick 50 inject a different command
    // into one of them. Hashes must agree up to and including tick 50's
    // *pre-step* hash, and disagree at tick 51's hash (after the divergent
    // command is applied).
    const N = 100;
    const baseFrames = scriptedMatch(N);
    const corruptedFrames = baseFrames.map((f) => ({ ...f, commands: [...f.commands] }));
    corruptedFrames[50] = {
      tick: 50,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: 4, nodeId: 3 }],
    };

    const goodHashes = runMatch(defaultSpec(), baseFrames);
    const badHashes = runMatch(defaultSpec(), corruptedFrames);

    // Hashes 0..50 are computed pre-step or after non-divergent steps.
    // The divergent command applies during step(50→51); hash[51] is the
    // first that should differ.
    for (let i = 0; i <= 50; i++) {
      expect(badHashes[i]).toBe(goodHashes[i]);
    }
    expect(badHashes[51]).not.toBe(goodHashes[51]);
  });

  it('replay round-trip: rerunning a recorded log reaches the same final hash', () => {
    // Effectively the same property as "two runs match," but framed as
    // the replay contract: an input log + seed deterministically
    // reconstructs a final state. This is the property that makes
    // shareable replays viable.
    const frames = scriptedMatch(500);
    const liveRun = runMatch(defaultSpec(), frames);
    const replayRun = runMatch(defaultSpec(), frames);
    expect(replayRun.at(-1)).toBe(liveRun.at(-1));
  });

  it('hash is sensitive to entity position (sanity: distinct ticks differ)', () => {
    // If hashes never changed across ticks, the test above would still
    // pass trivially. This guards against that degenerate case by
    // confirming the system actually evolves: at least one mid-match
    // hash differs from the tick-0 hash.
    const frames = scriptedMatch(50);
    const hashes = runMatch(defaultSpec(), frames);
    const distinct = new Set(hashes);
    expect(distinct.size).toBeGreaterThan(5);
  });

  it('worker actually harvests and deposits energy over a full match', () => {
    // Cheap end-to-end functional check: after enough ticks, faction 0's
    // energy should be > 0 because the worker reached the node, harvested,
    // returned, and deposited. If this fails the sim is broken in some
    // way that the hash-equality tests can't detect (deterministic but
    // wrong).
    const frames = scriptedMatch(500);
    const sim = new Sim(defaultSpec());
    for (const f of frames) sim.step(f);
    expect(sim.state.factions[0].energy).toBeGreaterThan(0);
  });
});
