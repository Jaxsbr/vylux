// Match scoring — single source of truth for the timed-match winner
// decision (consumed by checkWinner in step.ts) AND the HUD scoreboard
// + end-overlay (consumed by the renderer). Defining it once means the
// number the player sees on the scoreboard is exactly the number the
// sim ranks on at the buzzer.
//
// Spine of the score is cumulative resources harvested — `energyHarvested`
// + `matterHarvested` (the honest "how much have you collected" total — see
// FactionState; both are monotonic, never decrement on spend). Workers alive
// and operational structures contribute small flat bonuses so a hoarder who
// never built doesn't outscore a developed economy; harvest still dominates
// by design. All-integer + deterministic (toInt floors each Fixed total) —
// no floats touch the determinism gate.

import { toInt } from './fixed';
import type { Faction, SimState } from './types';

// Score = harvested + workers × WORKER_BONUS + structures × STRUCTURE_BONUS.
// Tunable in playtest; bumping either of these invalidates the timed-match
// winner outcome and therefore the goldens.
export const SCORE_WORKER_BONUS = 10;
export const SCORE_STRUCTURE_BONUS = 30;

export interface ScoreBreakdown {
  faction: Faction;
  /** Cumulative resources (energy + matter) ever deposited at the HQ (floored). */
  harvested: number;
  /** Alive worker count at this instant. */
  workers: number;
  /** Operational (buildTicksRemaining === 0) structure count at this instant. */
  structures: number;
  /** The ranking number — what the buzzer compares and the HUD shows. */
  total: number;
}

export function scoreBreakdown(state: SimState, faction: Faction): ScoreBreakdown {
  let workers = 0;
  for (const u of state.units) {
    if (u.alive && u.faction === faction) workers++;
  }
  let structures = 0;
  for (const s of state.structures) {
    if (s.alive && s.faction === faction && s.buildTicksRemaining === 0) structures++;
  }
  const fs = state.factions[faction];
  const harvested = toInt(fs.energyHarvested) + toInt(fs.matterHarvested);
  const total =
    harvested + workers * SCORE_WORKER_BONUS + structures * SCORE_STRUCTURE_BONUS;
  return { faction, harvested, workers, structures, total };
}

export function matchScore(state: SimState, faction: Faction): number {
  return scoreBreakdown(state, faction).total;
}

// Deterministic score-victory tie-break. Reached when the timer expires
// (or the whole field is mined out) and neither HQ is destroyed. Cascade:
// higher total → higher raw Fixed harvest (catches sub-integer rounding
// in the floor) → higher HQ HP → faction 0. The HQ-HP rung means that
// when two perfect economies tie, the side that was *less* battered
// wins — irrelevant today (no combat) but the natural rule when combat
// returns in Phase E.
export function decideScoreWinner(state: SimState): Faction {
  const s0 = matchScore(state, 0);
  const s1 = matchScore(state, 1);
  if (s0 !== s1) return s0 > s1 ? 0 : 1;
  // Raw Fixed total resources (energy + matter) — catches sub-integer
  // rounding the floored `total` above can't see.
  const h0 = state.factions[0].energyHarvested + state.factions[0].matterHarvested;
  const h1 = state.factions[1].energyHarvested + state.factions[1].matterHarvested;
  if (h0 !== h1) return h0 > h1 ? 0 : 1;
  const hp0 = state.factions[0].hqHp;
  const hp1 = state.factions[1].hqHp;
  if (hp0 !== hp1) return hp0 > hp1 ? 0 : 1;
  return 0;
}
