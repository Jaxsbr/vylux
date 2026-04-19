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

// Combat stat blocks.
export type CombatStats = {
  maxHp: number;
  damage: number;
  range: number;
  attackCooldown: number;
};

export const UNIT_STATS: Record<UnitKind, CombatStats> = {
  worker: { maxHp: 20, damage: 0, range: 0, attackCooldown: 0 },
  defender: { maxHp: 100, damage: 15, range: 1.5, attackCooldown: 1.0 },
  raider: { maxHp: 40, damage: 20, range: 1.5, attackCooldown: 0.8 },
};

export const HQ_MAX_HP = 500;
