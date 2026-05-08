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
import { findFirstOperationalProduction, findFirstOperationalUpgrade, findNode, findStructure, findUnit } from '../sim/state';
import type { Faction, UnitKind } from '../sim/types';
import { GRID_CONSTANTS } from '../grid';
import { tileFloatToWorld } from './scene';
import { toFloat } from '../sim/fixed';
import { themeForFaction } from './factions/theme';

// Pixel distance the pointer must move past the down-point before a
// left-button-drag is treated as a drag-rect rather than a click.
// Smaller values feel "twitchy"; larger feel sluggish. 5 px is the SC2
// default ballpark.
const DRAG_THRESHOLD_PX = 5;

export interface InputFeedbackHooks {
  // Phase 3.9.1: fired after the input controller commits the
  // corresponding sim command. Pure presentation — no sim impact.
  onMoveOrder?(tileX: number, tileY: number, faction: Faction): void;
  onAssignToNode?(tileX: number, tileY: number): void;
  onPlacement?(tileX: number, tileY: number): void;
}

export interface InputControllerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  unitMeshes: ReadonlyMap<number, THREE.Group>;
  nodeMeshes: ReadonlyMap<number, THREE.Group>;
  // Phase 3.10.3: structure + HQ raycast registries so the player can
  // click them. Same shape as unitMeshes; mesh groups carry
  // userData.structureId / userData.hqFaction respectively.
  structureMeshes: ReadonlyMap<number, THREE.Group>;
  hqMeshes: ReadonlyMap<Faction, THREE.Group>;
  sim: Sim;
  playerFaction: Faction;
  // Phase 3.9.1: optional renderer-side feedback hooks. Omitted in
  // tests / observer-style harnesses where no overlay exists.
  feedback?: InputFeedbackHooks;
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
  // Phase 3.10.3: at most one structure or HQ may be "selected" at a
  // time. Selecting either clears the other + clears the unit
  // selection — the action bar reads exactly one of the three slots.
  // Action-bar UX prefers a single "focused thing" rather than a
  // mixed structure-and-units selection.
  private selectedStructureId: number | null = null;
  private selectedHqFaction: Faction | null = null;
  // When set, the next left-click places a structure of this kind at
  // the clicked tile. null = normal click flow (select / assign / drag).
  // Phase 3.0 introduced this for production buildings; Phase 3.2
  // reuses the slot for upgrade structures (Spires); Phase 3.6 adds
  // supply structures (Pylons). Phase 3.10.6: also captures the worker
  // IDs that will build it — snapshotted at enterPlace*Mode time so a
  // mid-placement selection change doesn't strand the build.
  private pendingPlacement: 'production' | 'upgrade' | 'supply' | null = null;
  private pendingPlacementWorkers: number[] = [];
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

    // Phase 3.11a: drag-rect tints to the player's faction so a Forge
    // player gets a red selection overlay instead of cyan.
    const ft = themeForFaction(opts.playerFaction);
    this.dragRectEl = document.createElement('div');
    this.dragRectEl.style.cssText = [
      'position:fixed', 'pointer-events:none', 'display:none',
      `border:1px solid ${ft.primary}`, `background:${ft.glowSoft}`,
      `box-shadow:0 0 6px ${ft.glow}`, 'z-index:5',
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
    // Phase 3.10.6: keep the HQ / structure selection so the player
    // can queue another train without re-selecting. (Clearing was the
    // pre-3.10 behavior that assumed a flat panel; with the
    // selection-driven action bar it'd hide the very buttons the
    // player just clicked.) Unit selection still clears so the ring
    // doesn't linger on workers that just got told to train.
    this.selectedUnitIds.clear();
  }

  // Called by the buildables panel when BUILD FORGE is clicked. Enters
  // placement mode: the next left-click on the canvas issues a
  // BuildStructure command at the clicked tile.
  enterPlaceForgeMode(): void {
    this.pendingPlacement = 'production';
    this.pendingPlacementWorkers = this.snapshotSelectedWorkers();
    // Don't clear the unit selection — the player wants to see "I'm
    // about to dispatch these workers." The selection rings stay on
    // until the placement click resolves.
    this.applyCursor('crosshair');
  }

  // Phase 3.2: placement mode for the upgrade structure (Spire).
  enterPlaceSpireMode(): void {
    this.pendingPlacement = 'upgrade';
    this.pendingPlacementWorkers = this.snapshotSelectedWorkers();
    this.applyCursor('crosshair');
  }

  // Phase 3.6: placement mode for the supply structure (Pylon).
  enterPlacePylonMode(): void {
    this.pendingPlacement = 'supply';
    this.pendingPlacementWorkers = this.snapshotSelectedWorkers();
    this.applyCursor('crosshair');
  }

  // Phase 3.10.6: collect the IDs of currently-selected own-faction
  // alive workers — these are the ones that will be dispatched on the
  // placement click. The first becomes the BuildStructureByWorker
  // owner; the rest queue AssignWorkerToBuild after the structure
  // exists. Empty list means no worker available; the placement
  // commit will silently no-op (sim rejects invalid workerId).
  private snapshotSelectedWorkers(): number[] {
    const out: number[] = [];
    const state = this.opts.sim.state;
    for (const id of this.selectedUnitIds) {
      const u = findUnit(state, id);
      if (!u || u.faction !== this.opts.playerFaction) continue;
      if (u.kind !== 'worker') continue;
      out.push(u.id);
    }
    return out;
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
    const state = this.opts.sim.state;
    for (const id of this.selectedUnitIds) {
      const u = findUnit(state, id);
      if (!u) continue;
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
    // ground-plane intersection) becomes the structure's position.
    // Phase 3.10.6: workers build buildings — the first selected
    // worker dispatches via BuildStructureByWorker (which spawns the
    // structure + assigns the worker), and any additional selected
    // workers queue AssignWorkerToBuild for parallel construction.
    if (this.pendingPlacement !== null) {
      const tile = this.pickGroundTile(e);
      if (tile !== null && this.pendingPlacementWorkers.length > 0) {
        const [first, ...rest] = this.pendingPlacementWorkers;
        this.queue.push({
          kind: CommandKind.BuildStructureByWorker,
          workerId: first,
          structureKind: this.pendingPlacement,
          x: tile.x,
          y: tile.y,
        });
        // KNOWN GAP (followup, see investigation 04 §3.10 close):
        // when N>1 workers are selected at placement-click time, only
        // the first walks to the build site. The follow-up
        // AssignWorkerToBuild commands need the structure id created
        // by BuildStructureByWorker — that id isn't known until the
        // sim has applied the build command. The sim's nextEntityId
        // is monotonic + readable here, so a future fix can capture
        // `state.nextEntityId` immediately before queueing the build
        // and use it for the follow-up Assign commands. 3.10.7 only
        // wires multi-worker via right-click on an in-progress
        // structure (see handleRightClick), which covers the "I want
        // more builders" path but not the "I clicked place with 4
        // workers selected" intent.
        void rest;
        this.opts.feedback?.onPlacement?.(tile.x, tile.y);
      }
      this.pendingPlacement = null;
      this.pendingPlacementWorkers = [];
      this.refreshCursor(e);
      return;
    }

    // Phase 3.10 follow-up: if the player already has a selection and
    // clicked (without shift) on a node, prefer node-assign over
    // unit-pick. Without this, clicking a node that has another
    // worker overlapping it (e.g. one already harvesting there)
    // re-selects that worker instead of assigning the current
    // selection — confusing because the player's intent was clearly
    // "harvest this node." Shift+click still falls through to the
    // unit-toggle path so additive selection works as before.
    if (!e.shiftKey && this.selectedUnitIds.size > 0) {
      const nodeHitFromDown = this.pickLiveNode(e);
      if (nodeHitFromDown !== null) {
        const sentAny = this.queueAssignWorkersToNode(nodeHitFromDown);
        if (sentAny) {
          const node = findNode(this.opts.sim.state, nodeHitFromDown);
          if (node) this.opts.feedback?.onAssignToNode?.(toFloat(node.x), toFloat(node.y));
        }
        return;
      }
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
      // Selecting a unit clears any structure / HQ focus — see the
      // mutual-exclusion rule at the field declarations.
      this.selectedStructureId = null;
      this.selectedHqFaction = null;
      return;
    }

    // Phase 3.10.3: structure pick (own structures only). Single-
    // select; clears unit + HQ slots.
    const structureHit = this.pickOwnedStructure(e);
    if (structureHit !== null) {
      this.selectedUnitIds.clear();
      this.selectedHqFaction = null;
      this.selectedStructureId = structureHit;
      return;
    }

    // Phase 3.10.3: HQ pick (own HQ only).
    const hqHit = this.pickOwnedHq(e);
    if (hqHit !== null) {
      this.selectedUnitIds.clear();
      this.selectedStructureId = null;
      this.selectedHqFaction = hqHit;
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
    if (this.drag === null) {
      // Phase 3.9.1: hover-driven cursor state. Only updated when NOT
      // mid-drag — during a drag the cursor stays as it was at down so
      // the player isn't visually tracked through stale hover states.
      this.refreshCursor(e);
      return;
    }
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
      if (sentAny) {
        const node = findNode(this.opts.sim.state, nodeHit);
        if (node) this.opts.feedback?.onAssignToNode?.(toFloat(node.x), toFloat(node.y));
        // Phase 3.10 follow-up: do NOT clear selection on assign-to-
        // node. The pre-3.10 code cleared, but the player loses focus
        // mid-task — they have to re-select the workers to give a
        // follow-up order. Standard RTS pattern is "selection persists
        // until you click empty space"; that's what we do now.
      }
      return;
    }
    this.clearSelection();
  }

  private handleRightClick(e: PointerEvent): void {
    // Right-click cancels placement first (matches the AoE / SC
    // convention "abort current action"), regardless of selection.
    if (this.pendingPlacement !== null) {
      this.pendingPlacement = null;
      this.refreshCursor(e);
      return;
    }
    if (this.selectedUnitIds.size === 0) return;

    // Phase 3.10.7: right-click on an in-progress own-faction structure
    // with worker(s) selected → dispatch additional builders. Sim
    // already supports the multi-worker stacking; this is just the
    // input wire. Operational structures fall through to the move-
    // order path (right-clicking a Forge with workers selected just
    // moves them past it — no special "repair" action yet).
    const state = this.opts.sim.state;
    const structureHit = this.pickOwnedStructure(e);
    if (structureHit !== null) {
      const s = findStructure(state, structureHit);
      if (s && s.buildTicksRemaining > 0) {
        let assigned = 0;
        for (const id of this.selectedUnitIds) {
          const u = findUnit(state, id);
          if (!u || u.kind !== 'worker') continue;
          if (u.faction !== this.opts.playerFaction) continue;
          this.queue.push({
            kind: CommandKind.AssignWorkerToBuild,
            workerId: id,
            structureId: s.id,
          });
          assigned++;
        }
        if (assigned > 0) {
          // Visual confirmation at the structure's tile.
          this.opts.feedback?.onAssignToNode?.(toFloat(s.x), toFloat(s.y));
          return;
        }
        // No workers in selection (e.g. only raiders) — fall through
        // to move-order so the click does *something* on the tile.
      }
    }

    // Move-order for every selected unit at the clicked tile. Sim
    // silently ignores defenders + dead units, so the input layer
    // doesn't need to filter — but we do filter to avoid emitting
    // dead-letter commands every right-click.
    const tile = this.pickGroundTile(e);
    if (tile === null) return;
    let queued = false;
    for (const id of this.selectedUnitIds) {
      const u = findUnit(state, id);
      if (!u || u.kind === 'defender') continue;
      this.queue.push({
        kind: CommandKind.MoveUnit,
        unitId: id,
        x: tile.x,
        y: tile.y,
      });
      queued = true;
    }
    // Only ping when at least one move actually queued — prevents the
    // ring from flashing when the selection is all defenders / dead.
    if (queued) this.opts.feedback?.onMoveOrder?.(tile.x, tile.y, this.opts.playerFaction);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      this.clearSelection();
      this.pendingPlacement = null;
      this.applyCursor('auto');
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
    const state = this.opts.sim.state;
    for (const id of this.selectedUnitIds) {
      const u = findUnit(state, id);
      if (!u) continue;
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
    this.selectedStructureId = null;
    this.selectedHqFaction = null;
  }

  getSelectedStructureId(): number | null {
    return this.selectedStructureId;
  }

  getSelectedHqFaction(): Faction | null {
    return this.selectedHqFaction;
  }

  // Phase 3.10.3: programmatic selection for test hooks. Production
  // input still goes through the pointer pickers — these methods exist
  // so e2e specs can drive the action bar without computing canvas
  // pixel coords for the HQ / structure tile.
  selectHqProgrammatic(faction: Faction): void {
    this.selectedUnitIds.clear();
    this.selectedStructureId = null;
    this.selectedHqFaction = faction;
  }

  selectStructureProgrammatic(structureId: number): void {
    this.selectedUnitIds.clear();
    this.selectedHqFaction = null;
    this.selectedStructureId = structureId;
  }

  selectAllOwnWorkersProgrammatic(): void {
    this.selectedUnitIds.clear();
    this.selectedStructureId = null;
    this.selectedHqFaction = null;
    for (const u of this.opts.sim.state.units) {
      if (!u.alive || u.faction !== this.opts.playerFaction || u.kind !== 'worker') continue;
      this.selectedUnitIds.add(u.id);
    }
  }

  private pickOwnedStructure(e: PointerEvent): number | null {
    this.updatePointer(e);
    const targets: THREE.Object3D[] = [];
    for (const g of this.opts.structureMeshes.values()) {
      if (g.visible) targets.push(g);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj !== null) {
        const ud = obj.userData as { structureId?: number };
        if (typeof ud.structureId === 'number') {
          const s = findStructure(this.opts.sim.state, ud.structureId);
          if (s && s.faction === this.opts.playerFaction) return s.id;
          return null;
        }
        obj = obj.parent;
      }
    }
    return null;
  }

  private pickOwnedHq(e: PointerEvent): Faction | null {
    this.updatePointer(e);
    const targets: THREE.Object3D[] = [];
    for (const g of this.opts.hqMeshes.values()) {
      if (g.visible) targets.push(g);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj !== null) {
        const ud = obj.userData as { hqFaction?: Faction };
        if (typeof ud.hqFaction === 'number') {
          if (ud.hqFaction === this.opts.playerFaction) return ud.hqFaction;
          return null;
        }
        obj = obj.parent;
      }
    }
    return null;
  }

  // Phase 3.9.1: hover-driven CSS cursor on the canvas. Cheap raycast
  // against the same mesh registries the click path uses; only fires
  // when the pointer moves and we're not mid-drag, so the per-frame
  // budget is one raycast per mousemove event (small entity counts —
  // negligible).
  //
  //   placement mode      → crosshair (the click will commit a build)
  //   over own unit       → pointer    (clickable to select)
  //   over a live node    → pointer    (clickable as harvest target)
  //   anything else       → auto       (default OS pointer)
  private refreshCursor(e: PointerEvent): void {
    if (this.pendingPlacement !== null) {
      this.applyCursor('crosshair');
      return;
    }
    if (this.pickOwnedUnit(e) !== null) {
      this.applyCursor('pointer');
      return;
    }
    if (this.pickLiveNode(e) !== null) {
      this.applyCursor('pointer');
      return;
    }
    this.applyCursor('auto');
  }

  private currentCursor: string = 'auto';
  private applyCursor(c: string): void {
    if (c === this.currentCursor) return;
    this.currentCursor = c;
    this.opts.canvas.style.cursor = c;
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
          const u = findUnit(this.opts.sim.state, ud.unitId);
          if (u && u.faction === this.opts.playerFaction) return u.id;
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
          const n = findNode(this.opts.sim.state, ud.nodeId);
          if (n) return n.id;
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
