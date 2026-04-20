// advance.ts — pure raider auto-advance toward nearest enemy.
//
// Raiders target: workers + defenders + HQ (nearest by Euclidean distance).
// Retaliation priority: if a defender hit this raider within RETALIATE_WINDOW_TICKS,
// advance toward that defender first.
//
// When a raider already has a target in attack range it stops moving — the
// auto-attack loop in combat.ts takes over from that point.
//
// State-ownership: this module is pure. It calls raider.moveTo() which is a
// method on RaiderBundle — not a scene mutation. No imports from scene.ts or
// input.ts.

import type { FactionId } from './placement';
import { RETALIATE_WINDOW_TICKS } from './units-config';
import { getRaiderRetaliation, getCombatTickCounter } from './combat';

// Minimal shape needed — avoids coupling to heavy Three.js bundle types.
export type AdvanceRaider = {
  faction: FactionId;
  tileX: number;
  tileY: number;
  targetTileX: number;
  targetTileY: number;
  hp: number;
  moveTo: (tileX: number, tileY: number) => void;
};

export type AdvanceTarget = {
  tileX: number;
  tileY: number;
  hp: number;
};

// Identified defender — has a unitId for retaliation matching.
export type AdvanceDefender = AdvanceTarget & {
  unitId?: number;
};

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function tileDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Advance all raiders in the given array one step toward their nearest enemy.
 *
 * Pure in the functional sense: no Three.js, no scene, no global state.
 * Calls raider.moveTo() which is a method on the bundle (not a scene write).
 *
 * Targeting priority:
 *   1. Retaliate: if a defender hit this raider within RETALIATE_WINDOW_TICKS,
 *      advance toward that defender.
 *   2. Nearest enemy: closest of {workers, defenders, HQ} by Euclidean tile distance.
 *      Tiebreaker: workers before defenders before HQ (order of evaluation).
 *
 * @param raiders        Raiders to advance (all alive, already filtered to one faction if needed).
 * @param enemyWorkers   Living enemy workers.
 * @param enemyDefenders Living enemy defenders (with optional unitId for retaliation).
 * @param enemyHq        The enemy HQ target (always present; hp may be 0).
 * @param attackRange    Raider attack range in Chebyshev distance (from UNIT_STATS.raider.range).
 */
export function advanceRaiders(
  raiders: AdvanceRaider[],
  enemyWorkers: AdvanceTarget[],
  enemyDefenders: AdvanceDefender[],
  enemyHq: AdvanceTarget,
  attackRange: number,
): void {
  const currentTick = getCombatTickCounter();

  for (const raider of raiders) {
    if (raider.hp <= 0) continue;

    // -- Retaliation: check WeakMap state set by combat.ts --
    const retState = getRaiderRetaliation(raider);
    if (
      retState !== undefined &&
      currentTick - retState.lastHitTick <= RETALIATE_WINDOW_TICKS
    ) {
      const retDef = enemyDefenders.find(
        (d) => d.unitId === retState.lastHitDefenderId && d.hp > 0,
      );
      if (retDef !== undefined) {
        const cheb = chebyshev(raider.tileX, raider.tileY, retDef.tileX, retDef.tileY);
        if (cheb <= attackRange) {
          // In range — let combat handle it; no moveTo needed.
          continue;
        }
        // Out of range — advance toward the retaliation target.
        if (raider.targetTileX !== retDef.tileX || raider.targetTileY !== retDef.tileY) {
          raider.moveTo(retDef.tileX, retDef.tileY);
        }
        continue;
      }
    }

    // -- Nearest enemy targeting --
    // Build target list: workers first, then defenders, then HQ (if alive).
    const targets: AdvanceTarget[] = [
      ...enemyWorkers.filter((w) => w.hp > 0),
      ...enemyDefenders.filter((d) => d.hp > 0),
      ...(enemyHq.hp > 0 ? [enemyHq] : []),
    ];

    if (targets.length === 0) continue;

    // Find nearest target by Euclidean tile distance.
    let nearest: AdvanceTarget | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      const d = tileDist(raider.tileX, raider.tileY, t.tileX, t.tileY);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    if (nearest === null) continue;

    // Already within attack range — let combat.ts handle it, don't move.
    const cheb = chebyshev(raider.tileX, raider.tileY, nearest.tileX, nearest.tileY);
    if (cheb <= attackRange) continue;

    // Only issue moveTo when target tile changed (avoids spamming moveTo every frame).
    if (raider.targetTileX !== nearest.tileX || raider.targetTileY !== nearest.tileY) {
      raider.moveTo(nearest.tileX, nearest.tileY);
    }
  }
}

/**
 * Convenience wrapper that filters by faction then delegates to advanceRaiders.
 * Use this from main.ts and e2e-hook.ts where raiders are in a mixed array.
 */
export function advanceRaidersFaction(
  faction: FactionId,
  allRaiders: AdvanceRaider[],
  enemyWorkers: AdvanceTarget[],
  enemyDefenders: AdvanceDefender[],
  enemyHq: AdvanceTarget,
  attackRange: number,
): void {
  const mine = allRaiders.filter((r) => r.faction === faction && r.hp > 0);
  advanceRaiders(mine, enemyWorkers, enemyDefenders, enemyHq, attackRange);
}
