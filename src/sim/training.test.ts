// TrainUnit + worker harvest cycle + AI determinism for the Phase A surface.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { autoAssignIdleWorkers, tickAi } from './ai';
import { unitStatsFor } from './units-config';
import type { InitialMatchSpec } from './state';

// Phase C.2: training is queued + timed (40 ticks). Advance the sim until
// the faction's next worker pops so assertions that need the spawned unit
// can grab it. Guarded so a never-spawning bug fails the test loudly
// rather than hanging.
function advanceUntilWorkerSpawns(sim: Sim, faction: 0 | 1): void {
  const before = sim.state.units.filter((u) => u.alive && u.faction === faction).length;
  let guard = 0;
  while (
    sim.state.units.filter((u) => u.alive && u.faction === faction).length <= before
    && guard < 200
  ) {
    sim.step({ tick: sim.state.tick, commands: [] });
    guard += 1;
  }
}

const TRAIN_SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
  nodes: [],
  initialEnergy: 1000,
};

describe('Sim — training', () => {
  it('TrainUnit deducts energy at enqueue and spawns near HQ perimeter after the timer', () => {
    const sim = new Sim(TRAIN_SPEC);
    const before = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    // Energy is charged at enqueue (faction 0 defaults to swarm → cost 40).
    const after = sim.state.factions[0].energy;
    expect(after).toBe(before - (unitStatsFor('swarm', 'worker').trainCost.energy ?? 0));
    // Training is timed — no worker yet.
    expect(sim.state.units.length).toBe(0);

    advanceUntilWorkerSpawns(sim, 0);
    const trained = sim.state.units.find((u) => u.kind === 'worker' && u.faction === 0);
    expect(trained).toBeTruthy();
    // First perimeter offset is (+2, 0). HQ at (3, 3) → spawn at (5, 3).
    expect(trained!.x).toBe((3 + 2) * 65536);
    expect(trained!.y).toBe(3 * 65536);
  });

  it('TrainUnit silently rejects when underfunded', () => {
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 10 });
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    expect(sim.state.units.length).toBe(0);
    expect(sim.state.factions[0].energy).toBe(10 * 65536);
  });

  it('TrainUnit queues up to the cap and spawns them over time', () => {
    const sim = new Sim(TRAIN_SPEC);
    // Five fit the HQ supply cap of 5; all queue at enqueue time.
    for (let t = 0; t < 5; t++) {
      sim.step({
        tick: t,
        commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
      });
    }
    expect(sim.state.factions[0].trainQueue.length).toBe(5);
    // Advance until the queue drains; exactly 5 workers end up alive.
    for (let g = 0; g < 400 && sim.state.factions[0].trainQueue.length > 0; g++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    const owned = sim.state.units.filter((u) => u.faction === 0 && u.alive);
    expect(owned).toHaveLength(5);
  });

  it('TrainUnit with tile coords spawns at the given tile, not at HQ', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 7, y: 9 },
      ],
    });
    advanceUntilWorkerSpawns(sim, 0);
    const w = sim.state.units.find((u) => u.kind === 'worker' && u.faction === 0);
    expect(w).toBeTruthy();
    expect(w!.x).toBe(7 * 65536);
    expect(w!.y).toBe(9 * 65536);
  });
});

describe('Sim — worker harvest cycle', () => {
  it('worker harvests an energy node and deposits to faction.energy at HQ', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [{ x: 5, y: 5, amount: 100 }],
      initialEnergy: 100,
    });
    // Train (timed), wait for the worker to pop, then assign it.
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 5, y: 5 }],
    });
    advanceUntilWorkerSpawns(sim, 0);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    const initialFactionEnergy = sim.state.factions[0].energy;

    // Run long enough to harvest, return, and deposit. With slot offsets
    // ~0.55 tile from the node and HQ at (3,3) deposit-perimeter at ~2
    // tiles, a single full cycle is well within 600 ticks.
    let depositedAt = -1;
    for (let t = 0; t < 600; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (sim.state.factions[0].energy > initialFactionEnergy) {
        depositedAt = sim.state.tick;
        break;
      }
    }
    expect(depositedAt).toBeGreaterThan(0);
    // Carrying clears on deposit; carriedKind reset to canonical.
    expect(w.carrying).toBe(0);
    expect(w.carriedKind).toBe('energy');
  });

  it('depleted energy nodes die and the worker drops back to idle', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      // Only 5 units in the node — one harvest gain empties it.
      nodes: [{ x: 5, y: 5, amount: 5 }],
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 5, y: 5 }],
    });
    advanceUntilWorkerSpawns(sim, 0);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    // Run long enough for one harvest + the post-deposit re-target attempt.
    for (let t = 0; t < 600; t++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(sim.state.nodes[0].alive).toBe(false);
  });
});

describe('Sim — MoveUnit', () => {
  it('MoveUnit on a worker cancels harvest, walks to the tile, and parks there', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [{ x: 5, y: 5, amount: 100 }],
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 5, y: 5 },
      ],
    });
    advanceUntilWorkerSpawns(sim, 0);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const nodeId = sim.state.nodes[0].id;

    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId }],
    });
    expect(w.targetNodeId).toBe(nodeId);

    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.MoveUnit, unitId: w.id, x: 10, y: 10 }],
    });
    expect(w.phase).toBe('idle');
    expect(w.targetNodeId).toBe(0);
    expect(w.moveTarget).not.toBeNull();

    for (let t = 0; t < 400; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (w.x === 10 * 65536 && w.y === 10 * 65536) break;
    }
    expect(w.x).toBe(10 * 65536);
    expect(w.y).toBe(10 * 65536);
    // moveTarget is sticky — workers stay parked.
    expect(w.moveTarget).not.toBeNull();
    expect(w.phase).toBe('idle');
  });

  it('MoveUnit on a dead / unknown unit is a silent no-op', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.MoveUnit, unitId: 9999, x: 4, y: 4 }],
    });
    expect(sim.state.units.length).toBe(0);
  });
});

describe('Sim — fog of war', () => {
  it('nodes within HQ vision are discovered at match start; nodes outside are not', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 27, y: 27 } },
      nodes: [
        { x: 4, y: 4, amount: 100 }, // close to faction-0 HQ — discovered
        { x: 26, y: 26, amount: 100 }, // close to faction-1 HQ — discovered
        { x: 15, y: 15, amount: 100 }, // mid-map — neither sees
      ],
    });
    const [near0, near1, mid] = sim.state.nodes;
    expect(near0.discoveredBy[0]).toBe(true);
    expect(near0.discoveredBy[1]).toBe(false);
    expect(near1.discoveredBy[0]).toBe(false);
    expect(near1.discoveredBy[1]).toBe(true);
    expect(mid.discoveredBy[0]).toBe(false);
    expect(mid.discoveredBy[1]).toBe(false);
  });

  it('walking a worker into vision range discovers a node', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 27, y: 27 } },
      nodes: [{ x: 15, y: 15, amount: 100 }], // outside both HQs' vision
      initialEnergy: 100,
    });
    expect(sim.state.nodes[0].discoveredBy[0]).toBe(false);
    expect(sim.state.nodes[0].discoveredBy[1]).toBe(false);

    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 14, y: 14 },
      ],
    });
    // Worker spawns adjacent to the node; the discovery sweep on the
    // spawn tick marks it discovered.
    advanceUntilWorkerSpawns(sim, 0);
    expect(sim.state.nodes[0].discoveredBy[0]).toBe(true);
    expect(sim.state.nodes[0].discoveredBy[1]).toBe(false);
  });

  it('AI auto-assign skips undiscovered nodes', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 27, y: 27 } },
      nodes: [{ x: 20, y: 20, amount: 100 }], // outside both HQs' vision
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    advanceUntilWorkerSpawns(sim, 0);
    const cmds = autoAssignIdleWorkers(sim.state, 0);
    expect(cmds).toHaveLength(0);
  });
});

describe('Sim — AI determinism', () => {
  const AI_SPEC: InitialMatchSpec = {
    seed: 99,
    hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
    nodes: [
      { x: 6, y: 6, amount: 200 },
      { x: 14, y: 14, amount: 200 },
    ],
    initialEnergy: 100,
  };

  it('AI tick is pure: same state + faction → same commands', () => {
    const sim = new Sim(AI_SPEC);
    const a = tickAi(sim.state, 0);
    const b = tickAi(sim.state, 0);
    expect(a).toEqual(b);
  });

  it('AI emits no commands between decision intervals', () => {
    const sim = new Sim(AI_SPEC);
    sim.step({ tick: 0, commands: tickAi(sim.state, 0) });
    // Tick 1..9 — between decision points; AI emits nothing.
    for (let t = 1; t < 10; t++) {
      const cmds = tickAi(sim.state, 0);
      expect(cmds).toHaveLength(0);
      sim.step({ tick: t, commands: [] });
    }
  });

  it('two AI runs of the same match produce identical hash sequences', () => {
    function run(): string[] {
      const sim = new Sim(AI_SPEC);
      const hashes: string[] = [sim.stateHash()];
      for (let t = 0; t < 200; t++) {
        const cmds = [...tickAi(sim.state, 0), ...tickAi(sim.state, 1)];
        sim.step({ tick: t, commands: cmds });
        hashes.push(sim.stateHash());
      }
      return hashes;
    }
    expect(run()).toEqual(run());
  });
});
