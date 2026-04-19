// Per-faction energy ledger.
// Pure helper + a mutable instance. No imports from scene.ts or input.ts.

export const BASE_INCOME = 1; // energy per second, always trickles
export const NODE_INCOME = 2; // bonus energy/sec per held node (future wiring)
export const NODE_POINT_RATE = 1; // points/sec per held energy node

export type FactionEnergy = { blue: number; red: number };

/**
 * Advance each faction's energy by BASE_INCOME for one tick.
 * Pure: returns a new object; input is never mutated.
 * Energy is non-negative; the clamp is applied after each addend.
 */
export function tickEnergy(current: FactionEnergy, deltaSeconds: number): FactionEnergy {
  return {
    blue: Math.max(0, current.blue + BASE_INCOME * deltaSeconds),
    red: Math.max(0, current.red + BASE_INCOME * deltaSeconds),
  };
}

/**
 * Override energy for one or both factions.
 * Clamps to non-negative. Returns a new object.
 */
export function setEnergyValues(
  current: FactionEnergy,
  patch: Partial<FactionEnergy>,
): FactionEnergy {
  return {
    blue: Math.max(0, patch.blue ?? current.blue),
    red: Math.max(0, patch.red ?? current.red),
  };
}

/**
 * Subtract cost from one faction's energy. Clamps at 0, never goes negative.
 * Returns a new object; does not mutate input.
 */
export function subtractEnergy(
  current: FactionEnergy,
  faction: keyof FactionEnergy,
  cost: number,
): FactionEnergy {
  return {
    ...current,
    [faction]: Math.max(0, current[faction] - cost),
  };
}

export function createEnergyLedger(): {
  get: () => FactionEnergy;
  tick: (deltaSeconds: number) => void;
  set: (patch: Partial<FactionEnergy>) => void;
  subtract: (faction: keyof FactionEnergy, cost: number) => void;
} {
  let state: FactionEnergy = { blue: 0, red: 0 };
  return {
    get: () => state,
    tick: (deltaSeconds: number) => {
      state = tickEnergy(state, deltaSeconds);
    },
    set: (patch: Partial<FactionEnergy>) => {
      state = setEnergyValues(state, patch);
    },
    subtract: (faction: keyof FactionEnergy, cost: number) => {
      state = subtractEnergy(state, faction, cost);
    },
  };
}
