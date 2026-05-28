// Score helpers + deposit increment.
//
// Verifies (a) the cumulative `energyHarvested` counter actually advances
// at the deposit site (not just somewhere — the canonical site in
// step.ts, observed via running a real harvest cycle), and (b) the
// scoreBreakdown formula matches the documented `harvested + workers×10
// + structures×30`. Tested without running a full match — we mutate
// state to set up exactly the conditions we want, since the formula is
// pure over state.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { fromInt, toInt } from './fixed';
import {
  scoreBreakdown,
  matchScore,
  decideScoreWinner,
  SCORE_WORKER_BONUS,
  SCORE_STRUCTURE_BONUS,
} from './score';
import type { InitialMatchSpec } from './state';

// HQs sit at adjacent tiles so the trained worker reaches the node and
// gets back to deposit quickly inside the test budget. Faction 1 stays
// passive (no commands).
const HARVEST_SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 2, y: 2 }, faction1: { x: 18, y: 18 } },
  nodes: [{ x: 4, y: 2, energy: 200 }],
  initialEnergy: 200,
};

describe('Sim — energyHarvested deposit increment', () => {
  it('starts at 0 for both factions', () => {
    const sim = new Sim(HARVEST_SPEC);
    expect(sim.state.factions[0].energyHarvested).toBe(0);
    expect(sim.state.factions[1].energyHarvested).toBe(0);
  });

  it('advances at the deposit site after a full harvest cycle', () => {
    // Train a worker on tick 0; once it spawns (40 ticks later) it idles
    // until assigned. Assign at tick 45 (post-spawn) and step long enough
    // for a full move → harvest → return → deposit cycle. The exact
    // amount is product of WORKER_CAPACITY + HARVEST_AMOUNT clamps; we
    // assert the counter MOVED (not its exact value) — that's enough to
    // catch a regression that wires the increment to the wrong site or
    // forgets it altogether.
    const sim = new Sim(HARVEST_SPEC);
    const before = sim.state.factions[0].energyHarvested;

    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 2, y: 2 }],
    });
    for (let t = 1; t < 45; t++) sim.step({ tick: t, commands: [] });
    // Worker should have spawned by tick 40 — assign it to the node.
    const w = sim.state.units.find((u) => u.alive && u.faction === 0);
    expect(w).toBeDefined();
    sim.step({
      tick: 45,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w!.id, nodeId: 1 }],
    });
    // 300 ticks is well past one full harvest cycle (~50–80 ticks at
    // these stats). Generous so the test isn't tuned to exact timings.
    for (let t = 46; t < 350; t++) sim.step({ tick: t, commands: [] });

    expect(sim.state.factions[0].energyHarvested).toBeGreaterThan(before);
    // Faction 1 stayed passive — counter must not move.
    expect(sim.state.factions[1].energyHarvested).toBe(0);
  });
});

describe('scoreBreakdown — formula', () => {
  it('= harvested(floored) + workers×10 + structures×30', () => {
    // Set up a fresh state, then mutate it to a known shape: faction 0
    // has 250 harvested, 3 alive workers, 2 operational pods + 1 still
    // building (the building pod should NOT count toward the structure
    // bonus).
    const sim = new Sim(HARVEST_SPEC);
    sim.state.factions[0].energyHarvested = fromInt(250);
    // Synthesise alive workers at faction 0.
    for (let i = 0; i < 3; i++) {
      sim.state.units.push({
        id: 100 + i,
        alive: true,
        faction: 0,
        kind: 'worker',
        x: fromInt(2),
        y: fromInt(2),
        hp: fromInt(30),
        attackCooldown: 0,
        moveTarget: null,
        phase: 'idle',
        targetNodeId: 0,
        carrying: 0,
        carriedKind: 'energy',
        harvestTicksRemaining: 0,
        targetNodeSlot: 0,
        charge: 10,
        maxCharge: 10,
        targetStructureId: 0,
        chargeTargetStructureId: 0,
        chargeTicksAccrued: 0,
        previousNodeId: 0,
        chargeSlot: 0,
        path: [],
        pathGoalTile: -1,
        idleTicks: 0,
      });
    }
    // Two operational pods + one still building. Only the operational
    // pair contributes to the structure score.
    sim.state.structures.push({
      id: 200, alive: true, faction: 0, kind: 'workPod',
      x: fromInt(3), y: fromInt(3), hp: fromInt(100), buildTicksRemaining: 0,
    });
    sim.state.structures.push({
      id: 201, alive: true, faction: 0, kind: 'workPod',
      x: fromInt(4), y: fromInt(4), hp: fromInt(100), buildTicksRemaining: 0,
    });
    sim.state.structures.push({
      id: 202, alive: true, faction: 0, kind: 'workPod',
      x: fromInt(5), y: fromInt(5), hp: fromInt(100), buildTicksRemaining: 5,
    });

    const sb = scoreBreakdown(sim.state, 0);
    expect(sb.harvested).toBe(250);
    expect(sb.workers).toBe(3);
    expect(sb.structures).toBe(2);
    expect(sb.total).toBe(250 + 3 * SCORE_WORKER_BONUS + 2 * SCORE_STRUCTURE_BONUS);
    expect(matchScore(sim.state, 0)).toBe(sb.total);
  });

  it('floors the Fixed harvest total deterministically', () => {
    const sim = new Sim(HARVEST_SPEC);
    // 5.5 in Q16.16: half-units do NOT round; toInt floors.
    sim.state.factions[0].energyHarvested = fromInt(5) + (1 << 15);
    expect(scoreBreakdown(sim.state, 0).harvested).toBe(toInt(sim.state.factions[0].energyHarvested));
  });
});

describe('decideScoreWinner — deterministic tie-break', () => {
  it('higher total wins', () => {
    const sim = new Sim(HARVEST_SPEC);
    sim.state.factions[0].energyHarvested = fromInt(100);
    sim.state.factions[1].energyHarvested = fromInt(50);
    expect(decideScoreWinner(sim.state)).toBe(0);
  });

  it('equal score → falls through to higher hqHp', () => {
    const sim = new Sim(HARVEST_SPEC);
    sim.state.factions[1].hqHp = fromInt(999);
    expect(decideScoreWinner(sim.state)).toBe(1);
  });

  it('all-equal → faction 0 wins (final deterministic rung)', () => {
    const sim = new Sim(HARVEST_SPEC);
    expect(decideScoreWinner(sim.state)).toBe(0);
  });
});
