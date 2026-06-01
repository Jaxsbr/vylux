// Phase D.1 — Matter + cost split. Covers: the dual-resource cost shape
// (work pod = energy + matter), matter harvest/deposit crediting the matter
// pool (and NOT the energy score spine), and the map generator seeding
// matter pairs while keeping the guaranteed near-HQ node energy.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { fromInt, toInt } from './fixed';
import type { InitialMatchSpec } from './state';
import { STRUCTURE_STATS, canAfford, spendCost } from './units-config';
import { generateEnergyField } from './map-gen';

const SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 27, y: 27 } },
  // One energy node and one matter node near faction 0's HQ.
  nodes: [
    { x: 5, y: 5, amount: 1000, kind: 'energy' },
    { x: 5, y: 6, amount: 1000, kind: 'matter' },
  ],
  initialEnergy: 10000,
  initialMatter: 10000,
};

function ownedWorkerCount(sim: Sim, faction: 0 | 1): number {
  return sim.state.units.filter((u) => u.alive && u.kind === 'worker' && u.faction === faction).length;
}

function trainWorker(sim: Sim, faction: 0 | 1, x: number, y: number): number {
  const before = ownedWorkerCount(sim, faction);
  sim.step({
    tick: sim.state.tick,
    commands: [{ kind: CommandKind.TrainUnit, faction, unitKind: 'worker', x, y }],
  });
  let guard = 0;
  while (ownedWorkerCount(sim, faction) <= before && guard < 200) {
    sim.step({ tick: sim.state.tick, commands: [] });
    guard += 1;
  }
  const w = sim.state.units.find((u) => u.alive && u.kind === 'worker' && u.faction === faction);
  return w ? w.id : 0;
}

describe('Phase D.1 — cost split', () => {
  it('canAfford / spendCost honour both resources independently', () => {
    const fs = { energy: fromInt(100), matter: fromInt(20) };
    expect(canAfford(fs, { energy: fromInt(40) })).toBe(true); // energy-only, plenty
    expect(canAfford(fs, { matter: fromInt(30) })).toBe(false); // matter short
    expect(canAfford(fs, { energy: fromInt(40), matter: fromInt(20) })).toBe(true); // both exactly meetable
    expect(canAfford(fs, { energy: fromInt(40), matter: fromInt(21) })).toBe(false); // matter just short
  });

  it('spendCost debits only the named resources', () => {
    const fs = { energy: fromInt(100), matter: fromInt(50) } as any;
    spendCost(fs, { energy: fromInt(40), matter: fromInt(30) });
    expect(toInt(fs.energy)).toBe(60);
    expect(toInt(fs.matter)).toBe(20);
    spendCost(fs, { energy: fromInt(10) }); // energy-only leaves matter untouched
    expect(toInt(fs.energy)).toBe(50);
    expect(toInt(fs.matter)).toBe(20);
  });

  it('building a work pod debits BOTH energy and matter', () => {
    const sim = new Sim(SPEC);
    const wid = trainWorker(sim, 0, 4, 4);
    expect(wid).not.toBe(0);
    const fs = sim.state.factions[0];
    const e0 = fs.energy;
    const m0 = fs.matter;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.BuildStructureByWorker, workerId: wid, structureKind: 'workPod', x: 8, y: 8 }],
    });
    const cost = STRUCTURE_STATS.workPod.buildCost;
    expect(fs.energy).toBe(e0 - (cost.energy ?? 0));
    expect(fs.matter).toBe(m0 - (cost.matter ?? 0));
    // The structure actually got placed.
    expect(sim.state.structures.some((s) => s.alive && s.kind === 'workPod' && s.faction === 0)).toBe(true);
  });

  it('a pod build is rejected when matter is short even with ample energy', () => {
    const sim = new Sim({ ...SPEC, initialMatter: 0 });
    const wid = trainWorker(sim, 0, 4, 4);
    const fs = sim.state.factions[0];
    const e0 = fs.energy;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.BuildStructureByWorker, workerId: wid, structureKind: 'workPod', x: 8, y: 8 }],
    });
    // Nothing spent, nothing built — the build silently rejected on matter.
    expect(fs.energy).toBe(e0);
    expect(sim.state.structures.some((s) => s.alive && s.kind === 'workPod')).toBe(false);
  });
});

describe('Phase D.1 — matter harvest + deposit', () => {
  it('depositing matter credits the matter pool + matterHarvested, leaving the energy pools alone', () => {
    const sim = new Sim(SPEC);
    const wid = trainWorker(sim, 0, 4, 4);
    const fs = sim.state.factions[0];
    const energyBefore = fs.energy;
    const energyHarvestedBefore = fs.energyHarvested;
    const matterBefore = fs.matter;
    const matterHarvestedBefore = fs.matterHarvested;
    // Send the worker to the MATTER node (id 2) and run the harvest/return loop.
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: wid, nodeId: 2 }],
    });
    let guard = 0;
    while (fs.matter <= matterBefore && guard < 2000) {
      sim.step({ tick: sim.state.tick, commands: [] });
      guard += 1;
    }
    expect(fs.matter).toBeGreaterThan(matterBefore); // spendable matter credited
    expect(fs.matterHarvested).toBeGreaterThan(matterHarvestedBefore); // score spine (matter) credited
    expect(fs.energy).toBe(energyBefore); // energy pool untouched
    expect(fs.energyHarvested).toBe(energyHarvestedBefore); // energy spine untouched
  });

  it('depositing energy still credits energy + the score spine (regression)', () => {
    const sim = new Sim(SPEC);
    const wid = trainWorker(sim, 0, 4, 4);
    const fs = sim.state.factions[0];
    const energyBefore = fs.energy;
    const harvestedBefore = fs.energyHarvested;
    const matterBefore = fs.matter;
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: wid, nodeId: 1 }],
    });
    let guard = 0;
    while (fs.energy <= energyBefore && guard < 2000) {
      sim.step({ tick: sim.state.tick, commands: [] });
      guard += 1;
    }
    expect(fs.energy).toBeGreaterThan(energyBefore);
    expect(fs.energyHarvested).toBeGreaterThan(harvestedBefore);
    expect(fs.matter).toBe(matterBefore); // energy haul leaves matter alone
  });
});

describe('Phase D.2 — map-gen matter seeding (clustered)', () => {
  const BASE = {
    seed: 7,
    gridSize: 64,
    hqs: [{ x: 8, y: 55 }, { x: 55, y: 8 }],
    hqVisionRadiusTiles: 8,
  };
  const HQ0 = BASE.hqs[0];

  it('seeds matter nodes alongside energy across seeds', () => {
    let sawMatter = false;
    let sawEnergy = false;
    for (let s = 0; s < 20 && !(sawMatter && sawEnergy); s++) {
      for (const n of generateEnergyField({ ...BASE, seed: s })) {
        if (n.kind === 'matter') sawMatter = true;
        if (n.kind === 'energy') sawEnergy = true;
      }
    }
    expect(sawMatter).toBe(true);
    expect(sawEnergy).toBe(true);
  });

  it('keeps the home patch (within HQ vision) energy for bootstrap', () => {
    const visionSq = BASE.hqVisionRadiusTiles * BASE.hqVisionRadiusTiles;
    for (let s = 0; s < 40; s++) {
      const nodes = generateEnergyField({ ...BASE, seed: s });
      // At least one in-vision node, and the closest in-vision node is energy
      // (the Home seed). We assert there's an in-vision energy node.
      const inVisionEnergy = nodes.some((n) => {
        const dx = n.x - HQ0.x;
        const dy = n.y - HQ0.y;
        return n.kind === 'energy' && dx * dx + dy * dy <= visionSq;
      });
      expect(inVisionEnergy).toBe(true);
    }
  });

  it('matter share is a sensible minority of the field over many seeds', () => {
    let matter = 0;
    let total = 0;
    for (let s = 0; s < 60; s++) {
      for (const n of generateEnergyField({ ...BASE, seed: s })) {
        total += 1;
        if (n.kind === 'matter') matter += 1;
      }
    }
    const frac = matter / total;
    expect(frac).toBeGreaterThan(0.1);
    expect(frac).toBeLessThan(0.6);
  });
});
