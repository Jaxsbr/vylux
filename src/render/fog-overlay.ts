// Phase 3.9.4 — Fog of war (v4, the right metaphor).
//
// Earlier attempts framed fog as "vision adds light to the grid."
// That's the wrong metaphor for a Tron map: the player intuits
// "explore = uncover the map," not "explore = add glow to it." So
// the grid should be visible-by-default in lit regions, and *covered*
// by a dark layer in regions you haven't seen.
//
// v4 inverts the painter:
//
//   currently visible      → α = 0       (no overlay; bright grid shines through)
//   explored not visible   → α ≈ 0.55    (mid-darken; the grid fades to memory)
//   never explored         → α ≈ 0.92    (heavy-darken; the void)
//
// For this to read, the base grid had to get brighter — `grid.ts`
// dividerEmissiveIntensity bumped from 0.4 to 1.2. Without that, the
// dark overlay had nothing to obscure (the v1 fog hit this exact
// failure mode and produced "nothing visible changed").
//
// The CPU paints a single canvas where each pixel's alpha is the MIN
// of (1) per-source falloff contributions and (2) the explored-vs-
// unexplored baseline. Min, because in this metaphor "the most
// uncovered contributor wins" — a tile reached by any vision pool is
// fully revealed regardless of how many other sources also see it.
// No GPU blend stacking, no compounding, no shader.
//
// Single mesh + single texture; recompute fires only when sim.tick
// advances. Performance: ~30 sources × N×N pixels per recompute (where
// N = gridSize × CANVAS_OVERSAMPLE), with early-exit when a source
// can't reach a pixel via tile-bbox.

import * as THREE from 'three';
import { GRID_CONSTANTS } from '../grid';
import { toFloat } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import { HQ_VISION_RADIUS, STRUCTURE_STATS, UNIT_STATS } from '../sim/units-config';

interface VisionSource { x: number; y: number; radius: number; rSq: number; }

// Sub-tile resolution multiplier for the canvas. 2× = 64×64 for the
// 32×32 grid — enough that LinearFilter smooths cell boundaries into
// a continuous gradient. Higher buys little visual + more cost.
const CANVAS_OVERSAMPLE = 2;

// Inverted falloff: alpha INCREASES from 0 at source center to a
// non-zero value at the vision radius. Beyond the radius, the pixel
// falls through to EXPLORED_ALPHA or UNEXPLORED_ALPHA.
const VISION_CENTER_ALPHA = 0.0;
const FALLOFF_MID = 0.55;
const FALLOFF_MID_ALPHA = 0.18;
const FALLOFF_TAIL = 0.85;
const FALLOFF_TAIL_ALPHA = 0.40;

// "I have walked here" — partial darkening so the grid is visible but
// faded. Reads as ghost / memory of the terrain.
const EXPLORED_ALPHA = 0.55;

// The void. Heavy darkening so the unexplored portion of the map is
// almost completely obscured — the lit / explored portions carve the
// known world out of the dark.
const UNEXPLORED_ALPHA = 0.92;

export class FogOverlay {
  private readonly group: THREE.Group;
  private readonly sim: Sim;
  private readonly playerFaction: Faction;
  private readonly bypassVision: boolean;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;

  private readonly explored: Uint8Array;
  private readonly imageData: ImageData;

  private lastComputedTick = -1;

  constructor(parent: THREE.Group, sim: Sim, playerFaction: Faction, bypassVision: boolean) {
    this.sim = sim;
    this.playerFaction = playerFaction;
    this.bypassVision = bypassVision;

    this.group = new THREE.Group();
    this.group.name = 'fog-overlay';
    parent.add(this.group);

    if (bypassVision) {
      this.group.visible = false;
    }

    const N = GRID_CONSTANTS.gridSize;
    const W = N * CANVAS_OVERSAMPLE;
    this.explored = new Uint8Array(N * N);

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = W;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('FogOverlay: 2d canvas context unavailable');
    this.ctx = ctx;
    this.imageData = ctx.createImageData(W, W);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    // flipY at default (true). With PlaneGeometry + the -π/2 X-rotation
    // we apply, world position at sim tile (0,0) interpolates to UV
    // (0, 1); flipY=true sends canvas (0,0) to V=1, so canvas (tx, ty)
    // lines up with sim tile (tx, ty). Setting flipY=false here was
    // the v2 bug — the explored bitmap rendered mirrored along y.

    // Material: solid black painted at varying alpha. NormalBlending
    // gives output = dst * (1 - src.alpha), so:
    //   - α = 0 → grid passes through unchanged
    //   - α = 0.55 → grid dims to 45% (visible but faded)
    //   - α = 0.92 → grid dims to 8% (the void)
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(
      GRID_CONSTANTS.worldExtent,
      GRID_CONSTANTS.worldExtent,
    );
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    // Sit between the grid plane (y=0) and the entity meshes (y >= 0.1)
    // so the fog covers the grid + grid lines but doesn't obscure
    // entities — units in vision should always be readable, units
    // outside vision are already hidden by SimRenderer.visible=false.
    this.mesh.position.y = 0.05;
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);

    if (!bypassVision) {
      this.recompute();
    }
  }

  update(): void {
    if (this.bypassVision) return;
    if (this.sim.state.tick === this.lastComputedTick) return;
    this.recompute();
  }

  private recompute(): void {
    this.lastComputedTick = this.sim.state.tick;

    const sources = this.collectSources();
    this.markExplored(sources);
    this.paint(sources);
  }

  private collectSources(): VisionSource[] {
    const out: VisionSource[] = [];
    const state = this.sim.state;
    const fs = state.factions[this.playerFaction];
    const hqR = toFloat(HQ_VISION_RADIUS);
    out.push({ x: toFloat(fs.hqX), y: toFloat(fs.hqY), radius: hqR, rSq: hqR * hqR });
    for (const u of state.units) {
      if (!u.alive || u.faction !== this.playerFaction) continue;
      const r = toFloat(UNIT_STATS[u.kind].visionRadius);
      out.push({ x: toFloat(u.x), y: toFloat(u.y), radius: r, rSq: r * r });
    }
    for (const s of state.structures) {
      if (!s.alive || s.faction !== this.playerFaction) continue;
      const r = toFloat(STRUCTURE_STATS[s.kind].visionRadius);
      out.push({ x: toFloat(s.x), y: toFloat(s.y), radius: r, rSq: r * r });
    }
    return out;
  }

  private markExplored(sources: VisionSource[]): void {
    const N = GRID_CONSTANTS.gridSize;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const r = s.radius;
      const txMin = Math.max(0, Math.floor(s.x - r));
      const txMax = Math.min(N - 1, Math.ceil(s.x + r));
      const tyMin = Math.max(0, Math.floor(s.y - r));
      const tyMax = Math.min(N - 1, Math.ceil(s.y + r));
      for (let ty = tyMin; ty <= tyMax; ty++) {
        for (let tx = txMin; tx <= txMax; tx++) {
          const idx = ty * N + tx;
          if (this.explored[idx] === 1) continue;
          const dx = (tx + 0.5) - s.x;
          const dy = (ty + 0.5) - s.y;
          if (dx * dx + dy * dy <= s.rSq) {
            this.explored[idx] = 1;
          }
        }
      }
    }
  }

  private paint(sources: VisionSource[]): void {
    const N = GRID_CONSTANTS.gridSize;
    const W = N * CANVAS_OVERSAMPLE;
    const data = this.imageData.data;

    for (let py = 0; py < W; py++) {
      const cy = (py + 0.5) / CANVAS_OVERSAMPLE;
      const ty = Math.floor(cy);
      for (let px = 0; px < W; px++) {
        const cx = (px + 0.5) / CANVAS_OVERSAMPLE;
        const tx = Math.floor(cx);

        // Baseline: explored or unexplored darkness.
        let alpha = (tx >= 0 && tx < N && ty >= 0 && ty < N
          && this.explored[ty * N + tx] === 1)
          ? EXPLORED_ALPHA
          : UNEXPLORED_ALPHA;

        // Active vision: the most-transparent contribution wins. Start
        // from baseline; any source within range can only LOWER alpha.
        for (let i = 0; i < sources.length; i++) {
          const s = sources[i];
          const dx = s.x - cx;
          const dy = s.y - cy;
          const distSq = dx * dx + dy * dy;
          if (distSq >= s.rSq) continue;
          const t = Math.sqrt(distSq) / s.radius; // 0..1
          const a = falloff(t);
          if (a < alpha) alpha = a;
        }

        const pi = (py * W + px) * 4;
        data[pi] = 0;
        data[pi + 1] = 0;
        data[pi + 2] = 0;
        data[pi + 3] = Math.round(255 * alpha);
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}

// Inverted radial falloff: alpha rises from 0 at source center to
// FALLOFF_TAIL_ALPHA at the vision radius edge. Smooth piecewise
// linear so the boundary isn't a hard line.
function falloff(t: number): number {
  if (t <= 0) return VISION_CENTER_ALPHA;
  if (t >= 1) return FALLOFF_TAIL_ALPHA;
  if (t < FALLOFF_MID) {
    const k = t / FALLOFF_MID;
    return VISION_CENTER_ALPHA + (FALLOFF_MID_ALPHA - VISION_CENTER_ALPHA) * k;
  }
  if (t < FALLOFF_TAIL) {
    const k = (t - FALLOFF_MID) / (FALLOFF_TAIL - FALLOFF_MID);
    return FALLOFF_MID_ALPHA + (FALLOFF_TAIL_ALPHA - FALLOFF_MID_ALPHA) * k;
  }
  return FALLOFF_TAIL_ALPHA;
}
