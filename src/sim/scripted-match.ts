// Reusable test fixture: a scripted 1v1 match for the determinism gate.
//
// Lives in src/sim/ rather than the test file so the same scripted-match
// generator can drive the in-process Vitest gate, the cross-OS golden file
// regeneration, and (later) the standalone CLI harness. Anyone consuming
// this module is asking the same question: "is this sim deterministic on
// my machine?" — and they all need to ask it the same way.
//
// If you change anything in this module, the golden hash file will go
// stale. Re-record it via:
//
//   RECORD_GOLDEN=1 npm test
//
// before committing.

import { CommandKind, type InputFrame } from './commands';
import { Sim } from './sim';
import type { InitialMatchSpec } from './state';

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
          { kind: CommandKind.SpawnWorker, faction: 0, x: 2, y: 2 },
          { kind: CommandKind.SpawnWorker, faction: 1, x: 18, y: 18 },
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
  const hashes: string[] = [];
  hashes.push(sim.stateHash());
  for (const frame of frames) {
    sim.step(frame);
    hashes.push(sim.stateHash());
  }
  return hashes;
}
