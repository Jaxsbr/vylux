import { NODE_POINT_RATE } from './economy';
import { addPoints } from './points';
import type { FactionHold, EnergyNodeBundle } from './energy-node';
import type { PointsLedger } from './combat';

export type NodePointsUnit = {
  faction: 'blue' | 'red';
  tileX: number;
  tileY: number;
};

/**
 * Pure: determine which faction holds a node tile.
 * Blue holds if >= 1 blue worker is on the tile and no red worker is.
 * Red holds if >= 1 red worker is on the tile and no blue worker is.
 * Contested (both present) or empty → null.
 */
export function computeNodeHolder(
  node: { tileX: number; tileY: number },
  units: NodePointsUnit[],
): FactionHold {
  let hasBlue = false;
  let hasRed = false;
  for (const u of units) {
    if (u.tileX === node.tileX && u.tileY === node.tileY) {
      if (u.faction === 'blue') hasBlue = true;
      else hasRed = true;
    }
  }
  if (hasBlue && hasRed) return null; // contested
  if (hasBlue) return 'blue';
  if (hasRed) return 'red';
  return null;
}

export type TickNodePointsArgs = {
  nodes: EnergyNodeBundle[];
  units: NodePointsUnit[];
  pointsLedger: PointsLedger;
  dt: number;
};

/**
 * Walk every node, determine its current holder, accrue fractional points,
 * and emit whole points to the ledger. Resets the accumulator when the
 * holder changes (no transfer of partial accumulator to new holder).
 */
export function tickNodePoints({ nodes, units, pointsLedger, dt }: TickNodePointsArgs): void {
  for (const node of nodes) {
    const holder = computeNodeHolder(node, units);

    if (holder !== node.lastHolder) {
      node.pointAccumulator = 0;
      node.lastHolder = holder;
    }

    if (holder === null) continue;

    node.pointAccumulator += NODE_POINT_RATE * dt;

    while (node.pointAccumulator >= 1) {
      addPoints(pointsLedger, holder, 1);
      node.pointAccumulator -= 1;
    }
  }
}
