// Per-unit-kind tuning. Compile-time constants for the Phase C.1 surface.
// Numbers are placeholders — Phase C+ retunes against playtests. The
// shape is what's load-bearing here, not the values.
//
// All fields in Q16.16 fixed-point or integer ticks. No floats.

import { fromFloat, fromInt, rangeSq, type Fixed } from './fixed';
import type { FactionId, StructureKind, UnitKind } from './types';

export interface UnitStats {
  maxHp: Fixed;
  // Chebyshev step-toward-target speed (per-tick tile delta, clamped per
  // axis). Workers are the only live unit kind; combat units return via
  // the new tech tree starting in Phase D of docs/plan.md.
  speed: Fixed; // tiles per tick — 0 means stationary
  trainCost: Fixed;
  // Line-of-sight radius (tiles, Fixed). Drives the discovery sweep +
  // the renderer's vision filter.
  visionRadius: Fixed;
  // Ticks the HQ takes to produce one unit of this kind. Workers stay
  // instant for the Phase A cut so the existing economy + tests keep
  // their pacing.
  trainTicks: number;
}

const SPEED_WORKER: Fixed = fromFloat(0.05);

// Shared UNIT_STATS baseline. Per-faction overrides below.
export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  worker: {
    maxHp: fromInt(40),
    speed: SPEED_WORKER,
    trainCost: fromInt(50),
    visionRadius: fromInt(4),
    trainTicks: 0,
  },
};

// HQ vision radius. Bigger than any unit so the opening home patch is
// comfortably scouted by default — the player shouldn't have to dispatch
// a worker just to see their own base.
export const HQ_VISION_RADIUS: Fixed = fromInt(8);

// Phase C.1: per-structure tuning.
export interface StructureStats {
  maxHp: Fixed;
  buildCost: Fixed; // Energy cost charged at BuildStructureByWorker apply-time
  buildTicks: number; // total construction ticks (decremented only while a worker is on site)
  visionRadius: Fixed;
}

export const STRUCTURE_STATS: Record<StructureKind, StructureStats> = {
  workPod: {
    maxHp: fromInt(100),
    buildCost: fromInt(60),
    buildTicks: 30, // 1.5 s at 20 Hz
    visionRadius: fromInt(5),
  },
};

// Phase C.1: worker charge / supply tuning.

// Default max charge for a freshly-trained worker. Each task drains 1.
export const WORKER_DEFAULT_MAX_CHARGE = 10;

// Charge spots:
//   - Work pod: +1 charge every CHARGE_TICKS_PER_UNIT_POD ticks (1 s at 20 Hz)
//   - HQ:       +1 charge every CHARGE_TICKS_PER_UNIT_HQ  ticks (2 s) — 50% of the pod rate
export const CHARGE_TICKS_PER_UNIT_POD = 20;
export const CHARGE_TICKS_PER_UNIT_HQ = 40;

// Reach radii (squared, in Fixed). A worker counts as "at the charge
// spot" when it sits within these radii of the spot's centre.
export const POD_CHARGE_REACH_SQ: Fixed = rangeSq(fromFloat(1.0));
export const HQ_CHARGE_REACH_SQ: Fixed = rangeSq(fromFloat(2.0)); // matches HQ_DEPOSIT_REACH_SQ

// Phase C.1 charge-slot allocation. Workers picking the same charge
// spot get assigned a hex / octagonal slot offset so they don't all
// stand on the same point. Same idiom as harvest-slot allocation at
// energy nodes (step.ts HARVEST_SLOT_OFFSETS). Slot radii are chosen
// to sit just outside the structure body but inside the charge-reach
// radius, so a worker AT its slot also counts as "at the spot" and
// transitions into the charging phase cleanly.

// Pod: 6-point hex ring at radius 0.85 (pod body is ~0.43 wide × 1.6
// scale → 0.68 visual radius; slot at 0.85 sits just outside without
// crossing POD_CHARGE_REACH_SQ = 1.0²).
const POD_CHARGE_SLOT_R: Fixed = fromFloat(0.85);
const POD_CHARGE_SLOT_R_HALF: Fixed = fromFloat(0.425);
const POD_CHARGE_SLOT_R_SQRT3_2: Fixed = fromFloat(0.736); // 0.85 * sqrt(3)/2
export const POD_CHARGE_SLOT_COUNT = 6;
export const POD_CHARGE_SLOT_OFFSETS: ReadonlyArray<{ dx: Fixed; dy: Fixed }> = [
  { dx:  POD_CHARGE_SLOT_R,           dy:  0 },
  { dx:  POD_CHARGE_SLOT_R_HALF,      dy:  POD_CHARGE_SLOT_R_SQRT3_2 },
  { dx: -POD_CHARGE_SLOT_R_HALF,      dy:  POD_CHARGE_SLOT_R_SQRT3_2 },
  { dx: -POD_CHARGE_SLOT_R,           dy:  0 },
  { dx: -POD_CHARGE_SLOT_R_HALF,      dy: -POD_CHARGE_SLOT_R_SQRT3_2 },
  { dx:  POD_CHARGE_SLOT_R_HALF,      dy: -POD_CHARGE_SLOT_R_SQRT3_2 },
];

// HQ: 8-point octagonal ring at radius 1.6. HQ silhouette is much
// larger than a pod (2× scale on a multi-tier mesh); the wider ring
// + extra slots accommodates more workers crowding the HQ when no
// pods exist yet. 1.6 sits comfortably inside HQ_CHARGE_REACH_SQ = 2.0².
const HQ_CHARGE_SLOT_R: Fixed = fromFloat(1.6);
const HQ_CHARGE_SLOT_R_DIAG: Fixed = fromFloat(1.131); // 1.6 * sqrt(2)/2
export const HQ_CHARGE_SLOT_COUNT = 8;
export const HQ_CHARGE_SLOT_OFFSETS: ReadonlyArray<{ dx: Fixed; dy: Fixed }> = [
  { dx:  HQ_CHARGE_SLOT_R,        dy:  0 },
  { dx:  HQ_CHARGE_SLOT_R_DIAG,   dy:  HQ_CHARGE_SLOT_R_DIAG },
  { dx:  0,                       dy:  HQ_CHARGE_SLOT_R },
  { dx: -HQ_CHARGE_SLOT_R_DIAG,   dy:  HQ_CHARGE_SLOT_R_DIAG },
  { dx: -HQ_CHARGE_SLOT_R,        dy:  0 },
  { dx: -HQ_CHARGE_SLOT_R_DIAG,   dy: -HQ_CHARGE_SLOT_R_DIAG },
  { dx:  0,                       dy: -HQ_CHARGE_SLOT_R },
  { dx:  HQ_CHARGE_SLOT_R_DIAG,   dy: -HQ_CHARGE_SLOT_R_DIAG },
];

// Build reach: how close a worker must be to a pod tile to count as
// "on site" and contribute construction progress.
export const WORK_POD_BUILD_REACH_SQ: Fixed = rangeSq(fromFloat(1.2));

// Capacity (worker supply) — HQ baseline + per-pod bonus.
export const HQ_SUPPLY_CAP_INITIAL = 5;
export const WORK_POD_CAP_BONUS = 5;

// Energy cost per task. Set to 1 universally — every task is "one unit
// of work".
export const ENERGY_COST_PER_TASK = 1;

// Phase C.1 — research catalogue (single entry for now).
// auto-resume: workers automatically resume their last harvest target
// after charging. Cost in the faction's Energy pool; ticks at sim rate.
export const RESEARCH_AUTO_RESUME_COST: Fixed = fromInt(80);
export const RESEARCH_AUTO_RESUME_TICKS = 80; // 4 s at 20 Hz

// Per-faction stat overrides on top of the shared UNIT_STATS baseline.
// Most kinds stay shared; only fields that genuinely diverge get an
// entry here. New asymmetric fields land by adding rows — no callsite
// churn elsewhere as long as callers go through unitStatsFor(factionId, kind).
type UnitOverrides = { readonly [K in UnitKind]?: Partial<UnitStats> };

const SWARM_UNIT_OVERRIDES: UnitOverrides = {
  // Phase C.1 first-cut asymmetry: cheaper + faster but fragile.
  worker: {
    speed: fromFloat(0.055), // existing move-speed split
    trainCost: fromInt(40),  // cheaper than baseline
    maxHp: fromInt(30),      // softer
  },
};

const SIEGE_UNIT_OVERRIDES: UnitOverrides = {
  // Phase C.1 first-cut asymmetry: costlier + slower but tougher.
  worker: {
    speed: fromFloat(0.045), // existing move-speed split
    trainCost: fromInt(60),  // costlier
    maxHp: fromInt(60),      // tougher
  },
};

function applyOverrides(base: Record<UnitKind, UnitStats>, overrides: UnitOverrides): Record<UnitKind, UnitStats> {
  const out = { ...base } as Record<UnitKind, UnitStats>;
  (Object.keys(overrides) as UnitKind[]).forEach((k) => {
    const o = overrides[k];
    if (o !== undefined) out[k] = { ...out[k], ...o };
  });
  return out;
}

const FACTION_UNIT_STATS: Record<FactionId, Record<UnitKind, UnitStats>> = {
  swarm: applyOverrides(UNIT_STATS, SWARM_UNIT_OVERRIDES),
  siege: applyOverrides(UNIT_STATS, SIEGE_UNIT_OVERRIDES),
};

export function unitStatsFor(factionId: FactionId, kind: UnitKind): UnitStats {
  return FACTION_UNIT_STATS[factionId][kind];
}

// Per-faction match-config overrides for non-unit-stat knobs. Today:
// harvest interval (the trade-off pair to worker speed). Future
// asymmetry that doesn't fit on UnitStats lands here.
export interface FactionConfig {
  // Ticks between successive harvest gains while a worker is parked at
  // a node. Pairs inversely with worker speed so a faction with fast
  // workers harvests slowly per tick (compensating for redeployment
  // mobility) and vice-versa.
  readonly harvestTicks: number;
}

const SHARED_FACTION_CONFIG: FactionConfig = {
  harvestTicks: 20, // 1 second at 20 Hz
};

const FACTION_CONFIGS: Record<FactionId, FactionConfig> = {
  swarm: { ...SHARED_FACTION_CONFIG, harvestTicks: 23 }, // ~13% slower per gain
  siege: { ...SHARED_FACTION_CONFIG, harvestTicks: 17 }, // ~18% faster per gain
};

export function factionConfigFor(factionId: FactionId): FactionConfig {
  return FACTION_CONFIGS[factionId];
}
