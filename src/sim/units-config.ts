// Per-unit-kind tuning. Phase 1.0 keeps these as compile-time constants;
// Phase 1.2+ likely hoists them into a MatchConfig so different match
// formats (ranked / casual / training) can override.
//
// Numbers are intentionally placeholder — Phase 3 re-tunes against
// playtests. The shape is what's load-bearing here, not the values.
//
// All fields in Q16.16 fixed-point or integer ticks. No floats.

import { fromFloat, fromInt, type Fixed } from './fixed';
import type { StructureKind, UnitKind } from './types';

export interface UnitStats {
  maxHp: Fixed;
  speed: Fixed; // tiles per tick — 0 means stationary
  attackRange: Fixed; // tile units
  attackDamage: Fixed;
  attackCooldownTicks: number; // ticks between attacks
  trainCost: Fixed;
  // Phase 3.2: optional Flux cost. Defaults to 0 for tier-1 units.
  // Tier-2 units (vanguard and onward) consume Flux on top of Energy,
  // and the production building's TrainAtStructure handler verifies
  // both pools before scheduling.
  trainFluxCost: Fixed;
  // Phase 3.5: faction-locked colour cost. Required for every unit
  // (workers included, with a small cost so an opponent denying your
  // colour nodes locks down your whole base — not just combat).
  // Charged from FactionState.color in TrainUnit + TrainAtStructure.
  trainColorCost: Fixed;
  // Phase 3.6: supply consumed by one alive instance of this kind.
  // TrainUnit + TrainAtStructure reject the command when
  // supplyUsed + supplyCost > supplyCap. Increments on spawnUnit;
  // decrements on death (applyDamage).
  supplyCost: number;
  // Phase 3.8: line-of-sight radius (tiles, Fixed). Drives the
  // discovery sweep + the renderer's vision filter. Combat units have
  // a slightly bigger radius than workers so scouting with a raider
  // is a real option; defenders see further than they can shoot
  // (they're meant to be lookout posts as well as garrison).
  visionRadius: Fixed;
  // Phase 3.0: ticks the production building (or HQ for workers) takes
  // to produce one unit of this kind. Workers stay instant for the 3.0
  // cut so existing economy + tests keep their pacing; combat kinds
  // gain real production time so the player choosing to invest in tier-1
  // combat is committing the production building's queue for that long.
  trainTicks: number;
  // Phase 3.2: tier-2 units only train if the producing faction has
  // tier2Researched on FactionState. Tier-1 stays false so the existing
  // production flow is unchanged.
  requiresTier2: boolean;
}

const SPEED_WORKER: Fixed = fromFloat(0.05);
const SPEED_RAIDER: Fixed = fromFloat(0.08);
// Defenders are stationary in Phase 1. Worker speed is shared with sim/step
// for the harvest loop — see WORKER_SPEED there for the canonical export.

const SPEED_VANGUARD: Fixed = fromFloat(0.07); // slightly slower than raider (0.08)

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  worker: {
    maxHp: fromInt(40),
    speed: SPEED_WORKER,
    attackRange: fromInt(0),
    attackDamage: fromInt(0),
    attackCooldownTicks: 0,
    trainCost: fromInt(50),
    trainFluxCost: fromInt(0),
    trainColorCost: fromInt(5),
    supplyCost: 1,
    visionRadius: fromInt(4),
    trainTicks: 0,
    requiresTier2: false,
  },
  defender: {
    maxHp: fromInt(120),
    speed: fromInt(0),
    attackRange: fromFloat(1.5),
    attackDamage: fromInt(10),
    attackCooldownTicks: 20, // 1 attack per second at 20 Hz
    trainCost: fromInt(80),
    trainFluxCost: fromInt(0),
    trainColorCost: fromInt(10),
    supplyCost: 2,
    visionRadius: fromInt(5),
    trainTicks: 30, // 1.5 s — opens the harassment window for raiders
    requiresTier2: false,
  },
  raider: {
    maxHp: fromInt(50),
    speed: SPEED_RAIDER,
    attackRange: fromFloat(1.0),
    attackDamage: fromInt(15),
    attackCooldownTicks: 15,
    trainCost: fromInt(120),
    trainFluxCost: fromInt(0),
    trainColorCost: fromInt(10),
    supplyCost: 2,
    visionRadius: fromInt(5),
    trainTicks: 40, // 2 s — costlier production, slightly faster than defender on a per-cost basis
    requiresTier2: false,
  },
  // Phase 3.2 tier-2 unit. Stomps tier-1 in straight fights but costs
  // both Energy and Flux + a meaningful train window — opens an early
  // aggression window for the opponent if you commit to teching.
  // Numbers are placeholders, retuned in 3.7 playtest.
  vanguard: {
    maxHp: fromInt(150),
    speed: SPEED_VANGUARD,
    attackRange: fromFloat(1.5),
    attackDamage: fromInt(30),
    attackCooldownTicks: 18,
    trainCost: fromInt(200), // ~1.7x raider cost in Energy
    trainFluxCost: fromInt(30),
    trainColorCost: fromInt(25),
    supplyCost: 4,
    visionRadius: fromInt(6),
    trainTicks: 80, // 4 s — clearly costlier than tier-1
    requiresTier2: true,
  },
};

// Phase 3.0 production building + Phase 3.2 upgrade structure. Faction-
// asymmetric naming + visuals arrive in 3.4; for now all factions field
// the same generic "Forge" + "Spire." Numbers are placeholders, retuned
// during 3.7 playtest.
export interface StructureStats {
  maxHp: Fixed;
  buildCost: Fixed;
  buildTicks: number;
  // Phase 3.5: faction-locked colour cost on every build. Charged
  // from FactionState.color when BuildStructure is applied.
  buildColorCost: Fixed;
  // Phase 3.8: stationary line-of-sight radius. Bigger than unit
  // vision because structures can't move — they're the long-haul
  // lookout posts. Used by the discovery sweep + the renderer's
  // vision filter the same way unit vision is.
  visionRadius: Fixed;
}

export const STRUCTURE_STATS: Record<StructureKind, StructureStats> = {
  production: {
    maxHp: fromInt(200), // soaks more than a defender, killable by a small raider squad
    buildCost: fromInt(150), // ~3 workers' worth of wages, or one tier-1 combat unit
    buildTicks: 60, // 3 s at 20 Hz
    buildColorCost: fromInt(30),
    visionRadius: fromInt(6),
  },
  upgrade: {
    maxHp: fromInt(150), // softer than a Forge — Spires are tech, not garrison
    buildCost: fromInt(100), // cheaper than a Forge so techers can commit early
    buildTicks: 40, // 2 s
    buildColorCost: fromInt(25),
    visionRadius: fromInt(6),
  },
  // Phase 3.6 Pylon — supply-cap structure. Cheap to commit, soft so
  // raiders can deny it. Operational Pylons add SUPPLY_CAP_BONUS to
  // their faction's cap.
  supply: {
    maxHp: fromInt(100),
    buildCost: fromInt(75),
    buildTicks: 30, // 1.5 s
    buildColorCost: fromInt(15),
    visionRadius: fromInt(5),
  },
};

// Phase 3.8: HQ vision radius. Bigger than any other structure so the
// opening home patch is comfortably scouted by default — the player
// shouldn't have to dispatch a worker just to see their own base.
// Operational structures + units extend the bubble outward.
export const HQ_VISION_RADIUS: Fixed = fromInt(8);

// Phase 3.1 / 3.2: Flux cost to research tier 2. Phase 3.1 spent it on
// a standalone command (now removed); 3.2 spends it via the upgrade
// structure's research action. Same number; the path is structure-
// gated so the player has to first commit a Spire on the map.
export const TIER2_FLUX_COST: Fixed = fromInt(50);
// Phase 3.5: tier-2 research also costs colour. Same lockout-by-denial
// logic as production — a player pushed off their colour can't tech.
export const TIER2_COLOR_COST: Fixed = fromInt(25);
export const TIER2_RESEARCH_TICKS = 80; // 4 s at 20 Hz

// Phase 3.7: energy-dump tuning. Cost is the upfront Energy charge for
// activating the ability. Duration is how many ticks the worker bleeds
// segments + moves at the speed multiplier. Cooldown gates re-activation
// once the dump ends (cooldown counter starts at dump-end, not at dump-
// start — so the player gets the full cooldown after the dump finishes).
// TRAIL_SEGMENT_LIFETIME is the age (in ticks) at which a segment
// expires; doubled for factions with the trail-duration research.
// TRAIL_KILL_RANGE_SQ is the squared distance threshold for the per-
// tick collision sweep — chosen so a unit centred within ~0.4 tile of
// any segment dies (about half a tile, comfortably "stepping on" the
// trail without false positives at 1-tile separation).
import { rangeSq } from './fixed';
export const DUMP_ENERGY_COST: Fixed = fromInt(100);
export const DUMP_DURATION_TICKS = 40; // 2 s at 20 Hz
export const DUMP_COOLDOWN_TICKS = 200; // 10 s — meaningful re-use window
export const DUMP_SPEED_MULTIPLIER = 2;
export const TRAIL_SEGMENT_LIFETIME = 60; // 3 s
export const TRAIL_KILL_RANGE_SQ: Fixed = rangeSq(fromFloat(0.4));
export const TRAIL_DURATION_FLUX_COST: Fixed = fromInt(40);
export const TRAIL_DURATION_RESEARCH_TICKS = 80; // 4 s — same shape as TIER2

// Phase 3.6: supply system tuning. Initial cap covers the opening
// worker batch + a couple of combat units; each operational Pylon adds
// the bonus. Tuned so a faction needs to commit a Pylon by the time
// it's pushing for an army of 6+ combat units.
export const SUPPLY_CAP_INITIAL = 10;
export const SUPPLY_CAP_BONUS_PER_PYLON = 8;

// Phase 3.5: tuning knobs for colour nodes. maxReserve is the cap a
// colour node refills to via passive regen; regenPerTick is added to
// `remaining` each tick (capped at maxReserve). The numbers are
// placeholders — 3.12's playtest tuning will revise.
//
// At 0.05 / tick = 1 / sec, a fully-depleted colour node refills its
// 100 reserve in 100 seconds (~1.7 minutes). That window is the
// "lockout-by-denial cost" — long enough that pushing the enemy off
// their colour really hurts, short enough that a recovered base can
// rejoin the macro game.
export const COLOR_NODE_STATS = {
  maxReserve: fromInt(100),
  regenPerTick: fromFloat(0.05),
} as const;
