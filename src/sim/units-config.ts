// Per-unit-kind tuning. Phase 1.0 keeps these as compile-time constants;
// Phase 1.2+ likely hoists them into a MatchConfig so different match
// formats (ranked / casual / training) can override.
//
// Numbers are intentionally placeholder — Phase 3 re-tunes against
// playtests. The shape is what's load-bearing here, not the values.
//
// All fields in Q16.16 fixed-point or integer ticks. No floats.

import { fromFloat, fromInt, type Fixed } from './fixed';
import type { UnitKind } from './types';

export interface UnitStats {
  maxHp: Fixed;
  speed: Fixed; // tiles per tick — 0 means stationary
  attackRange: Fixed; // tile units
  attackDamage: Fixed;
  attackCooldownTicks: number; // ticks between attacks
  trainCost: Fixed;
}

const SPEED_WORKER: Fixed = fromFloat(0.05);
const SPEED_RAIDER: Fixed = fromFloat(0.08);
// Defenders are stationary in Phase 1. Worker speed is shared with sim/step
// for the harvest loop — see WORKER_SPEED there for the canonical export.

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  worker: {
    maxHp: fromInt(40),
    speed: SPEED_WORKER,
    attackRange: fromInt(0),
    attackDamage: fromInt(0),
    attackCooldownTicks: 0,
    trainCost: fromInt(50),
  },
  defender: {
    maxHp: fromInt(120),
    speed: fromInt(0),
    attackRange: fromFloat(1.5),
    attackDamage: fromInt(10),
    attackCooldownTicks: 20, // 1 attack per second at 20 Hz
    trainCost: fromInt(80),
  },
  raider: {
    maxHp: fromInt(50),
    speed: SPEED_RAIDER,
    attackRange: fromFloat(1.0),
    attackDamage: fromInt(15),
    attackCooldownTicks: 15,
    trainCost: fromInt(120),
  },
};
