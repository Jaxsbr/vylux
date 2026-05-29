// Phase C.2 — minimap (SC2 command-card model: bottom-right region).
//
// A fixed-footprint top-down map of the arena (64×64 since C.6.5; scale is
// derived from GRID_CONSTANTS, not hard-coded). Entity blips are drawn
// only when the entity's 3D mesh is visible, so the minimap mirrors the fog
// exactly without re-deriving vision here. Click anywhere on it to recentre
// the camera there.

import type { Faction } from '../sim/types';
import type { Sim } from '../sim/sim';
import { toFloat } from '../sim/fixed';
import { GRID_CONSTANTS } from '../grid';
import { tileFloatToWorld } from './scene';
import { themeForFaction, RESOURCE_COLOR } from './factions/theme';

const MAP_PX = 150;
const NODE_COLOR = '#ffd166'; // energy nodes (gold)

// Anything exposing a `.visible` flag — THREE.Group satisfies this, so the
// SimRenderer's mesh maps pass straight through.
interface Visible { visible: boolean; }

export interface MinimapSource {
  unitMeshMap: ReadonlyMap<number, Visible>;
  nodeMeshMap: ReadonlyMap<number, Visible>;
  structureMeshMap: ReadonlyMap<number, Visible>;
  hqMeshMap: ReadonlyMap<Faction, Visible>;
}

export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(
    playerFaction: Faction,
    parent: HTMLElement,
    onClickWorld: (worldX: number, worldZ: number) => void,
  ) {
    const tint = themeForFaction(playerFaction);

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:8',
      'padding:6px', 'border-radius:6px',
      'background:rgba(7,9,12,0.82)',
      `border:1px solid ${tint.glow}`,
      `box-shadow:0 0 14px ${tint.glowSoft}`,
      'pointer-events:auto', 'line-height:0',
    ].join(';');

    this.canvas = document.createElement('canvas');
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.canvas.width = MAP_PX * dpr;
    this.canvas.height = MAP_PX * dpr;
    this.canvas.style.cssText = `width:${MAP_PX}px;height:${MAP_PX}px;display:block;cursor:pointer;`;
    this.root.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    this.ctx = ctx;
    if (ctx) ctx.scale(dpr, dpr);

    // Click-to-pan: map the click point back to a tile, then to world.
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { gridSize } = GRID_CONSTANTS;
      const tileX = (cx / MAP_PX) * gridSize - 0.5;
      const tileY = (cy / MAP_PX) * gridSize - 0.5;
      const w = tileFloatToWorld(tileX, tileY);
      onClickWorld(w.x, w.z);
    });

    parent.appendChild(this.root);
  }

  detach(): void {
    this.root.remove();
  }

  // tile coord (0..gridSize-1) → minimap pixel (tile centre).
  private px(tile: number): number {
    return ((tile + 0.5) / GRID_CONSTANTS.gridSize) * MAP_PX;
  }

  update(sim: Sim, src: MinimapSource, cameraTarget: { x: number; z: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = sim.state;

    ctx.clearRect(0, 0, MAP_PX, MAP_PX);
    ctx.fillStyle = 'rgba(10,16,22,0.92)';
    ctx.fillRect(0, 0, MAP_PX, MAP_PX);

    // Resource nodes — gold (energy) / violet (matter) dots, only where
    // discovered (mesh visible).
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (!n.alive) continue;
      if (!src.nodeMeshMap.get(n.id)?.visible) continue;
      this.dot(ctx, toFloat(n.x), toFloat(n.y), 1.8, n.kind === 'matter' ? RESOURCE_COLOR.matter : NODE_COLOR);
    }

    // Work pods — faction squares.
    for (let i = 0; i < s.structures.length; i++) {
      const st = s.structures[i];
      if (!st.alive) continue;
      if (!src.structureMeshMap.get(st.id)?.visible) continue;
      this.square(ctx, toFloat(st.x), toFloat(st.y), 5, themeForFaction(st.faction).primary);
    }

    // Workers — faction dots.
    for (let i = 0; i < s.units.length; i++) {
      const u = s.units[i];
      if (!u.alive) continue;
      if (!src.unitMeshMap.get(u.id)?.visible) continue;
      this.dot(ctx, toFloat(u.x), toFloat(u.y), 1.6, themeForFaction(u.faction).primary);
    }

    // HQs — larger faction squares (drawn last so they sit on top).
    for (const f of [0, 1] as const) {
      if (!src.hqMeshMap.get(f)?.visible) continue;
      const fs = s.factions[f];
      this.square(ctx, toFloat(fs.hqX), toFloat(fs.hqY), 8, themeForFaction(f).primary);
    }

    // Camera-focus marker — a small hollow square at the current look-at,
    // converting world (x, z) back to tile coords (inverse of
    // tileFloatToWorld: tile = world + worldExtent/2 - tileSize/2).
    const half = GRID_CONSTANTS.worldExtent / 2 - GRID_CONSTANTS.tileSize / 2;
    const mx = this.px(cameraTarget.x + half);
    const my = this.px(cameraTarget.z + half);
    const r = 14;
    ctx.strokeStyle = 'rgba(216,232,240,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - r, my - r, r * 2, r * 2);
  }

  private dot(ctx: CanvasRenderingContext2D, tileX: number, tileY: number, radius: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.px(tileX), this.px(tileY), radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private square(ctx: CanvasRenderingContext2D, tileX: number, tileY: number, sizePx: number, color: string): void {
    const cx = this.px(tileX);
    const cy = this.px(tileY);
    ctx.fillStyle = color;
    ctx.fillRect(cx - sizePx / 2, cy - sizePx / 2, sizePx, sizePx);
  }
}
