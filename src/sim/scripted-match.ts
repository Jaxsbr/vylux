// Reusable test fixtures: scripted matches for the determinism gate.
//
// Lives in src/sim/ rather than the test file so the same generators
// drive the in-process Vitest gate, the cross-OS golden file
// regeneration, and the standalone CLI harness. Anyone consuming this
// module is asking the same question: "is this sim deterministic on my
// machine?" — and they all need to ask it the same way.
//
// If you change anything in this module, the golden hash files will go
// stale. Re-record them via:
//
//   RECORD_GOLDEN=1 npm test
//
// before committing.

import { tickAi } from './ai';
import { CommandKind, type Command, type InputFrame } from './commands';
import { Sim } from './sim';
import type { InitialMatchSpec } from './state';

// ---------------------------------------------------------------------------
// Harvest scenario.
//
// Trains one worker per faction at tick 0, points each at a node on tick 1,
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
  // Pre-fund energy so each faction can train its bootstrap worker on tick 0
  // before any harvest income arrives.
  initialEnergy: 100,
};

export function buildScriptedFrames(durationTicks: number): InputFrame[] {
  const frames: InputFrame[] = [];
  for (let t = 0; t < durationTicks; t++) {
    if (t === 0) {
      frames.push({
        tick: 0,
        commands: [
          { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 2, y: 2 },
          { kind: CommandKind.TrainUnit, faction: 1, unitKind: 'worker', x: 18, y: 18 },
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
// AI-vs-AI scenario.
//
// Both factions are driven by the scripted AI in src/sim/ai.ts. Each
// faction starts with enough energy to train its first worker; after that
// the AI keeps the build order alive with harvest income.
// ---------------------------------------------------------------------------

export const AI_VS_AI_SPEC: InitialMatchSpec = {
  seed: 99,
  hqs: {
    faction0: { x: 3, y: 3 },
    faction1: { x: 17, y: 17 },
  },
  nodes: [
    { x: 6, y: 6, energy: 200 },
    { x: 14, y: 14, energy: 200 },
    { x: 10, y: 10, energy: 200 },
    { x: 6, y: 14, energy: 200 },
    { x: 14, y: 6, energy: 200 },
  ],
  initialEnergy: 100,
};

export function runAiVsAiMatch(durationTicks: number): string[] {
  const sim = new Sim(AI_VS_AI_SPEC);
  const hashes: string[] = [];
  hashes.push(sim.stateHash());
  for (let t = 0; t < durationTicks; t++) {
    const aiCommands: Command[] = [
      ...tickAi(sim.state, 0),
      ...tickAi(sim.state, 1),
    ];
    sim.step({ tick: t, commands: aiCommands });
    hashes.push(sim.stateHash());
  }
  return hashes;
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
