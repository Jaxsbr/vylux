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
import { findNode, findStructure, findUnit } from '../sim/state';
import { isInChargeMode } from '../sim/step';
import { ENERGY_COST_PER_TASK } from '../sim/units-config';
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

// Lightweight descriptor for what the click ray would pick — drives
// both the static-first selection on click and the hover-outline tint
// applied by SimRenderer.
export type HoveredEntity =
  | { kind: 'unit'; id: number }
  | { kind: 'structure'; id: number }
  | { kind: 'hq'; faction: Faction }
  | { kind: 'node'; id: number };

export interface InputFeedbackHooks {
  // Phase 3.9.1: fired after the input controller commits the
  // corresponding sim command. Pure presentation — no sim impact.
  onMoveOrder?(tileX: number, tileY: number, faction: Faction): void;
  onAssignToNode?(tileX: number, tileY: number): void;
  onPlacement?(tileX: number, tileY: number): void;
  // Phase C.1: fired when a player command is dropped because the
  // worker is in charge mode (or at 0 charge). Renderer plays the
  // floating-lightning cue on the named worker.
  onEnergyBlocked?(workerId: number): void;
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
  // Node selection is read-only — there are no node-actions today, but
  // the selection drives the bottom-left portrait (remaining-energy
  // readout). Mutual-exclusion mirrors the other slots: selecting a
  // node clears everything else.
  private selectedNodeId: number | null = null;

  // Latest entity under the cursor — refreshed on pointermove (when not
  // mid-drag). SimRenderer reads it to apply the gray hover outline.
  private hoveredEntity: HoveredEntity | null = null;
  // When set, the next left-click places a structure of this kind at
  // the clicked tile. null = normal click flow (select / assign / drag).
  // Phase 3.0 introduced this for production buildings; Phase 3.2
  // reuses the slot for upgrade structures (Spires); Phase 3.6 adds
  // supply structures (Pylons). Phase 3.10.6: also captures the worker
  // IDs that will build it — snapshotted at enterPlace*Mode time so a
  // mid-placement selection change doesn't strand the build.
  private pendingPlacement: 'production' | 'upgrade' | 'supply' | 'workPod' | null = null;
  private readonly queue: Command[] = [];
  private readonly raycaster = (() => {
    const r = new THREE.Raycaster();
    // Tighten Line picking: default is 1 world-unit fat zone around any
    // LineSegments. Workers, HQs, work pods, and nodes all carry
    // EdgesGeometry trim, so the default turns each edge into a
    // ~1-tile-thick clickable region — the player's clicks land on the
    // wrong entity (a worker beside a pod intercepts pod clicks). A
    // small threshold keeps line raycasts effectively disabled for our
    // mesh-only selection.
    r.params.Line = { threshold: 0.001 };
    return r;
  })();
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
    // Phase A: only worker training survives. The action bar surfaces
    // only the TRAIN WORKER button when the HQ is selected, so this
    // method is effectively HQ-only.
    if (kind !== 'worker') return;
    this.queue.push({
      kind: CommandKind.TrainUnit,
      faction: this.opts.playerFaction,
      unitKind: 'worker',
    });
    this.selectedUnitIds.clear();
  }

  // Phase A: legacy structure placement-mode entries retired.
  enterPlaceForgeMode(): void { /* retired in Phase A */ }
  enterPlaceSpireMode(): void { /* retired in Phase A */ }
  enterPlacePylonMode(): void { /* retired in Phase A */ }

  // Phase C.1: enter placement mode for a work pod. The next left-click
  // on the canvas issues a BuildStructureByWorker command at the
  // clicked tile, paid for by the first selected worker. If no worker
  // is selected the click is consumed but no command is queued (sim
  // would silently reject anyway).
  enterPlaceWorkPodMode(): void {
    this.pendingPlacement = 'workPod';
    this.applyCursor('crosshair');
  }

  // Phase C.1 research: emit a StartResearchAtPod command targeting the
  // currently-selected friendly work pod. Silent no-op if no pod is
  // selected (UI button should be hidden in that case).
  researchAutoResume(): void {
    const id = this.selectedStructureId;
    if (id === null) return;
    this.queue.push({
      kind: CommandKind.StartResearchAtPod,
      structureId: id,
      researchKind: 'autoResume',
    });
  }

  isPlacing(): boolean {
    return this.pendingPlacement !== null;
  }

  // Phase C.1: pick the lowest-ID friendly worker that's currently
  // actionable (alive, owned, not in charge mode, has ≥ 1 charge).
  // Used by the work-pod placement flow to decide which worker walks
  // to the site. Returns null if no selected worker fits the bill.
  private firstActionableWorker(): number | null {
    let best: number | null = null;
    for (const id of this.selectedUnitIds) {
      const u = findUnit(this.opts.sim.state, id);
      if (!u || u.kind !== 'worker') continue;
      if (u.faction !== this.opts.playerFaction) continue;
      if (isInChargeMode(u)) continue;
      if (u.charge < ENERGY_COST_PER_TASK) continue;
      if (best === null || u.id < best) best = u.id;
    }
    return best;
  }

  // Phase A: research + energy-dump entry points are retired. The
  // action bar no longer surfaces them; these stubs remain so the
  // ActionBarDelegate interface keeps its compile-time shape until the
  // wiring is fully removed in a later cleanup.
  researchTier2(): void { /* retired in Phase A */ }
  researchTrailDuration(): void { /* retired in Phase A */ }
  dumpSelectedWorkers(): void { /* retired in Phase A */ }

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
      // Phase C.1: only 'workPod' is a live placement kind. Pick the
      // first selected worker that's actionable (not in charge mode +
      // has charge >= 1); queue a BuildStructureByWorker command at
      // the clicked tile.
      if (this.pendingPlacement === 'workPod') {
        const tile = this.pickGroundTile(e);
        if (tile !== null) {
          const builder = this.firstActionableWorker();
          if (builder !== null) {
            this.queue.push({
              kind: CommandKind.BuildStructureByWorker,
              workerId: builder,
              structureKind: 'workPod',
              x: tile.x,
              y: tile.y,
            });
            this.opts.feedback?.onPlacement?.(tile.x, tile.y);
          }
        }
      }
      this.pendingPlacement = null;
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

    // Static-first pick precedence (HQ > Structure > Node > Unit). The
    // previous unit-first order made it impossible to click an energy
    // node surrounded by workers, or a work pod with a worker on an
    // adjacent tile — the worker's mesh intercepted the click ray.
    // Static-first matches the standard RTS expectation that "fixed
    // things are easier to click than moving things" and keeps the
    // worker still clickable when it stands clear of other entities.
    const pick = this.pickAtPriority(e);
    if (pick !== null) {
      switch (pick.kind) {
        case 'hq':
          this.selectedUnitIds.clear();
          this.selectedStructureId = null;
          this.selectedNodeId = null;
          this.selectedHqFaction = pick.faction;
          return;
        case 'structure':
          this.selectedUnitIds.clear();
          this.selectedHqFaction = null;
          this.selectedNodeId = null;
          this.selectedStructureId = pick.id;
          return;
        case 'node':
          this.selectedUnitIds.clear();
          this.selectedStructureId = null;
          this.selectedHqFaction = null;
          this.selectedNodeId = pick.id;
          return;
        case 'unit': {
          if (e.shiftKey) {
            if (this.selectedUnitIds.has(pick.id)) this.selectedUnitIds.delete(pick.id);
            else this.selectedUnitIds.add(pick.id);
          } else {
            this.selectedUnitIds.clear();
            this.selectedUnitIds.add(pick.id);
          }
          this.selectedStructureId = null;
          this.selectedHqFaction = null;
          this.selectedNodeId = null;
          return;
        }
      }
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
      this.hoveredEntity = this.pickAtPriority(e);
      return;
    }
    this.hoveredEntity = null;
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

    // Phase A: structures retired; right-click is move-order only.
    // Phase C.1: workers at 0 charge or in charge mode reject the move
    // — fire the lightning cue on each rejected worker so the player
    // sees why the command didn't take.
    const state = this.opts.sim.state;
    const tile = this.pickGroundTile(e);
    if (tile === null) return;
    let queued = false;
    for (const id of this.selectedUnitIds) {
      const u = findUnit(state, id);
      if (!u) continue;
      if (u.kind === 'worker' && (isInChargeMode(u) || u.charge < ENERGY_COST_PER_TASK)) {
        this.opts.feedback?.onEnergyBlocked?.(id);
        continue;
      }
      this.queue.push({
        kind: CommandKind.MoveUnit,
        unitId: id,
        x: tile.x,
        y: tile.y,
      });
      queued = true;
    }
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
      // Phase C.1: fire the cue + skip the command for charge-mode /
      // 0-charge workers so the player sees why nothing happened.
      if (isInChargeMode(u) || u.charge < ENERGY_COST_PER_TASK) {
        this.opts.feedback?.onEnergyBlocked?.(u.id);
        continue;
      }
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
    this.selectedNodeId = null;
  }

  // Resolve which entity sits under the click cursor, applying the
  // static-first priority (HQ > Structure > Node > Unit) so a worker
  // next to a node can't intercept the click intended for the node.
  private pickAtPriority(e: PointerEvent): HoveredEntity | null {
    const hq = this.pickOwnedHq(e);
    if (hq !== null) return { kind: 'hq', faction: hq };
    const structure = this.pickOwnedStructure(e);
    if (structure !== null) return { kind: 'structure', id: structure };
    const node = this.pickLiveNode(e);
    if (node !== null) return { kind: 'node', id: node };
    const unit = this.pickOwnedUnit(e);
    if (unit !== null) return { kind: 'unit', id: unit };
    return null;
  }

  // Selection-filtered hover state. Suppresses the outline on the
  // currently-selected entity (the selection ring is the right visual
  // cue there), so only "potentially selectable" targets get the tint.
  getHoveredEntity(): HoveredEntity | null {
    const h = this.hoveredEntity;
    if (h === null) return null;
    switch (h.kind) {
      case 'unit':      return this.selectedUnitIds.has(h.id) ? null : h;
      case 'structure': return h.id === this.selectedStructureId ? null : h;
      case 'hq':        return h.faction === this.selectedHqFaction ? null : h;
      case 'node':      return h.id === this.selectedNodeId ? null : h;
    }
  }

  getSelectedStructureId(): number | null {
    return this.selectedStructureId;
  }

  getSelectedHqFaction(): Faction | null {
    return this.selectedHqFaction;
  }

  getSelectedNodeId(): number | null {
    return this.selectedNodeId;
  }

  // Phase 3.10.3: programmatic selection for test hooks. Production
  // input still goes through the pointer pickers — these methods exist
  // so e2e specs can drive the action bar without computing canvas
  // pixel coords for the HQ / structure tile.
  selectHqProgrammatic(faction: Faction): void {
    this.selectedUnitIds.clear();
    this.selectedStructureId = null;
    this.selectedNodeId = null;
    this.selectedHqFaction = faction;
  }

  selectStructureProgrammatic(structureId: number): void {
    this.selectedUnitIds.clear();
    this.selectedHqFaction = null;
    this.selectedNodeId = null;
    this.selectedStructureId = structureId;
  }

  selectAllOwnWorkersProgrammatic(): void {
    this.selectedUnitIds.clear();
    this.selectedStructureId = null;
    this.selectedHqFaction = null;
    this.selectedNodeId = null;
    for (const u of this.opts.sim.state.units) {
      if (!u.alive || u.faction !== this.opts.playerFaction || u.kind !== 'worker') continue;
      this.selectedUnitIds.add(u.id);
    }
  }

  private pickOwnedStructure(e: PointerEvent): number | null {
    // Phase C.1: raycast against the structure meshes registered by
    // sim-renderer (work pods carry userData.structureId on the
    // mesh group). Returns the picked structure id iff it's owned by
    // the player faction; null otherwise so foreign / dead pods don't
    // register.
    this.updatePointer(e);
    const targets: THREE.Object3D[] = [];
    for (const g of this.opts.structureMeshes.values()) {
      if (g.visible) targets.push(g);
    }
    if (targets.length === 0) return null;
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj !== null) {
        const ud = obj.userData as { structureId?: number };
        if (typeof ud.structureId === 'number') {
          const s = findStructure(this.opts.sim.state, ud.structureId);
          if (s && s.alive && s.faction === this.opts.playerFaction) return s.id;
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
