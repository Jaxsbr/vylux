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

import { tickAi } from './ai';
import { CommandKind, type Command, type InputFrame } from './commands';
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
// AI-vs-AI scenario — Phase 1.1 fixture.
//
// Both factions are driven by the scripted AI in src/sim/ai.ts. Each
// faction starts with enough energy to train two workers immediately;
// after that the AI keeps the build order alive with harvest income.
// Runs long enough that workers, defenders, and raiders all spawn,
// raiders march, and combat happens organically.
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
    // Phase 3.5: a colour node per faction. Without these the AI
    // can't build past its initialColor pre-fund and the determinism
    // gate degenerates into "no AI activity for 3000 ticks." Placed
    // near each HQ for an easy harvest cycle.
    { x: 5, y: 5, energy: 100, kind: 'blue' },
    { x: 15, y: 15, energy: 100, kind: 'red' },
  ],
  initialEnergy: 100,
  initialColor: 100,
};

// AI-driven match: both factions get their commands generated from
// `tickAi` each tick, no scripted human input.
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
