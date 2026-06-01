// Phase D.3 — Resource Depot. Covers the headline mechanics:
//   - the long-haul stall fix: a returning worker offloads at the nearest
//     operational depot (not the distant HQ), crediting pool + score spine.
//   - concern split: the depot does NOT grant supply cap (that stays the pod's
//     job) and is NOT a charge spot.
//   - resource-trickle research: nothing before, passive energy + matter income
//     into the pool (and the harvested score spine) once researched.
//   - placement: the 2×2 footprint keep-out is enforced authoritatively.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { tickAi } from './ai';
import { CommandKind } from './commands';
import { fromInt, toFloat, toInt } from './fixed';
import { findStructure, isDepotFootprintBlocked } from './state';
import type { InitialMatchSpec } from './state';
import {
  DEPOT_TRICKLE_INTERVAL_TICKS,
  HQ_SUPPLY_CAP_INITIAL,
  RESEARCH_TRICKLE_TICKS,
  STRUCTURE_STATS,
} from './units-config';

// HQ at (3,3); a single energy node far across the map so the haul home is long
// — exactly the case the depot is meant to shorten. Plenty of resources so
// builds never block on cost.
// Magnitudes kept well inside the Q16.16 fixed-point range (fromInt(x) = x·65536
// must stay < 2³¹ ≈ 32767 max). Generous enough that builds never block on cost
// and the far node never depletes during a test.
const SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 60, y: 60 } },
  nodes: [{ x: 40, y: 40, amount: 5000, kind: 'energy' }],
  initialEnergy: 20000,
  initialMatter: 20000,
};

function workerIds(sim: Sim, faction: 0 | 1): number[] {
  return sim.state.units.filter((u) => u.alive && u.kind === 'worker' && u.faction === faction).map((u) => u.id);
}

// Train one worker at (x,y) and return the freshly-spawned worker's id.
function trainWorker(sim: Sim, faction: 0 | 1, x: number, y: number): number {
  const before = new Set(workerIds(sim, faction));
  sim.step({ tick: sim.state.tick, commands: [{ kind: CommandKind.TrainUnit, faction, unitKind: 'worker', x, y }] });
  let guard = 0;
  for (;;) {
    const fresh = workerIds(sim, faction).find((id) => !before.has(id));
    if (fresh !== undefined) return fresh;
    if (guard++ > 400) return 0;
    sim.step({ tick: sim.state.tick, commands: [] });
  }
}

// Build a resource depot anchored at (ax,ay) with the given worker and run the
// sim until it's operational. Returns the depot's structure id (0 on failure).
function buildDepotOperational(sim: Sim, faction: 0 | 1, builderId: number, ax: number, ay: number): number {
  sim.step({
    tick: sim.state.tick,
    commands: [{ kind: CommandKind.BuildStructureByWorker, workerId: builderId, structureKind: 'resourceDepot', x: ax, y: ay }],
  });
  let guard = 0;
  for (;;) {
    const d = sim.state.structures.find((s) => s.alive && s.kind === 'resourceDepot' && s.faction === faction);
    if (d && d.buildTicksRemaining === 0) return d.id;
    if (guard++ > 4000) return 0;
    sim.step({ tick: sim.state.tick, commands: [] });
  }
}

describe('Phase D.3 — depot placement', () => {
  it('spawns a depot centred on its 2×2 footprint (min-corner anchor + 0.5)', () => {
    const sim = new Sim(SPEC);
    const wid = trainWorker(sim, 0, 36, 36);
    const did = buildDepotOperational(sim, 0, wid, 37, 37);
    expect(did).not.toBe(0);
    const d = findStructure(sim.state, did)!;
    // Anchor (37,37) → footprint (37,37)..(38,38) → centre (37.5, 37.5).
    expect(toFloat(d.x)).toBeCloseTo(37.5, 5);
    expect(toFloat(d.y)).toBeCloseTo(37.5, 5);
    expect(d.kind).toBe('resourceDepot');
  });

  it('rejects a footprint overlapping a node keep-out, allows a clear one', () => {
    const sim = new Sim(SPEC);
    // Node at (40,40); a footprint touching its Chebyshev-1 keep-out is blocked.
    expect(isDepotFootprintBlocked(sim.state, 39, 39)).toBe(true); // covers (39..40) → on node ring
    // A footprint well clear of the node + HQ is buildable.
    expect(isDepotFootprintBlocked(sim.state, 36, 36)).toBe(false);
  });
});

describe('Phase D.3 — long-haul stall fix (offload at the nearest depot)', () => {
  it('a returning worker locks onto the nearby depot, not the distant HQ', () => {
    const sim = new Sim(SPEC);
    const builder = trainWorker(sim, 0, 36, 36);
    const did = buildDepotOperational(sim, 0, builder, 37, 37);
    expect(did).not.toBe(0);

    // A harvester out by the far node (40,40) — depot (~37.5) is right there,
    // HQ (3,3) is across the map.
    const harvester = trainWorker(sim, 0, 38, 38);
    sim.step({ tick: sim.state.tick, commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: harvester, nodeId: 1 }] });

    // Run until the worker is heading home, then assert it picked the depot.
    let guard = 0;
    let saw = false;
    while (guard++ < 3000) {
      sim.step({ tick: sim.state.tick, commands: [] });
      const w = sim.state.units.find((u) => u.id === harvester)!;
      if (w.phase === 'returning') {
        expect(w.depositTargetStructureId).toBe(did);
        saw = true;
        break;
      }
    }
    expect(saw).toBe(true);
  });

  it('offloading at the depot credits the pool AND the harvested score spine', () => {
    const sim = new Sim(SPEC);
    const builder = trainWorker(sim, 0, 36, 36);
    const did = buildDepotOperational(sim, 0, builder, 37, 37);
    expect(did).not.toBe(0);
    const fs = sim.state.factions[0];
    const harvester = trainWorker(sim, 0, 38, 38);
    const energyBefore = fs.energy;
    const harvestedBefore = fs.energyHarvested;
    sim.step({ tick: sim.state.tick, commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: harvester, nodeId: 1 }] });
    let guard = 0;
    while (fs.energyHarvested <= harvestedBefore && guard++ < 4000) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(fs.energy).toBeGreaterThan(energyBefore);
    expect(fs.energyHarvested).toBeGreaterThan(harvestedBefore);
    // The deposit happened out by the depot, not back at the HQ: the worker is
    // nowhere near the HQ when it offloads.
    const w = sim.state.units.find((u) => u.id === harvester)!;
    expect(toInt(w.x)).toBeGreaterThan(20);
  });
});

describe('Phase D.3 — concern split', () => {
  it('a depot does NOT raise the supply cap (that stays the pod\'s job)', () => {
    const sim = new Sim(SPEC);
    const builder = trainWorker(sim, 0, 36, 36);
    const did = buildDepotOperational(sim, 0, builder, 37, 37);
    expect(did).not.toBe(0);
    // One operational depot, zero pods → cap is just the HQ baseline.
    expect(sim.state.factions[0].supplyCap).toBe(HQ_SUPPLY_CAP_INITIAL);
  });
});

describe('Phase D.3 — resource-trickle research', () => {
  it('no passive income before research; energy + matter (and the score spine) trickle after', () => {
    const sim = new Sim(SPEC);
    const builder = trainWorker(sim, 0, 36, 36);
    const did = buildDepotOperational(sim, 0, builder, 37, 37);
    expect(did).not.toBe(0);
    const fs = sim.state.factions[0];

    // No harvesters assigned → pools are static. Confirm two trickle windows
    // pass with NO change before research.
    const e0 = fs.energy;
    const m0 = fs.matter;
    for (let i = 0; i < DEPOT_TRICKLE_INTERVAL_TICKS * 2 + 1; i++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(fs.energy).toBe(e0);
    expect(fs.matter).toBe(m0);

    // Research trickle at the depot, then let it complete.
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.StartResearchAtPod, structureId: did, researchKind: 'resourceTrickle' }],
    });
    for (let i = 0; i < RESEARCH_TRICKLE_TICKS + 2; i++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(fs.trickleResearched).toBe(true);

    // Now both pools (and their harvested twins) climb passively across a window.
    const e1 = fs.energy;
    const m1 = fs.matter;
    const eh1 = fs.energyHarvested;
    const mh1 = fs.matterHarvested;
    for (let i = 0; i < DEPOT_TRICKLE_INTERVAL_TICKS * 2 + 1; i++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(fs.energy).toBeGreaterThan(e1);
    expect(fs.matter).toBeGreaterThan(m1);
    expect(fs.energyHarvested).toBeGreaterThan(eh1);
    expect(fs.matterHarvested).toBeGreaterThan(mh1);
  });

  it('trickle research is rejected at a work pod (wrong host)', () => {
    const sim = new Sim(SPEC);
    const wid = trainWorker(sim, 0, 4, 4);
    // Build a pod near the HQ.
    sim.step({ tick: sim.state.tick, commands: [{ kind: CommandKind.BuildStructureByWorker, workerId: wid, structureKind: 'workPod', x: 8, y: 8 }] });
    let pod = 0;
    let guard = 0;
    while (guard++ < 2000) {
      const p = sim.state.structures.find((s) => s.alive && s.kind === 'workPod' && s.faction === 0);
      if (p && p.buildTicksRemaining === 0) { pod = p.id; break; }
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(pod).not.toBe(0);
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.StartResearchAtPod, structureId: pod, researchKind: 'resourceTrickle' }],
    });
    // Pod is the wrong host for trickle → silently rejected.
    expect(sim.state.factions[0].trickleResearchTicksRemaining).toBe(0);
    expect(sim.state.factions[0].trickleResearched).toBe(false);
  });
});

describe('Phase D.3 — AI plants a depot toward a distant discovered cluster', () => {
  // HQ centred-ish; a near cluster (bootstrap) and a genuinely DISTANT cluster
  // the AI should plant a forward depot toward once it's discovered + at cap.
  const AI_SPEC: InitialMatchSpec = {
    seed: 5,
    gridSize: 64,
    hqs: { faction0: { x: 8, y: 8 }, faction1: { x: 56, y: 56 } },
    nodes: [
      { x: 10, y: 10, amount: 5000, kind: 'energy' }, // home
      { x: 11, y: 9, amount: 5000, kind: 'matter' },  // home matter
      { x: 40, y: 40, amount: 5000, kind: 'energy' },  // distant cluster
      { x: 41, y: 40, amount: 5000, kind: 'energy' },
    ],
    initialEnergy: 20000,
    initialMatter: 20000,
  };

  it('issues a BuildStructureByWorker(resourceDepot) toward the distant cluster (NOT cap-gated)', () => {
    const sim = new Sim(AI_SPEC);
    // Only two workers — WELL below the supply cap of 5. The depot is a buildup
    // priority now, so it must fire during build-up rather than waiting for cap.
    const w0 = trainWorker(sim, 0, 6, 6);
    const w1 = trainWorker(sim, 0, 7, 6);
    expect(w0).not.toBe(0);
    expect(w1).not.toBe(0);
    expect(sim.state.factions[0].supplyUsed).toBeLessThan(HQ_SUPPLY_CAP_INITIAL);
    // The distant cluster is across the map — mark it discovered so the AI's
    // discovered-only routing can target it (it would otherwise need to scout).
    for (const n of sim.state.nodes) {
      if (toInt(n.x) >= 38) n.discoveredBy[0] = true;
    }
    // Advance to an AI tick boundary, then ask the AI for its commands.
    while (sim.state.tick % 10 !== 0) sim.step({ tick: sim.state.tick, commands: [] });
    const cmds = tickAi(sim.state, 0);
    const depotBuild = cmds.find(
      (c) => c.kind === CommandKind.BuildStructureByWorker && c.structureKind === 'resourceDepot',
    );
    expect(depotBuild).toBeDefined();
    // The anchor lands out by the distant cluster, not back near the HQ.
    if (depotBuild && depotBuild.kind === CommandKind.BuildStructureByWorker) {
      expect(depotBuild.x).toBeGreaterThan(30);
      expect(depotBuild.y).toBeGreaterThan(30);
    }
  });

  it('saves for the depot — pauses worker training while a wanted depot is unaffordable', () => {
    const sim = new Sim(AI_SPEC);
    // A few idle workers (below cap), and the distant cluster discovered.
    trainWorker(sim, 0, 6, 6);
    trainWorker(sim, 0, 7, 6);
    trainWorker(sim, 0, 6, 7);
    for (const n of sim.state.nodes) {
      if (toInt(n.x) >= 38) n.discoveredBy[0] = true;
    }
    while (sim.state.tick % 10 !== 0) sim.step({ tick: sim.state.tick, commands: [] });
    // Drain resources below the depot cost (60e/50m): a depot is now WANTED
    // (far cluster discovered, builder free, under cap) but unaffordable.
    sim.state.factions[0].energy = fromInt(30);
    sim.state.factions[0].matter = fromInt(30);
    const cmds = tickAi(sim.state, 0);
    // Saving: it must NOT spend on a worker or a pod this tick (it holds for the
    // depot). Harvest/scout assignment commands are still allowed (income flows).
    expect(cmds.some((c) => c.kind === CommandKind.TrainUnit)).toBe(false);
    expect(cmds.some(
      (c) => c.kind === CommandKind.BuildStructureByWorker && c.structureKind === 'workPod',
    )).toBe(false);
  });

  it('researches resource-trickle once it owns an operational depot + surplus', () => {
    const sim = new Sim(AI_SPEC);
    // Stand up an operational depot for faction 0, then fill the cap.
    const builder = trainWorker(sim, 0, 6, 6);
    const did = buildDepotOperational(sim, 0, builder, 36, 36);
    expect(did).not.toBe(0);
    for (let i = 0; i < HQ_SUPPLY_CAP_INITIAL; i++) trainWorker(sim, 0, 6 + i, 7);
    while (sim.state.tick % 10 !== 0) sim.step({ tick: sim.state.tick, commands: [] });
    const cmds = tickAi(sim.state, 0);
    const research = cmds.find(
      (c) => c.kind === CommandKind.StartResearchAtPod && c.researchKind === 'resourceTrickle',
    );
    expect(research).toBeDefined();
    if (research && research.kind === CommandKind.StartResearchAtPod) {
      expect(research.structureId).toBe(did);
    }
  });
});

// Reference the stats import so the depot's stat block stays wired to the test
// module (and a future assertion has it on hand).
void STRUCTURE_STATS.resourceDepot;
