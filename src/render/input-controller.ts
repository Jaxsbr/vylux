// The mouse-input wiring. Owns:
//   - the placement state machine (src/render/placement.ts)
//   - the renderer-only "selectedUnitId" state (no sim impact)
//   - the command queue submitted to the sim driver each tick
//   - canvas pointer event handlers that translate clicks into
//     state-machine transitions and sim commands
//   - raycasting against tile + entity meshes
//
// Sim is the source of truth for what's clickable (positions, alive
// flags, ownership). The controller reads sim state but never writes
// it — commands are how state changes (PRD §3.3 boundary).

import * as THREE from 'three';
import { CommandKind, type Command } from '../sim/commands';
import type { Sim } from '../sim/sim';
import type { Faction, UnitKind } from '../sim/types';
import { GRID_CONSTANTS } from '../grid';
import {
  enterPlacement,
  exitPlacement,
  INITIAL_PLACEMENT,
  setHoveredTile,
  tryPlace,
  type PlacementState,
} from './placement';

export interface InputControllerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  tileMeshes: THREE.Mesh[];
  // Read-only views used for raycasting + ownership checks.
  unitMeshes: ReadonlyMap<number, THREE.Group>;
  nodeMeshes: ReadonlyMap<number, THREE.Group>;
  sim: Sim;
  playerFaction: Faction;
}

export class InputController {
  private placement: PlacementState = INITIAL_PLACEMENT;
  private selectedUnitId: number | null = null;
  private readonly queue: Command[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly opts: InputControllerOptions;

  // Bound handler refs so we can detach cleanly.
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onContextMenu = (e: MouseEvent) => e.preventDefault();
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

  constructor(opts: InputControllerOptions) {
    this.opts = opts;
    opts.canvas.addEventListener('pointermove', this.onPointerMove);
    opts.canvas.addEventListener('pointerdown', this.onPointerDown);
    opts.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  detach(): void {
    const c = this.opts.canvas;
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // Called by the buildables panel when a unit-kind button is clicked.
  enterPlacement(kind: UnitKind): void {
    this.placement = enterPlacement(this.placement, kind);
    this.opts.canvas.style.cursor = 'crosshair';
    // Selecting a unit and starting placement are mutually exclusive
    // — clear any selection so the on-screen state is unambiguous.
    this.selectedUnitId = null;
  }

  // Sim-driver pulls commands here each tick. Clears the queue.
  takeQueued(): Command[] {
    if (this.queue.length === 0) return [];
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  getPlacement(): PlacementState {
    return this.placement;
  }

  getSelectedUnitId(): number | null {
    return this.selectedUnitId;
  }

  // ----- event handlers --------------------------------------------------

  private handlePointerMove(e: PointerEvent): void {
    if (this.placement.mode !== 'placement') {
      // Hovered tile only matters during placement (ghost mesh follows).
      // Idle / selected modes don't render a hover highlight today.
      return;
    }
    const tile = this.pickTile(e);
    this.placement = setHoveredTile(this.placement, tile);
  }

  private handlePointerDown(e: PointerEvent): void {
    // Right-click cancels placement / deselects.
    if (e.button === 2) {
      this.cancel();
      return;
    }
    if (e.button !== 0) return; // only left-click acts on the world

    if (this.placement.mode === 'placement') {
      const tile = this.pickTile(e);
      if (tile === null) {
        // Click outside the grid in placement mode → cancel (matches the
        // prototype's "click outside grid exits placement" rule).
        this.cancel();
        return;
      }
      const result = tryPlace(this.placement, GRID_CONSTANTS.gridSize, tile.x, tile.y);
      if (result.ok) {
        this.queue.push({
          kind: CommandKind.TrainUnit,
          faction: this.opts.playerFaction,
          unitKind: result.unitKind,
          x: result.x,
          y: result.y,
        });
        this.placement = result.state;
        this.opts.canvas.style.cursor = '';
      }
      return;
    }

    // Idle mode — try unit hit first (more specific), then node, then deselect.
    const unitHit = this.pickOwnedUnit(e);
    if (unitHit !== null) {
      this.selectedUnitId = unitHit;
      return;
    }

    if (this.selectedUnitId !== null) {
      const nodeHit = this.pickLiveNode(e);
      if (nodeHit !== null) {
        // Worker → node assignment. Non-worker selections currently have
        // no meaningful "click target" so we ignore the click; selection
        // stays.
        const sel = this.opts.sim.state.units.find((u) => u.id === this.selectedUnitId);
        if (sel && sel.kind === 'worker' && sel.faction === this.opts.playerFaction) {
          this.queue.push({
            kind: CommandKind.AssignWorkerToNode,
            workerId: sel.id,
            nodeId: nodeHit,
          });
          this.selectedUnitId = null;
        }
        return;
      }
      // Click on empty grid → deselect.
      this.selectedUnitId = null;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.cancel();
  }

  private cancel(): void {
    this.placement = exitPlacement(this.placement);
    this.selectedUnitId = null;
    this.opts.canvas.style.cursor = '';
  }

  // ----- raycasting helpers ---------------------------------------------

  private updatePointer(e: PointerEvent): void {
    const rect = this.opts.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.opts.camera);
  }

  private pickTile(e: PointerEvent): { x: number; y: number } | null {
    this.updatePointer(e);
    const hits = this.raycaster.intersectObjects(this.opts.tileMeshes, false);
    if (hits.length === 0) return null;
    const ud = hits[0].object.userData as { tileX?: number; tileY?: number };
    if (typeof ud.tileX !== 'number' || typeof ud.tileY !== 'number') return null;
    return { x: ud.tileX, y: ud.tileY };
  }

  private pickOwnedUnit(e: PointerEvent): number | null {
    this.updatePointer(e);
    // Collect unit Group children (unit meshes have userData.unitId set).
    const targets: THREE.Object3D[] = [];
    for (const g of this.opts.unitMeshes.values()) {
      if (g.visible) targets.push(g);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      // Walk up to the Group with userData.unitId.
      let obj: THREE.Object3D | null = h.object;
      while (obj !== null) {
        const ud = obj.userData as { unitId?: number };
        if (typeof ud.unitId === 'number') {
          // Verify ownership + alive.
          const u = this.opts.sim.state.units.find((x) => x.id === ud.unitId);
          if (u && u.alive && u.faction === this.opts.playerFaction) return u.id;
          return null;
        }
        obj = obj.parent;
      }
    }
    return null;
  }

  private pickLiveNode(e: PointerEvent): number | null {
    this.updatePointer(e);
    const targets: THREE.Object3D[] = [];
    for (const g of this.opts.nodeMeshes.values()) {
      if (g.visible) targets.push(g);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj !== null) {
        const ud = obj.userData as { nodeId?: number };
        if (typeof ud.nodeId === 'number') {
          const n = this.opts.sim.state.nodes.find((x) => x.id === ud.nodeId);
          if (n && n.alive) return n.id;
          return null;
        }
        obj = obj.parent;
      }
    }
    return null;
  }
}
