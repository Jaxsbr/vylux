// TrainUnit + AI determinism for Phase 1.1.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { tickAi } from './ai';
import { UNIT_STATS } from './units-config';
import type { InitialMatchSpec } from './state';

const TRAIN_SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
  nodes: [],
  initialEnergy: 1000,
};

describe('Sim — training', () => {
  it('TrainUnit deducts energy and spawns at HQ', () => {
    const sim = new Sim(TRAIN_SPEC);
    const before = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    const after = sim.state.factions[0].energy;
    expect(after).toBe(before - UNIT_STATS.worker.trainCost);

    const trained = sim.state.units.find((u) => u.kind === 'worker' && u.faction === 0);
    expect(trained).toBeTruthy();
    expect(trained!.x).toBe(sim.state.factions[0].hqX);
    expect(trained!.y).toBe(sim.state.factions[0].hqY);
  });

  it('TrainUnit silently rejects when underfunded', () => {
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 10 });
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    // No unit trained, energy unchanged (10 in Q16.16 = 10 * 65536).
    expect(sim.state.units.length).toBe(0);
    expect(sim.state.factions[0].energy).toBe(10 * 65536);
  });

  it('TrainUnit accumulates spawns over multiple ticks', () => {
    const sim = new Sim(TRAIN_SPEC);
    for (let t = 0; t < 5; t++) {
      sim.step({
        tick: t,
        commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
      });
    }
    const owned = sim.state.units.filter((u) => u.faction === 0 && u.alive);
    expect(owned).toHaveLength(5);
  });
});

describe('Sim — AI', () => {
  it('AI tick is pure: same state + faction → same commands', () => {
    const sim = new Sim(TRAIN_SPEC);
    const a = tickAi(sim.state, 0);
    const b = tickAi(sim.state, 0);
    expect(a).toEqual(b);
  });

  it('AI emits no commands between decision intervals', () => {
    const sim = new Sim(TRAIN_SPEC);
    // Run one tick to bump state.tick from 0 to 1.
    sim.step({ tick: 0, commands: [] });
    expect(sim.state.tick).toBe(1);
    expect(tickAi(sim.state, 0)).toEqual([]);
  });

  it('AI builds workers first, then defenders, then raiders', () => {
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 10000 });
    const seen: string[] = [];
    for (let t = 0; t < 200; t++) {
      const commands = tickAi(sim.state, 0);
      for (const c of commands) {
        if (c.kind === CommandKind.TrainUnit) seen.push(c.unitKind);
      }
      sim.step({ tick: t, commands });
    }
    // First few trains are workers, then defenders, then raiders.
    expect(seen[0]).toBe('worker');
    const workerEnd = seen.findIndex((k) => k !== 'worker');
    const defenderEnd = seen.findIndex((k, i) => i >= workerEnd && k !== 'defender');
    expect(workerEnd).toBeGreaterThanOrEqual(4); // at least WORKER_TARGET workers
    expect(seen[workerEnd]).toBe('defender');
    expect(seen[defenderEnd]).toBe('raider');
  });

  it('two AI runs of the same match produce identical hash sequences', () => {
    // Mini AI-vs-AI determinism check that doesn't depend on the
    // committed golden fixture (lets us catch AI nondeterminism even
    // before the fixture is regenerated).
    function run(): string[] {
      const sim = new Sim(TRAIN_SPEC);
      const hashes: string[] = [sim.stateHash()];
      for (let t = 0; t < 300; t++) {
        const cmds = [...tickAi(sim.state, 0), ...tickAi(sim.state, 1)];
        sim.step({ tick: t, commands: cmds });
        hashes.push(sim.stateHash());
      }
      return hashes;
    }
    expect(run()).toEqual(run());
  });
});
