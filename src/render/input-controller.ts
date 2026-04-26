// The mouse-input wiring. Owns:
//   - the renderer-only "selectedUnitId" state (no sim impact)
//   - the command queue submitted to the sim driver each tick
//   - canvas pointer event handlers that translate clicks into
//     sim commands (TrainUnit on button click, AssignWorkerToNode
//     on click-select-then-click-node)
//   - raycasting against unit + node meshes
//
// RTS conventions: units spawn at their production building (the HQ,
// for now) — the player does not tile-place units. Tile placement is
// a building primitive that arrives in Phase 3 if/when production
// buildings exist. The player's spatial micro is "select a worker,
// click a node to assign harvest" — same flow as every RTS in the
// genre.
//
// Sim is the source of truth for what's clickable (positions, alive
// flags, ownership). The controller reads sim state but never writes
// it — commands are how state changes (PRD §3.3 boundary).

import * as THREE from 'three';
import { CommandKind, type Command } from '../sim/commands';
import type { Sim } from '../sim/sim';
import type { Faction, UnitKind } from '../sim/types';

export interface InputControllerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  unitMeshes: ReadonlyMap<number, THREE.Group>;
  nodeMeshes: ReadonlyMap<number, THREE.Group>;
  sim: Sim;
  playerFaction: Faction;
}

export class InputController {
  private selectedUnitId: number | null = null;
  private readonly queue: Command[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly opts: InputControllerOptions;

  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onContextMenu = (e: MouseEvent) => e.preventDefault();
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

  constructor(opts: InputControllerOptions) {
    this.opts = opts;
    opts.canvas.addEventListener('pointerdown', this.onPointerDown);
    opts.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  detach(): void {
    const c = this.opts.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // Called by the buildables panel when a unit-kind button is clicked.
  // Queues an immediate TrainUnit command — the unit spawns at the HQ
  // on the next sim tick, exactly like every RTS in the genre.
  trainUnit(kind: UnitKind): void {
    this.queue.push({
      kind: CommandKind.TrainUnit,
      faction: this.opts.playerFaction,
      unitKind: kind,
    });
    // Selecting and training are independent — clear selection so the
    // ring doesn't linger on a unit the player isn't focused on.
    this.selectedUnitId = null;
  }

  // Sim-driver pulls commands here each tick. Clears the queue.
  takeQueued(): Command[] {
    if (this.queue.length === 0) return [];
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  getSelectedUnitId(): number | null {
    return this.selectedUnitId;
  }

  // ----- event handlers --------------------------------------------------

  private handlePointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      // Right-click deselects, matches AoE/SC convention.
      this.selectedUnitId = null;
      return;
    }
    if (e.button !== 0) return;

    // Try unit hit first (more specific). Click on your own unit → select.
    const unitHit = this.pickOwnedUnit(e);
    if (unitHit !== null) {
      this.selectedUnitId = unitHit;
      return;
    }

    // If a unit is selected, the next click on a node assigns the worker.
    if (this.selectedUnitId !== null) {
      const nodeHit = this.pickLiveNode(e);
      if (nodeHit !== null) {
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
      // Click on empty space → deselect.
      this.selectedUnitId = null;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.selectedUnitId = null;
  }

  // ----- raycasting helpers ---------------------------------------------

  private updatePointer(e: PointerEvent): void {
    const rect = this.opts.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.opts.camera);
  }

  private pickOwnedUnit(e: PointerEvent): number | null {
    this.updatePointer(e);
    const targets: THREE.Object3D[] = [];
    for (const g of this.opts.unitMeshes.values()) {
      if (g.visible) targets.push(g);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj !== null) {
        const ud = obj.userData as { unitId?: number };
        if (typeof ud.unitId === 'number') {
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
