// Fog of war — persistent reveal.
//
// Two states per tile:
//
//   explored        → α = 0       (no overlay; bright grid shines through)
//   never explored  → α ≈ 0.92    (heavy-darken; the void)
//
// Exploration is permanent: any tile a friendly unit, HQ, or work pod
// has ever had in vision stays uncovered. There is no third
// "explored-but-not-currently-visible" state and no per-source falloff
// — a band of dimmer light around fresh vision reads as inconsistency,
// not flavour, when the explored set is permanent.

import * as THREE from 'three';
import { GRID_CONSTANTS } from '../grid';
import type { Sim } from '../sim/sim';
import type { Exploration } from './exploration';

// Sub-tile resolution multiplier for the canvas. 2× = 64×64 for the
// 32×32 grid — enough that LinearFilter smooths cell boundaries into
// a continuous gradient. Higher buys little visual + more cost.
const CANVAS_OVERSAMPLE = 2;

// Uniform reveal: every tile the player has explored renders at the
// same alpha as a tile under direct vision. No per-source falloff, no
// "spotlight" around the unit — once you've seen a tile, it stays
// fully revealed (the explored set is persistent), so a dim band of
// older exploration around a bright circle of fresh vision would read
// as an inconsistency rather than a feature.
const EXPLORED_ALPHA = 0.0;

// The void. Heavy darkening so the unexplored portion of the map is
// almost completely obscured — the lit / explored portions carve the
// known world out of the dark.
const UNEXPLORED_ALPHA = 0.92;

export class FogOverlay {
  private readonly group: THREE.Group;
  private readonly sim: Sim;
  private readonly bypassVision: boolean;
  private readonly exploration: Exploration;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;

  private readonly imageData: ImageData;

  private lastComputedTick = -1;

  constructor(
    parent: THREE.Group,
    sim: Sim,
    bypassVision: boolean,
    exploration: Exploration,
  ) {
    this.sim = sim;
    this.bypassVision = bypassVision;
    this.exploration = exploration;

    this.group = new THREE.Group();
    this.group.name = 'fog-overlay';
    parent.add(this.group);

    if (bypassVision) {
      this.group.visible = false;
    }

    const N = GRID_CONSTANTS.gridSize;
    const W = N * CANVAS_OVERSAMPLE;

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
    this.exploration.update();
    this.paint();
  }

  private paint(): void {
    const N = GRID_CONSTANTS.gridSize;
    const W = N * CANVAS_OVERSAMPLE;
    const data = this.imageData.data;
    const explored = this.exploration.rawBitmap();
    const exploredA = Math.round(255 * EXPLORED_ALPHA);
    const voidA = Math.round(255 * UNEXPLORED_ALPHA);

    for (let py = 0; py < W; py++) {
      const cy = (py + 0.5) / CANVAS_OVERSAMPLE;
      const ty = Math.floor(cy);
      for (let px = 0; px < W; px++) {
        const cx = (px + 0.5) / CANVAS_OVERSAMPLE;
        const tx = Math.floor(cx);

        const inBounds = tx >= 0 && tx < N && ty >= 0 && ty < N;
        const a = inBounds && explored[ty * N + tx] === 1 ? exploredA : voidA;

        const pi = (py * W + px) * 4;
        data[pi] = 0;
        data[pi + 1] = 0;
        data[pi + 2] = 0;
        data[pi + 3] = a;
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
