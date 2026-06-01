// Win condition + match-end determinism.
//
// Phase A surface: the only paths to a winner are HQ destruction (an
// HQ's hqHp drops to 0) and Resign. Combat units are out of the active
// sim (Phase D will reintroduce them via the new tech tree), so the HQ-
// destruction tests drive HP to 0 by direct state mutation rather than
// through a combat scenario — the goal here is to validate checkWinner +
// the past-end freeze contract, not the combat pipeline.
//
// Pre-Phase-D scored match (2026-05-28): spec.matchLengthTicks opts the
// match into a timed end + field-exhaustion end with a deterministic
// score-based winner. The classic HQ / resign behavior is preserved when
// the spec leaves matchLengthTicks unset — verified below.

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

// Scored / timed match — opt-in via spec.matchLengthTicks. Verifies the
// new end paths AND that the existing HQ-destruction / Resign flow still
// works alongside them (HQ check still takes priority over the timer).
describe('Sim — scored match (timed end + field exhaustion)', () => {
  it('classic spec (matchLengthTicks unset) never sets a winner from the clock', () => {
    // BASIC_SPEC has no matchLengthTicks — stepping past any number of
    // ticks must NOT set a winner. Guards every existing fixture from
    // accidentally tripping the new gate.
    const sim = new Sim(BASIC_SPEC);
    for (let t = 0; t < 100; t++) sim.step({ tick: t, commands: [] });
    expect(sim.state.winner).toBe(null);
  });

  it('timed end awards the win to the higher score', () => {
    // Pre-load faction 0 with cumulative harvest so its score is higher
    // when the timer expires. matchLengthTicks=3 means the timer trips
    // at the call that processes tick 2 (pre-increment), so we step
    // ticks 0, 1, 2 and assert the winner after.
    const sim = new Sim({ ...BASIC_SPEC, matchLengthTicks: 3 });
    sim.state.factions[0].energyHarvested = fromInt(500);
    sim.state.factions[1].energyHarvested = fromInt(120);
    sim.step({ tick: 0, commands: [] });
    sim.step({ tick: 1, commands: [] });
    expect(sim.state.winner).toBe(null);
    sim.step({ tick: 2, commands: [] });
    expect(sim.state.winner).toBe(0);
  });

  it('timed end ties break deterministically — higher hqHp wins', () => {
    // Equal score (0/0 harvest, no units, no structures). Tie-break falls
    // through to hqHp; bias faction 1's HQ slightly higher → faction 1.
    const sim = new Sim({ ...BASIC_SPEC, matchLengthTicks: 2, hqMaxHp: 100 });
    sim.state.factions[1].hqHp = fromInt(200);
    sim.step({ tick: 0, commands: [] });
    sim.step({ tick: 1, commands: [] });
    expect(sim.state.winner).toBe(1);
  });

  it('HQ destruction still wins outright before the timer', () => {
    // Even with matchLengthTicks set, HQ destruction is the canonical win
    // path and must beat the timer (HQ rung in checkWinner is first).
    const sim = new Sim({ ...BASIC_SPEC, matchLengthTicks: 100 });
    sim.state.factions[1].hqHp = fromInt(0);
    sim.step({ tick: 0, commands: [] });
    expect(sim.state.winner).toBe(0);
  });

  it('field exhaustion ends the match early on score', () => {
    // One dead node + no carrying units = "field exhausted" → scored end
    // fires BEFORE matchLengthTicks. Build the spec with one node (so it
    // counts) then immediately mark it dead via state mutation (avoids
    // running the full harvest pipeline). The higher-harvest faction wins.
    const sim = new Sim({
      ...BASIC_SPEC,
      nodes: [{ x: 10, y: 10, amount: 100 }],
      matchLengthTicks: 1000, // huge — timer should NOT fire
    });
    sim.state.nodes[0].alive = false;
    sim.state.factions[0].energyHarvested = fromInt(50);
    sim.state.factions[1].energyHarvested = fromInt(20);
    sim.step({ tick: 0, commands: [] });
    expect(sim.state.winner).toBe(0);
    expect(sim.state.tick).toBe(1); // tick incremented once, then frozen
  });

  it('past-end replays after a timed win stay deterministic', () => {
    function run(): string {
      const sim = new Sim({ ...BASIC_SPEC, matchLengthTicks: 2 });
      sim.state.factions[0].energyHarvested = fromInt(100);
      for (let t = 0; t < 50; t++) sim.step({ tick: t, commands: [] });
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
