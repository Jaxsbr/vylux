// Per-faction explored-tile view for the player faction.
//
// Phase C.6.7: the explored set now lives in the deterministic sim
// (`SimState.explored`, seeded at match start and advanced each tick by
// `advanceExploration`). This class is a thin VIEW over the sim's
// player-faction bitmap — it no longer recomputes its own. Before this,
// the render owned a parallel explored bitmap that only the human saw and
// the AI couldn't read; now there is one source of truth, shared by the
// sim (AI scouting, C.6.8+) and the render.
//
// Two render consumers read it:
//   1. FogOverlay paints explored vs. unexplored at different alpha.
//   2. SimRenderer decides whether to show enemy HQ / structures / units.
// Both see the same persistent "explored" set, so enemy entities stay
// visible on tiles the player has already uncovered even after panning
// away. `bypassVision` (observer / full-vision views) reports everything
// explored.

import { GRID_CONSTANTS } from '../grid';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import { debugReveal } from './debug-reveal';

export class Exploration {
  private readonly sim: Sim;
  private readonly playerFaction: Faction;
  private readonly bypassVision: boolean;

  constructor(sim: Sim, playerFaction: Faction, bypassVision: boolean) {
    this.sim = sim;
    this.playerFaction = playerFaction;
    this.bypassVision = bypassVision;
  }

  // Retained for call-site compatibility (FogOverlay calls it before
  // painting). The sim owns the explored set and advances it every tick,
  // so there is nothing to recompute on the render side.
  update(): void {
    // no-op — see class comment.
  }

  isTileExplored(tx: number, ty: number): boolean {
    if (this.bypassVision || debugReveal.all) return true;
    const N = GRID_CONSTANTS.gridSize;
    if (tx < 0 || tx >= N || ty < 0 || ty >= N) return false;
    return this.sim.state.explored[this.playerFaction][ty * N + tx] === 1;
  }

  isPositionExplored(x: number, y: number): boolean {
    return this.isTileExplored(Math.floor(x), Math.floor(y));
  }

  // Direct byte access for FogOverlay's per-pixel paint loop, which wants
  // the raw bitmap rather than going through the bounds-checked getter for
  // every pixel. This is the sim's live per-faction array (read-only here).
  rawBitmap(): Uint8Array {
    return this.sim.state.explored[this.playerFaction];
  }
}
