// Phase C.1 — worker charge, supply cap, work pod build, and the
// "all actions blocked at zero energy" rule.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { fromInt } from './fixed';
import type { InitialMatchSpec } from './state';
import {
  CHARGE_TICKS_PER_UNIT_HQ,
  CHARGE_TICKS_PER_UNIT_POD,
  HQ_SUPPLY_CAP_INITIAL,
  RESEARCH_AUTO_RESUME_COST,
  RESEARCH_AUTO_RESUME_TICKS,
  STRUCTURE_STATS,
  WORK_POD_CAP_BONUS,
  WORKER_DEFAULT_MAX_CHARGE,
} from './units-config';
import { tickAi } from './ai';

const SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 27, y: 27 } },
  nodes: [{ x: 5, y: 5, energy: 1000 }],
  initialEnergy: 10000,
};

function trainWorker(sim: Sim, faction: 0 | 1, x: number, y: number) {
  sim.step({
    tick: sim.state.tick,
    commands: [{ kind: CommandKind.TrainUnit, faction, unitKind: 'worker', x, y }],
  });
}

describe('Sim — worker charge', () => {
  it('fresh worker spawns at maxCharge', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 5, 5);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    expect(w.charge).toBe(WORKER_DEFAULT_MAX_CHARGE);
    expect(w.maxCharge).toBe(WORKER_DEFAULT_MAX_CHARGE);
  });

  it('AssignWorkerToNode drains 1 charge at task start', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 5, 5);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const before = w.charge;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    expect(w.charge).toBe(before - 1);
    expect(w.phase).toBe('movingToNode');
  });

  it('AssignWorkerToNode is silently rejected at charge=0', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 5, 5);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    w.charge = 0;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    expect(w.targetNodeId).toBe(0);
    expect(w.charge).toBe(0);
  });

  it('MoveUnit is silently rejected at charge=0 (per C.1 spec)', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 5, 5);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    w.charge = 0;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.MoveUnit, unitId: w.id, x: 10, y: 10 }],
    });
    expect(w.moveTarget).toBeNull();
  });

  it('MoveUnit is free while charge > 0 (no drain)', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 5, 5);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const before = w.charge;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.MoveUnit, unitId: w.id, x: 10, y: 10 }],
    });
    expect(w.charge).toBe(before);
    expect(w.moveTarget).not.toBeNull();
  });

  it('a depleted post-cycle worker auto-enters walkingToCharge', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 5, 5);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    // Force charge = 1 so the first cycle drains it to 0; the
    // auto-continue branch at end-of-cycle then trips the charge gate.
    w.charge = 1;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    expect(w.charge).toBe(0);
    // Run long enough for the full cycle to complete.
    for (let i = 0; i < 1000 && w.phase !== 'walkingToCharge' && w.phase !== 'charging'; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(['walkingToCharge', 'charging']).toContain(w.phase);
  });

  it('worker recharges fully at a pod (faster than HQ)', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 4, 4);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    // Pre-spawn an operational pod right next to the worker so the
    // charge cycle hits the pod path.
    w.charge = 0;
    w.phase = 'idle';
    // Inject an operational pod at (4, 5) — adjacent to the worker.
    const stats = STRUCTURE_STATS.workPod;
    sim.state.structures.push({
      id: sim.state.nextEntityId++,
      alive: true,
      kind: 'workPod',
      faction: 0,
      x: fromInt(4),
      y: fromInt(5),
      hp: stats.maxHp,
      buildTicksRemaining: 0,
    });

    // Take one step to let maybeEnterChargeMode trigger.
    sim.step({ tick: sim.state.tick, commands: [] });
    expect(['walkingToCharge', 'charging']).toContain(w.phase);

    // Tick until the worker reports full charge.
    const maxCycles = CHARGE_TICKS_PER_UNIT_POD * WORKER_DEFAULT_MAX_CHARGE + 100;
    let cycles = 0;
    while (w.charge < w.maxCharge && cycles < maxCycles) {
      sim.step({ tick: sim.state.tick, commands: [] });
      cycles += 1;
    }
    expect(w.charge).toBe(w.maxCharge);
    expect(w.phase).toBe('idle');
  });

  it('worker falls back to HQ at half the pod rate when no pod exists', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 3, 3);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    // Drop the worker on top of the HQ and zero out charge. With the
    // C.1 slot allocation, the worker needs to walk to its assigned
    // HQ slot point first — let the sim run until it reaches the
    // charging phase, then measure the HQ rate from that moment.
    w.x = sim.state.factions[0].hqX;
    w.y = sim.state.factions[0].hqY;
    w.charge = 0;
    w.phase = 'idle';
    for (let i = 0; i < 1000; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      // Cast to string so the literal-narrowed `w.phase` doesn't
      // collapse the comparison to a no-overlap check.
      if ((w.phase as string) === 'charging') break;
    }
    expect(w.phase).toBe('charging');
    expect(w.chargeTargetStructureId).toBe(0);
    // Worker is now at its slot, charging at the HQ rate. The step
    // that flipped 'walkingToCharge' → 'charging' did NOT run the
    // charging case the same tick (the switch already entered the
    // walking case). So accrued starts at 0 from here; we need
    // CHARGE_TICKS_PER_UNIT_HQ - 1 more ticks for accrued = 39, then
    // one more to land the +1 charge.
    for (let t = 0; t < CHARGE_TICKS_PER_UNIT_HQ - 1; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(w.charge).toBe(0);
    sim.step({ tick: sim.state.tick, commands: [] });
    expect(w.charge).toBe(1);
  });

  it('multiple workers charging at the same pod get distinct slot positions', () => {
    const sim = new Sim(SPEC);
    // Inject an operational pod and three workers near it, all at 0
    // charge. Each should pick a different slot index and end up at
    // a different world position after the slot snap.
    const podId = sim.state.nextEntityId++;
    sim.state.structures.push({
      id: podId,
      alive: true,
      kind: 'workPod',
      faction: 0,
      x: fromInt(10),
      y: fromInt(10),
      hp: STRUCTURE_STATS.workPod.maxHp,
      buildTicksRemaining: 0,
    });
    const workers = [];
    for (let i = 0; i < 3; i++) {
      sim.step({
        tick: sim.state.tick,
        commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 10, y: 10 }],
      });
      const w = sim.state.units[i];
      if (w.kind !== 'worker') throw new Error('expected worker');
      w.charge = 0;
      w.phase = 'idle';
      workers.push(w);
    }
    // Let the sim run until all three workers are charging.
    for (let i = 0; i < 1000; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (workers.every((w) => w.phase === 'charging')) break;
    }
    expect(workers.every((w) => w.phase === 'charging')).toBe(true);
    // Each worker should have picked a unique slot.
    const slots = new Set(workers.map((w) => w.chargeSlot));
    expect(slots.size).toBe(3);
    // And their world positions should differ — slot allocation puts
    // them at different points around the pod.
    const positions = new Set(workers.map((w) => `${w.x},${w.y}`));
    expect(positions.size).toBe(3);
  });

  it('always prefers pod over HQ regardless of HQ being closer', () => {
    // HQ at (3, 3), pod at (15, 15), worker at (4, 4) — much closer to HQ.
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 4, 4);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    w.charge = 0;
    w.phase = 'idle';
    sim.state.structures.push({
      id: sim.state.nextEntityId++,
      alive: true,
      kind: 'workPod',
      faction: 0,
      x: fromInt(15),
      y: fromInt(15),
      hp: STRUCTURE_STATS.workPod.maxHp,
      buildTicksRemaining: 0,
    });
    sim.step({ tick: sim.state.tick, commands: [] });
    expect(w.phase).toBe('walkingToCharge');
    expect(w.chargeTargetStructureId).not.toBe(0); // pod id
  });
});

describe('Sim — supply cap', () => {
  it('HQ alone caps trains at HQ_SUPPLY_CAP_INITIAL', () => {
    const sim = new Sim(SPEC);
    // Train more than the cap — extras get silently rejected.
    for (let i = 0; i < HQ_SUPPLY_CAP_INITIAL + 3; i++) {
      sim.step({
        tick: sim.state.tick,
        commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
      });
    }
    const aliveOwn = sim.state.units.filter((u) => u.alive && u.faction === 0);
    expect(aliveOwn.length).toBe(HQ_SUPPLY_CAP_INITIAL);
  });

  it('each operational work pod raises the cap by WORK_POD_CAP_BONUS', () => {
    const sim = new Sim(SPEC);
    // Two operational pods → cap = 5 + 2*5 = 15.
    sim.state.structures.push(
      {
        id: sim.state.nextEntityId++,
        alive: true,
        kind: 'workPod',
        faction: 0,
        x: fromInt(10),
        y: fromInt(10),
        hp: STRUCTURE_STATS.workPod.maxHp,
        buildTicksRemaining: 0,
      },
      {
        id: sim.state.nextEntityId++,
        alive: true,
        kind: 'workPod',
        faction: 0,
        x: fromInt(12),
        y: fromInt(12),
        hp: STRUCTURE_STATS.workPod.maxHp,
        buildTicksRemaining: 0,
      },
    );
    // Run one tick so recomputeSupplyCaps picks up the pods.
    sim.step({ tick: sim.state.tick, commands: [] });
    expect(sim.state.factions[0].supplyCap).toBe(HQ_SUPPLY_CAP_INITIAL + 2 * WORK_POD_CAP_BONUS);
  });

  it('mid-build pods do not contribute to the cap', () => {
    const sim = new Sim(SPEC);
    sim.state.structures.push({
      id: sim.state.nextEntityId++,
      alive: true,
      kind: 'workPod',
      faction: 0,
      x: fromInt(10),
      y: fromInt(10),
      hp: STRUCTURE_STATS.workPod.maxHp,
      buildTicksRemaining: 15, // still building
    });
    sim.step({ tick: sim.state.tick, commands: [] });
    expect(sim.state.factions[0].supplyCap).toBe(HQ_SUPPLY_CAP_INITIAL);
  });
});

describe('Sim — work pod build flow', () => {
  it('BuildStructureByWorker drains 1 charge + spawns a work pod under construction', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 4, 4);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const startEnergy = sim.state.factions[0].energy;
    const startCharge = w.charge;
    sim.step({
      tick: sim.state.tick,
      commands: [{
        kind: CommandKind.BuildStructureByWorker,
        workerId: w.id,
        structureKind: 'workPod',
        x: 6,
        y: 6,
      }],
    });
    expect(sim.state.factions[0].energy).toBeLessThan(startEnergy);
    expect(w.charge).toBe(startCharge - 1);
    expect(['movingToBuildSite', 'building']).toContain(w.phase);
    expect(sim.state.structures).toHaveLength(1);
    expect(sim.state.structures[0].buildTicksRemaining).toBeGreaterThan(0);
  });

  it('build completes after enough on-site ticks; pod becomes operational', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 6, 6);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    sim.step({
      tick: sim.state.tick,
      commands: [{
        kind: CommandKind.BuildStructureByWorker,
        workerId: w.id,
        structureKind: 'workPod',
        x: 7,
        y: 7,
      }],
    });
    // Step until the structure is operational (buildTicksRemaining = 0).
    for (let i = 0; i < 200 && sim.state.structures[0].buildTicksRemaining > 0; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(sim.state.structures[0].buildTicksRemaining).toBe(0);
    expect(sim.state.structures[0].alive).toBe(true);
  });

  it('BuildStructureByWorker is silently rejected at charge=0', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 4, 4);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    w.charge = 0;
    sim.step({
      tick: sim.state.tick,
      commands: [{
        kind: CommandKind.BuildStructureByWorker,
        workerId: w.id,
        structureKind: 'workPod',
        x: 7,
        y: 7,
      }],
    });
    expect(sim.state.structures).toHaveLength(0);
  });
});

describe('Sim — research + auto-resume', () => {
  function podAt(sim: Sim, faction: 0 | 1, x: number, y: number): number {
    const id = sim.state.nextEntityId++;
    sim.state.structures.push({
      id,
      alive: true,
      kind: 'workPod',
      faction,
      x: fromInt(x),
      y: fromInt(y),
      hp: STRUCTURE_STATS.workPod.maxHp,
      buildTicksRemaining: 0,
    });
    return id;
  }

  it('StartResearchAtPod drains energy + sets the timer', () => {
    const sim = new Sim(SPEC);
    const podId = podAt(sim, 0, 6, 6);
    const before = sim.state.factions[0].energy;
    sim.step({
      tick: sim.state.tick,
      commands: [{
        kind: CommandKind.StartResearchAtPod,
        structureId: podId,
        researchKind: 'autoResume',
      }],
    });
    expect(sim.state.factions[0].energy).toBe(before - RESEARCH_AUTO_RESUME_COST);
    expect(sim.state.factions[0].researchingKind).toBe('autoResume');
    expect(sim.state.factions[0].researchTicksRemaining).toBeGreaterThan(0);
    expect(sim.state.factions[0].autoResumeResearched).toBe(false);
  });

  it('research completes after RESEARCH_AUTO_RESUME_TICKS', () => {
    const sim = new Sim(SPEC);
    const podId = podAt(sim, 0, 6, 6);
    sim.step({
      tick: sim.state.tick,
      commands: [{
        kind: CommandKind.StartResearchAtPod,
        structureId: podId,
        researchKind: 'autoResume',
      }],
    });
    // Step exactly the remaining duration. The first step already
    // ticked once (the start-step ran advanceResearch after the
    // applyCommand set the timer to RESEARCH_AUTO_RESUME_TICKS).
    for (let t = 0; t < RESEARCH_AUTO_RESUME_TICKS - 1; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(sim.state.factions[0].autoResumeResearched).toBe(true);
    expect(sim.state.factions[0].researchingKind).toBeNull();
    expect(sim.state.factions[0].researchTicksRemaining).toBe(0);
  });

  it('cannot start a second research while one is in progress', () => {
    const sim = new Sim(SPEC);
    const podId = podAt(sim, 0, 6, 6);
    sim.step({
      tick: sim.state.tick,
      commands: [{
        kind: CommandKind.StartResearchAtPod,
        structureId: podId,
        researchKind: 'autoResume',
      }],
    });
    const ticksBefore = sim.state.factions[0].researchTicksRemaining;
    // Issue a second start — should be silently rejected.
    sim.step({
      tick: sim.state.tick,
      commands: [{
        kind: CommandKind.StartResearchAtPod,
        structureId: podId,
        researchKind: 'autoResume',
      }],
    });
    // Timer just ticked once for the in-progress research; no reset.
    expect(sim.state.factions[0].researchTicksRemaining).toBe(ticksBefore - 1);
  });

  it('without research: post-charge worker stays idle (no resume)', () => {
    const sim = new Sim(SPEC);
    trainWorker(sim, 0, 4, 4);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    // Force a harvest cycle with charge=1 so the post-cycle worker
    // enters charge mode with previousNodeId captured.
    w.charge = 1;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    expect(w.previousNodeId).toBe(1);
    // Run until fully charged.
    for (let i = 0; i < 3000 && w.phase !== 'idle'; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(w.phase).toBe('idle');
    // No research → previousNodeId is cleared, no auto-resume.
    expect(w.previousNodeId).toBe(0);
    expect(w.targetNodeId).toBe(0);
  });

  it('with research: post-charge worker resumes its previous harvest', () => {
    const sim = new Sim(SPEC);
    // Pre-flip the research flag (cheaper than running the timer).
    sim.state.factions[0].autoResumeResearched = true;
    trainWorker(sim, 0, 4, 4);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    w.charge = 1;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    // Track: cycle 1 drains 1 charge → 0, worker completes cycle →
    // enters walkingToCharge → charges to full → maybeAutoResumeAfter
    // Charge spends 1 to resume → charge = maxCharge - 1, targetNode
    // still 1. Break as soon as we see the resume signal.
    let saw = false;
    for (let i = 0; i < 5000 && !saw; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      saw = w.charge === WORKER_DEFAULT_MAX_CHARGE - 1
        && w.targetNodeId === 1
        && (w.phase === 'movingToNode' || w.phase === 'harvesting');
    }
    expect(saw).toBe(true);
  });

  it('research + depleted previous node: no resume, idle', () => {
    const sim = new Sim({
      ...SPEC,
      nodes: [{ x: 5, y: 5, energy: 5 }], // small node — drains fast
    });
    sim.state.factions[0].autoResumeResearched = true;
    trainWorker(sim, 0, 4, 4);
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    w.charge = 1;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    // Run long enough to deplete the node + complete the charge.
    for (let i = 0; i < 3000 && w.phase !== 'idle'; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(w.phase).toBe('idle');
    expect(sim.state.nodes[0].alive).toBe(false);
    // Previous node depleted → no resume; field cleared.
    expect(w.previousNodeId).toBe(0);
  });
});

describe('Sim — AI work-pod growth', () => {
  it('AI at cap with energy + an actionable worker emits BuildStructureByWorker', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 5, y: 5 }, faction1: { x: 27, y: 27 } },
      nodes: [{ x: 6, y: 5, energy: 1000 }],
      initialEnergy: 10000,
    });
    // Fill the faction-0 worker cap by injecting workers directly.
    const cap = sim.state.factions[0].supplyCap;
    for (let i = 0; i < cap; i++) {
      sim.step({
        tick: sim.state.tick,
        commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
      });
    }
    // Run forward to a tick that's % AI_TICK_INTERVAL.
    while (sim.state.tick % 10 !== 0) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    const cmds = tickAi(sim.state, 0);
    const build = cmds.find((c) => c.kind === CommandKind.BuildStructureByWorker);
    expect(build).toBeTruthy();
  });

  it('AI does not double-issue a pod while one is mid-construction', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 5, y: 5 }, faction1: { x: 27, y: 27 } },
      nodes: [{ x: 6, y: 5, energy: 1000 }],
      initialEnergy: 10000,
    });
    // Inject a mid-construction pod for faction 0.
    sim.state.structures.push({
      id: sim.state.nextEntityId++,
      alive: true,
      kind: 'workPod',
      faction: 0,
      x: fromInt(8),
      y: fromInt(5),
      hp: STRUCTURE_STATS.workPod.maxHp,
      buildTicksRemaining: 15,
    });
    // Fill the worker cap.
    for (let i = 0; i < HQ_SUPPLY_CAP_INITIAL; i++) {
      sim.step({
        tick: sim.state.tick,
        commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
      });
    }
    while (sim.state.tick % 10 !== 0) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    const cmds = tickAi(sim.state, 0);
    const build = cmds.find((c) => c.kind === CommandKind.BuildStructureByWorker);
    expect(build).toBeUndefined();
  });
});
