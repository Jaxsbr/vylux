// Training flow — pure-ish orchestrator for HQ unit production.
// Reads the energy ledger, deducts cost, returns spawn-at-HQ tile.
// No scene imports. The caller (main.ts) wires scene mutations after calling trainUnit.
// Units always spawn at the HQ tile; callers issue moveTo(spawnTile) after build.
// The only failure mode is insufficient-energy — walled HQ no longer blocks training.

import type { FactionId } from './placement';
import type { FactionEnergy } from './economy';
import { subtractEnergy } from './economy';
import { UNIT_COSTS, type UnitKind } from './units-config';
import { NODE_POSITIONS } from './energy-node';

// The 8 neighbours of a tile, ordered by preference (adjacent cardinal then diagonal).
// Kept for findFreeNeighbour (still used in fallback code paths in main.ts and e2e).
const NEIGHBOUR_OFFSETS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export type OccupiedCheck = (tileX: number, tileY: number) => boolean;

/**
 * Find the first free 8-neighbour tile adjacent to (hqX, hqY).
 * A tile is free when:
 *   - within grid bounds [0, gridSize)
 *   - not reported occupied by isOccupied (workers, defenders, raiders, other HQ, nodes)
 *
 * Returns null if all 8 neighbours are blocked.
 * Retained for fallback/legacy callers; trainUnit no longer uses it.
 */
export function findFreeNeighbour(
  hqX: number,
  hqY: number,
  gridSize: number,
  isOccupied: OccupiedCheck,
): { tileX: number; tileY: number } | null {
  for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
    const tx = hqX + dx;
    const ty = hqY + dy;
    if (tx < 0 || tx >= gridSize || ty < 0 || ty >= gridSize) continue;
    if (!isOccupied(tx, ty)) {
      return { tileX: tx, tileY: ty };
    }
  }
  return null;
}

export type TrainResult =
  | { ok: true; spawnTile: { tileX: number; tileY: number }; newEnergy: FactionEnergy }
  | { ok: false; reason: 'insufficient-energy' };

/**
 * Attempt to train a unit of the given kind for the given faction.
 *
 * Pure output: returns a TrainResult. The caller is responsible for:
 *   1. Applying `newEnergy` to the energy ledger.
 *   2. Building the unit mesh at the returned spawnTile (= HQ tile).
 *   3. Issuing moveTo(hq.spawnTile) on the new unit so it walks to the spawn point.
 *
 * Units always spawn at the HQ tile — the only failure mode is insufficient energy.
 * A walled HQ can always train units; they overlap briefly then walk to the spawn point.
 *
 * @param energy   Current energy ledger state.
 * @param faction  Which faction is training.
 * @param kind     Which unit type to train.
 * @param hqX      HQ tile X.
 * @param hqY      HQ tile Y.
 */
export function trainUnit(
  energy: FactionEnergy,
  faction: FactionId,
  kind: UnitKind,
  hqX: number,
  hqY: number,
): TrainResult {
  const cost = UNIT_COSTS[kind];
  if (energy[faction] < cost) {
    return { ok: false, reason: 'insufficient-energy' };
  }
  const newEnergy = subtractEnergy(energy, faction, cost);
  return { ok: true, spawnTile: { tileX: hqX, tileY: hqY }, newEnergy };
}

/**
 * Build the set of occupied tiles for the blue HQ neighbour check.
 * Includes: all unit tiles (workers, defenders, raiders), red HQ tile,
 * blue HQ tile itself, and all node positions.
 *
 * This is a convenience used by main.ts to build the isOccupied callback.
 */
export function buildOccupiedSet(
  units: ReadonlyArray<{ tileX: number; tileY: number }>,
  hqTiles: ReadonlyArray<{ tileX: number; tileY: number }>,
): Set<string> {
  const set = new Set<string>();
  for (const u of units) {
    set.add(`${u.tileX},${u.tileY}`);
  }
  for (const h of hqTiles) {
    set.add(`${h.tileX},${h.tileY}`);
  }
  for (const [nx, ny] of NODE_POSITIONS) {
    set.add(`${nx},${ny}`);
  }
  return set;
}
