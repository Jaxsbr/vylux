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
