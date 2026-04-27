// The mouse-input wiring. Owns:
//   - the renderer-only multi-select state (no sim impact)
//   - the command queue submitted to the sim driver each tick
//   - canvas pointer event handlers that translate clicks into
//     sim commands (TrainUnit on button click, AssignWorkerToNode
//     on click-select-then-click-node, MoveUnit on right-click move)
//   - raycasting against unit + node meshes
//
// Phase 3.3 input model:
//   - left-click on owned unit            → replace selection with that unit
//   - shift+left-click on owned unit      → toggle that unit in selection
//   - left-click+drag in empty space      → drag-rect; finalise selects all
//                                            owned units inside the rect
//                                            (shift adds to existing selection)
//   - left-click on a live node           → if any selected workers, assign
//                                            ALL of them to that node
//   - left-click in empty space           → clear selection
//   - right-click on a tile               → MoveUnit for every selected unit
//   - right-click during placement / esc  → cancel placement / selection
//
// Sim is the source of truth for what's clickable (positions, alive
// flags, ownership). The controller reads sim state but never writes
// it — commands are how state changes (PRD §3.3 boundary).

import * as THREE from 'three';
import { CommandKind, type Command } from '../sim/commands';
import type { Sim } from '../sim/sim';
import { findFirstOperationalProduction, findFirstOperationalUpgrade } from '../sim/state';
import type { Faction, UnitKind } from '../sim/types';
import { GRID_CONSTANTS } from '../grid';
import { tileFloatToWorld } from './scene';
import { toFloat } from '../sim/fixed';

// Pixel distance the pointer must move past the down-point before a
// left-button-drag is treated as a drag-rect rather than a click.
// Smaller values feel "twitchy"; larger feel sluggish. 5 px is the SC2
// default ballpark.
const DRAG_THRESHOLD_PX = 5;

export interface InputControllerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  unitMeshes: ReadonlyMap<number, THREE.Group>;
  nodeMeshes: ReadonlyMap<number, THREE.Group>;
  sim: Sim;
  playerFaction: Faction;
}

interface DragState {
  startClientX: number;
  startClientY: number;
  // True once the pointer has moved past DRAG_THRESHOLD_PX. Below the
  // threshold, pointerup falls through to click semantics.
  dragging: boolean;
  // Whether shift was held at pointerdown — locks in additive vs
  // replace semantics for the lifetime of this drag.
  additive: boolean;
}

export class InputController {
  private selectedUnitIds = new Set<number>();
  // When set, the next left-click places a structure of this kind at
  // the clicked tile. null = normal click flow (select / assign / drag).
  // Phase 3.0 introduced this for production buildings; Phase 3.2
  // reuses the slot for upgrade structures (Spires); Phase 3.6 adds
  // supply structures (Pylons).
  private pendingPlacement: 'production' | 'upgrade' | 'supply' | null = null;
  private readonly queue: Command[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly opts: InputControllerOptions;

  // Active left-button drag (if any).
  private drag: DragState | null = null;
  // DOM rect overlay shown during a drag-rect.
  private readonly dragRectEl: HTMLDivElement;

  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onContextMenu = (e: MouseEvent) => e.preventDefault();
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

  constructor(opts: InputControllerOptions) {
    this.opts = opts;
    opts.canvas.addEventListener('pointerdown', this.onPointerDown);
    opts.canvas.addEventListener('pointermove', this.onPointerMove);
    opts.canvas.addEventListener('pointerup', this.onPointerUp);
    opts.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);

    this.dragRectEl = document.createElement('div');
    this.dragRectEl.style.cssText = [
      'position:fixed', 'pointer-events:none', 'display:none',
      'border:1px solid #00e5ff', 'background:rgba(0,229,255,0.12)',
      'box-shadow:0 0 6px rgba(0,229,255,0.6)', 'z-index:5',
    ].join(';');
    document.body.appendChild(this.dragRectEl);
  }

  detach(): void {
    const c = this.opts.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    this.dragRectEl.remove();
  }

  // Called by the buildables panel when a unit-kind button is clicked.
  // Workers go to HQ via TrainUnit (Phase 1 path); combat units route
  // through the player's first operational production building via
  // TrainAtStructure (Phase 3.0). The panel is responsible for greying
  // the button when no Forge is operational, so this method silently
  // no-ops in that case rather than queueing a doomed command.
  trainUnit(kind: UnitKind): void {
    if (kind === 'worker') {
      this.queue.push({
        kind: CommandKind.TrainUnit,
        faction: this.opts.playerFaction,
        unitKind: kind,
      });
    } else {
      const forge = findFirstOperationalProduction(this.opts.sim.state, this.opts.playerFaction);
      if (forge === null) return;
      this.queue.push({
        kind: CommandKind.TrainAtStructure,
        structureId: forge.id,
        unitKind: kind,
      });
    }
    // Selecting and training are independent — clear selection so the
    // ring doesn't linger on a unit the player isn't focused on.
    this.clearSelection();
  }

  // Called by the buildables panel when BUILD FORGE is clicked. Enters
  // placement mode: the next left-click on the canvas issues a
  // BuildStructure command at the clicked tile.
  enterPlaceForgeMode(): void {
    this.pendingPlacement = 'production';
    this.clearSelection();
  }

  // Phase 3.2: placement mode for the upgrade structure (Spire).
  enterPlaceSpireMode(): void {
    this.pendingPlacement = 'upgrade';
    this.clearSelection();
  }

  // Phase 3.6: placement mode for the supply structure (Pylon).
  enterPlacePylonMode(): void {
    this.pendingPlacement = 'supply';
    this.clearSelection();
  }

  isPlacing(): boolean {
    return this.pendingPlacement !== null;
  }

  // Phase 3.2: emit a ResearchTier2AtStructure command targeting the
  // player's first operational, idle Spire. Silent no-op if no Spire
  // is available — the panel button is disabled in that case so this
  // shouldn't be reachable through the UI.
  researchTier2(): void {
    const spire = findFirstOperationalUpgrade(this.opts.sim.state, this.opts.playerFaction);
    if (spire === null) return;
    this.queue.push({
      kind: CommandKind.ResearchTier2AtStructure,
      structureId: spire.id,
    });
  }

  // Phase 3.7: emit a ResearchTrailDurationAtStructure command at the
  // player's first idle Spire. Same shape as researchTier2().
  researchTrailDuration(): void {
    const spire = findFirstOperationalUpgrade(this.opts.sim.state, this.opts.playerFaction);
    if (spire === null) return;
    this.queue.push({
      kind: CommandKind.ResearchTrailDurationAtStructure,
      structureId: spire.id,
    });
  }

  // Phase 3.7: fan out an ActivateEnergyDump command per selected
  // dumpable worker (alive, owned, not currently dumping, not on
  // cooldown). The sim is the source of truth and silently rejects
  // doomed commands, but filtering at the input layer keeps the input
  // log + replay tidy. The faction-energy gate is left to the sim
  // (some workers may be dumpable, others not — the AI tick may have
  // mutated energy already, so sequential rejection is fine).
  dumpSelectedWorkers(): void {
    const sim = this.opts.sim.state;
    for (const id of this.selectedUnitIds) {
      const u = sim.units.find((x) => x.id === id);
      if (!u || !u.alive) continue;
      if (u.faction !== this.opts.playerFaction) continue;
      if (u.kind !== 'worker') continue;
      if (u.dumpTicksRemaining > 0) continue;
      if (u.dumpCooldownTicks > 0) continue;
      this.queue.push({
        kind: CommandKind.ActivateEnergyDump,
        workerId: u.id,
      });
    }
  }

  // Sim-driver pulls commands here each tick. Clears the queue.
  takeQueued(): Command[] {
    if (this.queue.length === 0) return [];
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  getSelectedUnitIds(): ReadonlySet<number> {
    return this.selectedUnitIds;
  }

  // ----- event handlers --------------------------------------------------

  private handlePointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      this.handleRightClick(e);
      return;
    }
    if (e.button !== 0) return;

    // Placement consumes the click. The clicked tile (rounded from the
    // ground-plane intersection) becomes the structure's position via
    // BuildStructure. Sim is forgiving about overlap with other
    // entities — Phase 3.5 introduces real tile occupancy.
    if (this.pendingPlacement !== null) {
      const tile = this.pickGroundTile(e);
      if (tile !== null) {
        this.queue.push({
          kind: CommandKind.BuildStructure,
          faction: this.opts.playerFaction,
          structureKind: this.pendingPlacement,
          x: tile.x,
          y: tile.y,
        });
      }
      this.pendingPlacement = null;
      return;
    }

    // Try unit hit first. A click on an owned unit either replaces or
    // toggles selection (shift), with no drag.
    const unitHit = this.pickOwnedUnit(e);
    if (unitHit !== null) {
      if (e.shiftKey) {
        if (this.selectedUnitIds.has(unitHit)) this.selectedUnitIds.delete(unitHit);
        else this.selectedUnitIds.add(unitHit);
      } else {
        this.selectedUnitIds.clear();
        this.selectedUnitIds.add(unitHit);
      }
      return;
    }

    // Empty-space pointerdown: arm a potential drag-rect. We don't
    // commit to drag-vs-click semantics until pointerup so a small
    // accidental jitter still acts as a click.
    this.drag = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      dragging: false,
      additive: e.shiftKey,
    };
    try {
      this.opts.canvas.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already captured
      // by another element; the drag still works without it.
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.drag === null) return;
    const dx = e.clientX - this.drag.startClientX;
    const dy = e.clientY - this.drag.startClientY;
    if (!this.drag.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      this.drag.dragging = true;
    }
    // Render the drag-rect overlay so the player sees what they're
    // selecting. Pure DOM; no sim or three impact.
    const left = Math.min(this.drag.startClientX, e.clientX);
    const top = Math.min(this.drag.startClientY, e.clientY);
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    this.dragRectEl.style.left = `${left}px`;
    this.dragRectEl.style.top = `${top}px`;
    this.dragRectEl.style.width = `${width}px`;
    this.dragRectEl.style.height = `${height}px`;
    this.dragRectEl.style.display = 'block';
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.drag === null) return;
    const drag = this.drag;
    this.drag = null;
    this.dragRectEl.style.display = 'none';
    try {
      this.opts.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // releasePointerCapture throws if not captured; not fatal.
    }

    if (drag.dragging) {
      // Finalise drag-rect selection.
      const left = Math.min(drag.startClientX, e.clientX);
      const right = Math.max(drag.startClientX, e.clientX);
      const top = Math.min(drag.startClientY, e.clientY);
      const bottom = Math.max(drag.startClientY, e.clientY);
      const inRect = this.findOwnedUnitsInScreenRect(left, top, right, bottom);
      if (!drag.additive) this.selectedUnitIds.clear();
      for (const id of inRect) this.selectedUnitIds.add(id);
      return;
    }

    // Treated as a plain click in empty space (didn't drag past
    // threshold). If we have selected workers and the click landed on
    // a node, route them all to that node. Otherwise clear selection.
    const nodeHit = this.pickLiveNode(e);
    if (nodeHit !== null && this.selectedUnitIds.size > 0) {
      const sentAny = this.queueAssignWorkersToNode(nodeHit);
      if (sentAny) this.clearSelection();
      return;
    }
    this.clearSelection();
  }

  private handleRightClick(e: PointerEvent): void {
    // Right-click cancels placement first (matches the AoE / SC
    // convention "abort current action"), regardless of selection.
    if (this.pendingPlacement !== null) {
      this.pendingPlacement = null;
      return;
    }
    if (this.selectedUnitIds.size === 0) return;
    // Move-order for every selected unit at the clicked tile. Sim
    // silently ignores defenders + dead units, so the input layer
    // doesn't need to filter — but we do filter to avoid emitting
    // dead-letter commands every right-click.
    const tile = this.pickGroundTile(e);
    if (tile === null) return;
    const sim = this.opts.sim.state;
    for (const id of this.selectedUnitIds) {
      const u = sim.units.find((x) => x.id === id);
      if (!u || !u.alive || u.kind === 'defender') continue;
      this.queue.push({
        kind: CommandKind.MoveUnit,
        unitId: id,
        x: tile.x,
        y: tile.y,
      });
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      this.clearSelection();
      this.pendingPlacement = null;
      return;
    }
    // Phase 3.7: hotkey 'E' fires the energy dump for every selected
    // dumpable worker — the same fan-out as the panel button.
    if (e.key === 'e' || e.key === 'E') {
      this.dumpSelectedWorkers();
    }
  }

  // Issue an AssignWorkerToNode for every selected unit that's a worker
  // owned by the player. Returns whether any commands were queued (so
  // the caller can decide whether to clear selection).
  private queueAssignWorkersToNode(nodeId: number): boolean {
    let queued = false;
    const sim = this.opts.sim.state;
    for (const id of this.selectedUnitIds) {
      const u = sim.units.find((x) => x.id === id);
      if (!u || !u.alive) continue;
      if (u.faction !== this.opts.playerFaction) continue;
      if (u.kind !== 'worker') continue;
      this.queue.push({
        kind: CommandKind.AssignWorkerToNode,
        workerId: u.id,
        nodeId,
      });
      queued = true;
    }
    return queued;
  }

  private clearSelection(): void {
    this.selectedUnitIds.clear();
  }

  // Project the pointer onto the y=0 ground plane and return the
  // nearest integer tile coordinate. Returns null if the pointer ray
  // is parallel to the plane (camera looking horizontal — never the
  // case for the orthographic isometric we ship). Tile rounding is
  // deterministic since it's a Math.round on a float — but the
  // resulting BuildStructure / MoveUnit command carries integer tile
  // coords, which are sim-canonical, so deterministic by construction.
  private pickGroundTile(e: PointerEvent): { x: number; y: number } | null {
    this.updatePointer(e);
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    const wx = ray.origin.x + ray.direction.x * t;
    const wz = ray.origin.z + ray.direction.z * t;
    // Inverse of grid.ts's tileToWorld:
    //   world.x = (-worldExtent/2 + tileSize/2) + tileX * tileSize
    // → tileX = round((wx + worldExtent/2 - tileSize/2) / tileSize)
    const { worldExtent, tileSize, gridSize } = GRID_CONSTANTS;
    const offset = -worldExtent / 2 + tileSize / 2;
    const tileX = Math.round((wx - offset) / tileSize);
    const tileY = Math.round((wz - offset) / tileSize);
    if (tileX < 0 || tileX >= gridSize || tileY < 0 || tileY >= gridSize) return null;
    return { x: tileX, y: tileY };
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

  // Project each owned, alive unit's world position to client (CSS
  // pixel) coordinates and collect IDs whose projection lands inside
  // the rect. Uses each unit's sim position via tileFloatToWorld so
  // the test is independent of mid-frame interpolation in the renderer.
  private findOwnedUnitsInScreenRect(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): number[] {
    const out: number[] = [];
    const rect = this.opts.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const u of this.opts.sim.state.units) {
      if (!u.alive) continue;
      if (u.faction !== this.opts.playerFaction) continue;
      const w = tileFloatToWorld(toFloat(u.x), toFloat(u.y));
      v.set(w.x, 0, w.z);
      v.project(this.opts.camera);
      // NDC → CSS pixels relative to the canvas → relative to client.
      const cx = rect.left + ((v.x + 1) / 2) * rect.width;
      const cy = rect.top + ((1 - v.y) / 2) * rect.height;
      if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
        out.push(u.id);
      }
    }
    return out;
  }
}
