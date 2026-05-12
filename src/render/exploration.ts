// Shared explored-tile bitmap for the player faction.
//
// Why this exists: fog of war has two presentation concerns that both
// need "has the player ever seen this tile?":
//
//   1. FogOverlay paints explored vs. unexplored at different alpha.
//   2. SimRenderer decides whether to show enemy HQ / structures / units.
//
// Before this module, FogOverlay owned the bitmap privately and
// SimRenderer fell back to "is the position in current vision?", which
// meant enemy entities disappeared the instant you panned away from a
// friendly unit even though the fog stayed lifted. By extracting the
// bitmap, both consumers see the same persistent "explored" set and
// enemy entities stay visible on tiles the player has already uncovered.

import { GRID_CONSTANTS } from '../grid';
import { toFloat } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import { HQ_VISION_RADIUS, STRUCTURE_STATS, UNIT_STATS } from '../sim/units-config';

export class Exploration {
  private readonly sim: Sim;
  private readonly playerFaction: Faction;
  private readonly bypassVision: boolean;
  private readonly explored: Uint8Array;
  private lastTick = -1;

  constructor(sim: Sim, playerFaction: Faction, bypassVision: boolean) {
    this.sim = sim;
    this.playerFaction = playerFaction;
    this.bypassVision = bypassVision;
    const N = GRID_CONSTANTS.gridSize;
    this.explored = new Uint8Array(N * N);
    if (!bypassVision) this.update();
  }

  update(): void {
    if (this.bypassVision) return;
    if (this.sim.state.tick === this.lastTick) return;
    this.lastTick = this.sim.state.tick;
    this.mark();
  }

  isTileExplored(tx: number, ty: number): boolean {
    if (this.bypassVision) return true;
    const N = GRID_CONSTANTS.gridSize;
    if (tx < 0 || tx >= N || ty < 0 || ty >= N) return false;
    return this.explored[ty * N + tx] === 1;
  }

  isPositionExplored(x: number, y: number): boolean {
    return this.isTileExplored(Math.floor(x), Math.floor(y));
  }

  // Direct read access for FogOverlay's per-pixel paint loop, which
  // wants the raw byte rather than going through bounds-checked getters
  // for every pixel.
  rawBitmap(): Uint8Array {
    return this.explored;
  }

  private mark(): void {
    const N = GRID_CONSTANTS.gridSize;
    const state = this.sim.state;
    const fs = state.factions[this.playerFaction];

    this.markCircle(toFloat(fs.hqX), toFloat(fs.hqY), toFloat(HQ_VISION_RADIUS), N);

    for (const u of state.units) {
      if (!u.alive || u.faction !== this.playerFaction) continue;
      const r = toFloat(UNIT_STATS[u.kind].visionRadius);
      this.markCircle(toFloat(u.x), toFloat(u.y), r, N);
    }

    for (const s of state.structures) {
      if (!s.alive || s.faction !== this.playerFaction) continue;
      if (s.kind !== 'workPod') continue;
      if (s.buildTicksRemaining > 0) continue;
      const r = toFloat(STRUCTURE_STATS.workPod.visionRadius);
      this.markCircle(toFloat(s.x), toFloat(s.y), r, N);
    }
  }

  private markCircle(cx: number, cy: number, r: number, N: number): void {
    const rSq = r * r;
    const txMin = Math.max(0, Math.floor(cx - r));
    const txMax = Math.min(N - 1, Math.ceil(cx + r));
    const tyMin = Math.max(0, Math.floor(cy - r));
    const tyMax = Math.min(N - 1, Math.ceil(cy + r));
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const idx = ty * N + tx;
        if (this.explored[idx] === 1) continue;
        const dx = (tx + 0.5) - cx;
        const dy = (ty + 0.5) - cy;
        if (dx * dx + dy * dy <= rSq) this.explored[idx] = 1;
      }
    }
  }
}
