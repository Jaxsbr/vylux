// Win condition + match-end determinism.
//
// Phase A surface: the only paths to a winner are HQ destruction (an
// HQ's hqHp drops to 0) and Resign. Combat units are out of the active
// sim (Phase D will reintroduce them via the new tech tree), so the HQ-
// destruction tests drive HP to 0 by direct state mutation rather than
// through a combat scenario — the goal here is to validate checkWinner +
// the past-end freeze contract, not the combat pipeline.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { fromInt } from './fixed';
import type { InitialMatchSpec } from './state';

const BASIC_SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 10 }, faction1: { x: 17, y: 10 } },
  nodes: [],
  initialEnergy: 1000,
};

describe('Sim — win condition: HQ destruction', () => {
  it('faction-1 HQ at 0 awards win to faction 0', () => {
    const sim = new Sim(BASIC_SPEC);
    sim.state.factions[1].hqHp = fromInt(0);
    sim.step({ tick: 0, commands: [] });
    expect(sim.state.winner).toBe(0);
  });

  it('faction-0 HQ at 0 awards win to faction 1', () => {
    const sim = new Sim(BASIC_SPEC);
    sim.state.factions[0].hqHp = fromInt(0);
    sim.step({ tick: 0, commands: [] });
    expect(sim.state.winner).toBe(1);
  });
});

describe('Sim — match-end behaviour', () => {
  it('sim is frozen after a winner is set: no further state mutation', () => {
    const sim = new Sim(BASIC_SPEC);
    sim.step({ tick: 0, commands: [{ kind: CommandKind.Resign, faction: 0 }] });
    expect(sim.state.winner).toBe(1);
    const winnerAtEnd = sim.state.winner;
    const factionsSnapshot = JSON.parse(JSON.stringify(sim.state.factions));
    const unitsSnapshot = JSON.parse(JSON.stringify(sim.state.units));
    const startTick = sim.state.tick;
    for (let t = startTick; t < startTick + 50; t++) {
      sim.step({ tick: t, commands: [] });
    }
    expect(sim.state.winner).toBe(winnerAtEnd);
    expect(sim.state.factions).toEqual(factionsSnapshot);
    expect(sim.state.units).toEqual(unitsSnapshot);
  });

  it('past-end replays are deterministic', () => {
    function run(): string {
      const sim = new Sim(BASIC_SPEC);
      sim.step({ tick: 0, commands: [{ kind: CommandKind.Resign, faction: 0 }] });
      for (let t = 1; t < 500; t++) sim.step({ tick: t, commands: [] });
      return sim.stateHash();
    }
    expect(run()).toBe(run());
  });
});

describe('Sim — resign command', () => {
  it('faction 0 resigns → faction 1 wins', () => {
    const sim = new Sim(BASIC_SPEC);
    sim.step({ tick: 0, commands: [{ kind: CommandKind.Resign, faction: 0 }] });
    expect(sim.state.winner).toBe(1);
  });

  it('faction 1 resigns → faction 0 wins', () => {
    const sim = new Sim(BASIC_SPEC);
    sim.step({ tick: 0, commands: [{ kind: CommandKind.Resign, faction: 1 }] });
    expect(sim.state.winner).toBe(0);
  });

  it('resign is a no-op once a winner is already set', () => {
    const sim = new Sim(BASIC_SPEC);
    sim.step({ tick: 0, commands: [{ kind: CommandKind.Resign, faction: 0 }] });
    expect(sim.state.winner).toBe(1);
    sim.step({ tick: 1, commands: [{ kind: CommandKind.Resign, faction: 1 }] });
    expect(sim.state.winner).toBe(1);
  });
});
