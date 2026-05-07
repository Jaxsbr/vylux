// Win condition + match-end determinism.
//
// Post-2026-05-07 PvE pivot: HQ destruction is the only win/loss
// condition until sub-phase 3.13 lands wave-survival + scenario
// objective + boss conditions. The previous "kill points" + "points
// threshold" tests were removed alongside the points-threshold sim
// path; what remains exercises HQ destruction, match freeze, and
// past-end determinism — all of which carry forward unchanged.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { tickAi } from './ai';
import { UNIT_STATS } from './units-config';
import type { InitialMatchSpec } from './state';

const BASIC_SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 10 }, faction1: { x: 17, y: 10 } },
  nodes: [],
  initialEnergy: 1000,
};

describe('Sim — win condition: HQ destruction', () => {
  it('raider attacks enemy HQ when no enemy unit is in range', () => {
    const sim = new Sim({ ...BASIC_SPEC, hqMaxHp: 50 });
    const startHp = sim.state.factions[1].hqHp; // capture BEFORE any step
    // Raider spawned right next to the enemy HQ (at 17,10), no other
    // units. The spawn-step's advance phase fires the first HQ attack
    // immediately because cooldown is 0.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 17, y: 11 },
      ],
    });
    expect(sim.state.factions[1].hqHp).toBeLessThan(startHp);
  });

  it('reducing enemy HQ to 0 awards win to attacker', () => {
    const sim = new Sim({ ...BASIC_SPEC, hqMaxHp: 30 }); // 2 raider hits to destroy
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 17, y: 11 },
      ],
    });
    for (let t = 1; t <= 100 && sim.state.winner === null; t++) {
      sim.step({ tick: t, commands: [] });
    }
    expect(sim.state.winner).toBe(0);
    expect(sim.state.factions[1].hqHp).toBe(0);
  });
});

describe('Sim — match-end behaviour', () => {
  it('sim is frozen after a winner is set: no further state mutation', () => {
    const sim = new Sim({ ...BASIC_SPEC, hqMaxHp: 30 });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 17, y: 11 },
      ],
    });
    while (sim.state.winner === null && sim.state.tick < 200) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(sim.state.winner).toBe(0);
    const hashAtEnd = sim.stateHash();
    const winnerAtEnd = sim.state.winner;
    // Run more ticks; tick counter advances and rngState updates, but
    // unit/faction state must stay identical.
    const factionsSnapshot = JSON.parse(JSON.stringify(sim.state.factions));
    const unitsSnapshot = JSON.parse(JSON.stringify(sim.state.units));
    const startTick = sim.state.tick;
    for (let t = startTick; t < startTick + 50; t++) {
      sim.step({ tick: t, commands: [] });
    }
    expect(sim.state.winner).toBe(winnerAtEnd);
    expect(sim.state.factions).toEqual(factionsSnapshot);
    expect(sim.state.units).toEqual(unitsSnapshot);
    // Hash differs (tick + rngState moved) but that's expected and
    // not a regression.
    expect(sim.stateHash()).not.toBe(hashAtEnd);
  });

  it('past-end replays are deterministic', () => {
    function run(): string {
      const sim = new Sim({ ...BASIC_SPEC, hqMaxHp: 30 });
      sim.step({
        tick: 0,
        commands: [
          { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 17, y: 11 },
        ],
      });
      for (let t = 1; t < 500; t++) sim.step({ tick: t, commands: [] });
      return sim.stateHash();
    }
    expect(run()).toBe(run());
  });

  it('AI-vs-AI match makes meaningful progress (HQ damage or winner)', () => {
    // We don't require a winner in N ticks (balance + map geometry
    // determine match length, and they're placeholder numbers right
    // now). We DO require that the system makes progress: HQ damage
    // is taken or a winner emerges — proves the
    // raider→combat→HQ-damage→win-condition pipeline actually flows.
    const sim = new Sim({
      seed: 99,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [
        { x: 6, y: 6, energy: 200 },
        { x: 14, y: 14, energy: 200 },
        { x: 10, y: 10, energy: 200 },
        { x: 6, y: 14, energy: 200 },
        { x: 14, y: 6, energy: 200 },
      ],
      initialEnergy: 5000,
      initialColor: 5000, // Phase 3.5: pre-fund colour generously; this fixture isn't testing the lockout
      hqMaxHp: 100,
    });
    const startHpSum = sim.state.factions[0].hqHp + sim.state.factions[1].hqHp;
    for (let t = 0; t < 4000 && sim.state.winner === null; t++) {
      const cmds = [...tickAi(sim.state, 0), ...tickAi(sim.state, 1)];
      sim.step({ tick: t, commands: cmds });
    }
    const endHpSum = sim.state.factions[0].hqHp + sim.state.factions[1].hqHp;
    // Either an HQ took damage or there's a winner. If neither, the
    // pipeline isn't working.
    const progress = endHpSum < startHpSum || sim.state.winner !== null;
    expect(progress).toBe(true);
  });
});

// Exhaustive type-check: ensure all unit kinds have train costs
// (catches "added a kind, forgot the config" bugs).
describe('Sim — unit-config completeness', () => {
  it('every unit kind has stats', () => {
    const kinds: Array<keyof typeof UNIT_STATS> = ['worker', 'defender', 'raider'];
    for (const k of kinds) {
      expect(UNIT_STATS[k]).toBeDefined();
      expect(UNIT_STATS[k].maxHp).toBeGreaterThan(0);
    }
  });
});
