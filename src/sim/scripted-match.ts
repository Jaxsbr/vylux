// Reusable test fixtures: scripted 1v1 matches for the determinism gate.
//
// Lives in src/sim/ rather than the test file so the same generators
// drive the in-process Vitest gate, the cross-OS golden file
// regeneration, and (later) the standalone CLI harness. Anyone consuming
// this module is asking the same question: "is this sim deterministic on
// my machine?" — and they all need to ask it the same way.
//
// If you change anything in this module, the golden hash files will go
// stale. Re-record them via:
//
//   RECORD_GOLDEN=1 npm test
//
// before committing.

import { CommandKind, type InputFrame } from './commands';
import { Sim } from './sim';
import type { InitialMatchSpec } from './state';

// ---------------------------------------------------------------------------
// Harvest scenario — Phase 0 fixture.
//
// Spawns one worker per faction at tick 0, points each at a node on tick 1,
// then runs the harvest/return loop forever.
// ---------------------------------------------------------------------------

export const SCRIPTED_MATCH_SPEC: InitialMatchSpec = {
  seed: 42,
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

export function buildScriptedFrames(durationTicks: number): InputFrame[] {
  const frames: InputFrame[] = [];
  for (let t = 0; t < durationTicks; t++) {
    if (t === 0) {
      frames.push({
        tick: 0,
        commands: [
          { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 2, y: 2 },
          { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 1, x: 18, y: 18 },
        ],
      });
    } else if (t === 1) {
      // Worker IDs are 4 and 5: nodes occupy 1..3, then the two workers
      // are spawned in faction order at tick 0 → IDs 4 and 5.
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

export function runScriptedMatch(durationTicks: number): string[] {
  const sim = new Sim(SCRIPTED_MATCH_SPEC);
  const frames = buildScriptedFrames(durationTicks);
  return collectHashes(sim, frames);
}

// ---------------------------------------------------------------------------
// Combat scenario — Phase 1.0 fixture.
//
// One defender (faction 0) and one raider (faction 1) spawn close enough
// that the raider walks into combat range within seconds, fires, takes
// fire, and one of them dies. Validates that combat tick logic, range
// checks, cooldowns, damage, and death all hash deterministically.
// ---------------------------------------------------------------------------

export const COMBAT_MATCH_SPEC: InitialMatchSpec = {
  seed: 7,
  hqs: {
    faction0: { x: 5, y: 10 },
    faction1: { x: 15, y: 10 },
  },
  nodes: [],
};

export function buildCombatFrames(durationTicks: number): InputFrame[] {
  const frames: InputFrame[] = [];
  for (let t = 0; t < durationTicks; t++) {
    if (t === 0) {
      // Defender stationed in front of faction-0 HQ; raider spawned
      // close enough to its target HQ that the marching raider crosses
      // into defender range mid-match.
      frames.push({
        tick: 0,
        commands: [
          { kind: CommandKind.SpawnUnit, unitKind: 'defender', faction: 0, x: 8, y: 10 },
          { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 1, x: 13, y: 10 },
        ],
      });
    } else {
      frames.push({ tick: t, commands: [] });
    }
  }
  return frames;
}

export function runCombatMatch(durationTicks: number): string[] {
  const sim = new Sim(COMBAT_MATCH_SPEC);
  const frames = buildCombatFrames(durationTicks);
  return collectHashes(sim, frames);
}

// ---------------------------------------------------------------------------

function collectHashes(sim: Sim, frames: InputFrame[]): string[] {
  const hashes: string[] = [];
  hashes.push(sim.stateHash());
  for (const frame of frames) {
    sim.step(frame);
    hashes.push(sim.stateHash());
  }
  return hashes;
}
