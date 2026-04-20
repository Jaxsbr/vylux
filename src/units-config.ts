// Shared unit cost constants — single source of truth referenced by training.ts and tests.
export const WORKER_COST = 20;
export const DEFENDER_COST = 60;
export const RAIDER_COST = 100;

export type UnitKind = 'worker' | 'defender' | 'raider';

export const UNIT_COSTS: Record<UnitKind, number> = {
  worker: WORKER_COST,
  defender: DEFENDER_COST,
  raider: RAIDER_COST,
};

// Named HP constants — tuned so fights last ≥3 hits.
// Worker: 80 HP, raider damage 15 → ceil(80/15)=6 hits to kill (≥5 floor met).
// Raider: 60 HP, defender damage 15 → 4 hits to kill (raiders don't evaporate; ≥3 ✓).
// Defender: 120 HP, raider damage 15 → 8 hits to kill (tank feel preserved; ≥3 ✓).
export const WORKER_HP = 80;
export const DEFENDER_HP = 120;
export const RAIDER_HP = 60;

// Named damage constants.
// RAIDER_DAMAGE reduced from 20 → 15 to give workers a ≥5-hit survival floor.
export const RAIDER_DAMAGE = 15;
export const RAIDER_VS_HQ_DAMAGE = 15; // same damage path, kept separate for future tuning
export const DEFENDER_DAMAGE = 15;

// Retaliation window: if a defender hit a raider within this many combat ticks,
// the raider retaliates on that defender before targeting anything else.
export const RETALIATE_WINDOW_TICKS = 4;

// Combat stat blocks.
export type CombatStats = {
  maxHp: number;
  damage: number;
  range: number;
  attackCooldown: number;
};

export const UNIT_STATS: Record<UnitKind, CombatStats> = {
  worker: { maxHp: WORKER_HP, damage: 0, range: 0, attackCooldown: 0 },
  defender: { maxHp: DEFENDER_HP, damage: DEFENDER_DAMAGE, range: 1.5, attackCooldown: 1.0 },
  raider: { maxHp: RAIDER_HP, damage: RAIDER_DAMAGE, range: 1.5, attackCooldown: 0.8 },
};

export const HQ_MAX_HP = 500;
