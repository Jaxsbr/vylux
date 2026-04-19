// Per-faction points ledger.
// Points accrue from node control, kills, and HQ damage (future tasks).
// For this task the ledger exists and stays at 0; wiring placeholder.

export type FactionPoints = { blue: number; red: number };

/**
 * Override points for one or both factions.
 * Clamps to non-negative. Returns a new object.
 */
export function setPointValues(
  current: FactionPoints,
  patch: Partial<FactionPoints>,
): FactionPoints {
  return {
    blue: Math.max(0, patch.blue ?? current.blue),
    red: Math.max(0, patch.red ?? current.red),
  };
}

export function createPointsLedger(): {
  get: () => FactionPoints;
  set: (patch: Partial<FactionPoints>) => void;
} {
  let state: FactionPoints = { blue: 0, red: 0 };
  return {
    get: () => state,
    set: (patch: Partial<FactionPoints>) => {
      state = setPointValues(state, patch);
    },
  };
}
