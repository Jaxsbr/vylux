// Per-unit-kind tuning. Compile-time constants for the Phase C.1 surface.
// Numbers are placeholders — Phase C+ retunes against playtests. The
// shape is what's load-bearing here, not the values.
//
// All fields in Q16.16 fixed-point or integer ticks. No floats.

import { fromFloat, fromInt, rangeSq, sub, type Fixed } from './fixed';
import type { FactionId, FactionState, StructureKind, UnitKind } from './types';

// Phase D.1: a cost is a bag of optional per-resource amounts. A missing
// field means "this resource is not required" — so an energy-only cost
// omits `matter` entirely, a matter-only cost omits `energy`, and a
// dual cost lists both. The helpers below are the single affordability +
// spend path; every train / build / research site goes through them so
// adding a third resource later is one struct field, not a callsite sweep.
export interface ResourceCost {
  energy?: Fixed;
  matter?: Fixed;
}

// True when the faction can pay every resource the cost names. Reads only
// the spendable balances (not the cumulative harvested totals).
export function canAfford(fs: Pick<FactionState, 'energy' | 'matter'>, cost: ResourceCost): boolean {
  if (cost.energy !== undefined && fs.energy < cost.energy) return false;
  if (cost.matter !== undefined && fs.matter < cost.matter) return false;
  return true;
}

// Debit every resource the cost names. Caller must have checked canAfford
// first (train/build/research all gate on it), so this never drives a
// balance negative.
export function spendCost(fs: FactionState, cost: ResourceCost): void {
  if (cost.energy !== undefined) fs.energy = sub(fs.energy, cost.energy);
  if (cost.matter !== undefined) fs.matter = sub(fs.matter, cost.matter);
}

export interface UnitStats {
  maxHp: Fixed;
  // Chebyshev step-toward-target speed (per-tick tile delta, clamped per
  // axis). Workers are the only live unit kind; combat units return via
  // the new tech tree starting in Phase E of docs/plan.md.
  speed: Fixed; // tiles per tick — 0 means stationary
  // Phase D.1: resource cost charged at TrainUnit enqueue. Workers run on
  // power → energy-only.
  trainCost: ResourceCost;
  // Line-of-sight radius (tiles, Fixed). Drives the discovery sweep +
  // the renderer's vision filter.
  visionRadius: Fixed;
  // Ticks the HQ takes to produce one unit of this kind. Phase C.2 gives
  // the worker a short, non-zero train time so the player gets a beat of
  // anticipation and the command card has a live production element.
  // Symmetric across factions for this cut (the cost / HP asymmetry
  // already differentiates the two).
  trainTicks: number;
}

const SPEED_WORKER: Fixed = fromFloat(0.05);

// Phase C.2: worker train time — 40 ticks = 2 s at 20 Hz. Short enough to
// stay snappy, long enough to read as "producing".
const WORKER_TRAIN_TICKS = 40;

// Shared UNIT_STATS baseline. Per-faction overrides below.
export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  worker: {
    maxHp: fromInt(40),
    speed: SPEED_WORKER,
    trainCost: { energy: fromInt(50) },
    visionRadius: fromInt(4),
    trainTicks: WORKER_TRAIN_TICKS,
  },
};

// Phase C.2: max units a faction may have queued at its HQ at once
// (matches the SC2 command-card convention). The supply cap also bounds
// the queue — whichever is smaller wins at enqueue.
export const MAX_TRAIN_QUEUE = 5;

// HQ vision radius. Bigger than any unit so the opening home patch is
// comfortably scouted by default — the player shouldn't have to dispatch
// a worker just to see their own base.
export const HQ_VISION_RADIUS: Fixed = fromInt(8);

// Phase C.1: per-structure tuning.
export interface StructureStats {
  maxHp: Fixed;
  // Phase D.1: resource cost charged at BuildStructureByWorker apply-time.
  // A pod is a built structure → costs construction material (matter) AND
  // the power to raise it (energy).
  buildCost: ResourceCost;
  buildTicks: number; // total construction ticks (decremented only while a worker is on site)
  visionRadius: Fixed;
}

export const STRUCTURE_STATS: Record<StructureKind, StructureStats> = {
  workPod: {
    maxHp: fromInt(100),
    // D.1 first cut: 40 E + 30 M (was 60 E energy-only). Rebalanced down on
    // energy so adding matter doesn't make the pod a strictly harder build —
    // matter shares the burden. Placeholders; retune in playtest.
    buildCost: { energy: fromInt(40), matter: fromInt(30) },
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

// Phase C.6.6: work pods may not be built within this Chebyshev TILE distance
// of any live energy node. 1 = the node tile + its 8 neighbours are off-limits,
// keeping the node's harvest-slot ring + approach corridor clear of pod
// footprints so a worker's final hop to a slot never crosses a pod.
export const POD_NODE_KEEPOUT_TILES = 1;

// Chebyshev keep-out from an HQ tile for work-pod placement. The HQ mesh is a
// 3×3 footprint (Chebyshev ≤ 1); 2 leaves a clear ring so a pod can't be glued
// to the base. Matches the map-gen `hqExclusion` so nodes + pods obey the same
// "no structure touching the HQ" rule.
export const POD_HQ_KEEPOUT_TILES = 2;

// Charge drained per worker task. Set to 1 universally — every task is
// "one unit of work". NOTE: this is the per-worker CHARGE battery (the
// unit's work fuel), NOT the faction's harvested Energy pool — see the
// ResourceKind note in types.ts. Renamed from ENERGY_COST_PER_TASK in D.1
// to stop the two senses of "energy" colliding.
export const CHARGE_COST_PER_TASK = 1;

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
    trainCost: { energy: fromInt(40) }, // cheaper than baseline
    maxHp: fromInt(30),      // softer
  },
};

const SIEGE_UNIT_OVERRIDES: UnitOverrides = {
  // Flattened to Swarm's worker stats (owner direction 2026-05-24). The C.1
  // first-cut asymmetry (Siege slower 0.045 / costlier 60 / tougher hp 60)
  // made Siege strictly worse to play — the speed + cost penalty outweighed
  // the toughness, so the faction "just sucks". Until real asymmetry returns
  // with combat units (Phase D of docs/plan.md), Siege mirrors Swarm. This
  // block stays as the divergence hook and tracks Swarm by spreading it, so
  // the two can't drift apart by accident.
  worker: { ...SWARM_UNIT_OVERRIDES.worker },
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
  swarm: { ...SHARED_FACTION_CONFIG, harvestTicks: 23 },
  // Flattened to Swarm's harvest rate (owner direction 2026-05-24) — the
  // harvest split was part of what made Siege feel bad; see
  // SIEGE_UNIT_OVERRIDES above. Asymmetry returns with combat units.
  siege: { ...SHARED_FACTION_CONFIG, harvestTicks: 23 },
};

export function factionConfigFor(factionId: FactionId): FactionConfig {
  return FACTION_CONFIGS[factionId];
}
