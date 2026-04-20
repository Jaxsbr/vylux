// Training flow — pure orchestrator for HQ unit production.
// Reads the energy ledger, deducts cost, finds a free adjacent spawn tile.
// No scene imports. The caller (main.ts) wires scene mutations after calling trainUnit.
// Units spawn on a free tile adjacent to HQ. Failure modes: insufficient-energy
// or no-free-adjacent-tile (fully-enclosed HQ at train time — the enclosure guard
// at placement time should prevent this in practice).

import type { FactionId } from './placement';
import type { FactionEnergy } from './economy';
import { subtractEnergy } from './economy';
import { UNIT_COSTS, type UnitKind } from './units-config';
import { NODE_POSITIONS } from './energy-node';

// The 8 neighbours of a tile, ordered by preference (cardinal then diagonal).
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
  | { ok: false; reason: 'insufficient-energy' | 'no-free-adjacent-tile' };

/**
 * Attempt to train a unit of the given kind for the given faction.
 *
 * Finds a free tile adjacent to the HQ for the unit to spawn on. Failure modes:
 *   - insufficient-energy: caller cannot afford the unit.
 *   - no-free-adjacent-tile: all 8 HQ neighbours are occupied (edge case; the
 *     HQ-enclosure guard at placement time should prevent this state occurring).
 *
 * Pure output: returns a TrainResult. The caller is responsible for:
 *   1. Applying `newEnergy` to the energy ledger.
 *   2. Building the unit mesh at the returned `spawnTile`.
 *
 * @param energy      Current energy ledger state.
 * @param faction     Which faction is training.
 * @param kind        Which unit type to train.
 * @param hqX         HQ tile X.
 * @param hqY         HQ tile Y.
 * @param isOccupied  Callback — returns true for any tile that cannot host a new unit.
 * @param gridSize    Grid side length (default 20).
 */
export function trainUnit(
  energy: FactionEnergy,
  faction: FactionId,
  kind: UnitKind,
  hqX: number,
  hqY: number,
  isOccupied: OccupiedCheck,
  gridSize = 20,
): TrainResult {
  const cost = UNIT_COSTS[kind];
  if (energy[faction] < cost) {
    return { ok: false, reason: 'insufficient-energy' };
  }
  const spawnTile = findFreeNeighbour(hqX, hqY, gridSize, isOccupied);
  if (spawnTile === null) {
    return { ok: false, reason: 'no-free-adjacent-tile' };
  }
  const newEnergy = subtractEnergy(energy, faction, cost);
  return { ok: true, spawnTile, newEnergy };
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
