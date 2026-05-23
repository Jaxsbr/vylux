// Reconciles sim state with Three.js mesh state.
//
// Lifecycle:
// - capturePrev() snapshots positions just before a sim tick advances,
//   so the renderer has a "from" position for interpolation.
// - update(alpha) reads current sim state, lerps positions from the
//   captured snapshot to the live state, updates each mesh, and
//   refreshes per-unit HP bars from sim-derived HP / max.
// - applyInputVisuals(selectedUnitId) toggles the selection ring on
//   the selected entity (each entity owns its own ring; we just
//   set .visible).
//
// The sim is the source of truth. This module never writes back into
// sim state — it's a one-way consumer (PRD §3.3).

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { distSq, rangeSq, toFloat, type Fixed } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import { HQ_VISION_RADIUS, STRUCTURE_STATS, UNIT_STATS } from '../sim/units-config';
import {
  buildHqMesh,
  buildNodeMesh,
  buildUnitMesh,
  buildWorkPodMesh,
  type HqVisual,
  type UnitVisual,
  type NodeVisual,
  type WorkPodVisual,
} from './meshes';
import { tileFloatToWorld } from './scene';
import type { Exploration } from './exploration';
import { workerHover, phaseOffset, WORKER_HOVER_PERIOD_S } from './entity-life';
import { WorkBeams, type BeamSpec } from './work-beam';
import { isInChargeMode } from '../sim/step';
import type { Worker } from '../sim/types';

// Phase C.4 work-beam colours, per work-state.
const HARVEST_BEAM_COLOR = 0x66ff44; // green — matches the assign pulse + node target
const CHARGE_BEAM_COLOR = 0xffd166;  // gold — matches the charge ring + energy node
const FACTION_BEAM_COLOR: Record<Faction, number> = {
  0: 0x00e5ff, // cyan
  1: 0xff6a33, // red-orange
};

interface PrevPosition {
  x: number;
  y: number;
}

interface VisionSource { x: Fixed; y: Fixed; radiusSq: Fixed; }

export class SimRenderer {
  private readonly entitiesGroup: THREE.Group;
  private readonly sim: Sim;
  // Phase 3.8: which faction this renderer presents for. Vision filter
  // hides enemy entities + undiscovered nodes. Observer mode bypasses
  // the filter entirely (sees both factions' state).
  private readonly playerFaction: Faction;
  private readonly bypassVision: boolean;
  private readonly exploration: Exploration | null;

  private readonly hqMeshes: [HqVisual | null, HqVisual | null] = [null, null];
  private readonly unitMeshes = new Map<number, UnitVisual>();
  private readonly nodeMeshes = new Map<number, NodeVisual>();
  private readonly structureMeshes = new Map<number, WorkPodVisual>();
  private readonly prevUnitPos = new Map<number, PrevPosition>();

  // Phase C.4: work-state beams (worker → node / pod / build site). Pooled
  // + reconciled each frame from the active-work specs collected in syncUnits.
  private readonly workBeams: WorkBeams;

  // Phase 3.8: per-frame friendly vision-source cache. Refilled at the
  // top of update() so each enemy entity's visibility test is a linear
  // scan over a small list rather than a re-iteration of state.
  private readonly visionSources: VisionSource[] = [];

  // Combined raycast-target views for the input controller.
  private readonly unitGroupView = new Map<number, THREE.Group>();
  private readonly nodeGroupView = new Map<number, THREE.Group>();
  private readonly structureGroupView = new Map<number, THREE.Group>();
  // HQ raycast registry for the input controller.
  private readonly hqGroupView = new Map<Faction, THREE.Group>();

  constructor(
    sim: Sim,
    entitiesGroup: THREE.Group,
    playerFaction: Faction,
    bypassVision = false,
    exploration: Exploration | null = null,
  ) {
    this.sim = sim;
    this.entitiesGroup = entitiesGroup;
    this.playerFaction = playerFaction;
    this.bypassVision = bypassVision;
    this.exploration = exploration;
    this.workBeams = new WorkBeams(entitiesGroup);
    this.spawnHqs();
  }

  // Currently outlined group + the halo LineSegments duplicates we
  // spawned to fake a bloom around its edges.
  private hoverGroup: THREE.Group | null = null;
  private readonly hoverHalos: HoverHaloRef[] = [];

  // Toggle the hover glow. On a hover change we remove the previous
  // entity's halo duplicates and spawn fresh ones around the new entity.
  setHover(hovered: { kind: 'unit' | 'structure' | 'hq' | 'node'; id?: number; faction?: Faction } | null): void {
    let group: THREE.Group | null = null;
    if (hovered !== null) {
      switch (hovered.kind) {
        case 'unit':      group = hovered.id !== undefined ? this.unitMeshes.get(hovered.id)?.group ?? null : null; break;
        case 'structure': group = hovered.id !== undefined ? this.structureMeshes.get(hovered.id)?.group ?? null : null; break;
        case 'node':      group = hovered.id !== undefined ? this.nodeMeshes.get(hovered.id)?.group ?? null : null; break;
        case 'hq':        group = hovered.faction !== undefined ? this.hqMeshes[hovered.faction]?.group ?? null : null; break;
      }
    }
    if (group === this.hoverGroup) return;
    if (this.hoverGroup !== null) removeHoverHalos(this.hoverHalos);
    this.hoverGroup = group;
    if (group !== null) applyHoverOutlineTint(group, this.hoverHalos);
  }

  capturePrev(): void {
    this.prevUnitPos.clear();
    for (const u of this.sim.state.units) {
      if (!u.alive) continue;
      this.prevUnitPos.set(u.id, { x: toFloat(u.x), y: toFloat(u.y) });
    }
  }

  update(alpha: number): void {
    // Phase 3.9.6: drive per-frame animation timers. Wall-clock dt
    // (not sim dt) so animations run at render-rate, not tick-rate.
    const nowMs = performance.now();
    const dt = this.lastAnimMs < 0
      ? 0
      : Math.min(0.1, (nowMs - this.lastAnimMs) / 1000);
    this.lastAnimMs = nowMs;

    // Phase C.4: advance the shared "life at rest" clock (wall-clock
    // seconds). Per-entity phase offsets keep workers / buildings from
    // pulsing in lockstep.
    this.lifeClock += dt;

    this.collectVisionSources();
    this.exploration?.update();
    this.syncHqs(dt);
    this.syncNodes();
    this.syncStructures(dt);
    this.syncUnits(alpha, dt);
    this.tickDyingUnits(dt);
  }

  // Phase 3.9.6: track wall-clock time for animation tick deltas, and
  // a side-pool of meshes that are mid-death-pulse (the unit is dead in
  // sim but the mesh stays visible until the pulse finishes).
  private lastAnimMs = -1;
  // Phase C.4: monotonic render-rate clock driving the at-rest life
  // animations (worker idle bob, building breathe).
  private lifeClock = 0;
  private readonly dyingUnits = new Map<number, UnitVisual>();

  // Phase 3.8: rebuild the friendly vision-source cache for this frame.
  // Observer mode (bypassVision) skips the rebuild + isPositionVisible
  // returns true for every position; the per-frame cost there is one
  // branch per call.
  private collectVisionSources(): void {
    this.visionSources.length = 0;
    if (this.bypassVision) return;
    const fs = this.sim.state.factions[this.playerFaction];
    this.visionSources.push({ x: fs.hqX, y: fs.hqY, radiusSq: rangeSq(HQ_VISION_RADIUS) });
    for (const u of this.sim.state.units) {
      if (!u.alive || u.faction !== this.playerFaction) continue;
      this.visionSources.push({
        x: u.x,
        y: u.y,
        radiusSq: rangeSq(UNIT_STATS[u.kind].visionRadius),
      });
    }
    // Phase C.1: operational work pods project vision too.
    for (const s of this.sim.state.structures) {
      if (!s.alive || s.faction !== this.playerFaction) continue;
      if (s.kind !== 'workPod') continue;
      if (s.buildTicksRemaining > 0) continue;
      this.visionSources.push({
        x: s.x,
        y: s.y,
        radiusSq: rangeSq(STRUCTURE_STATS.workPod.visionRadius),
      });
    }
  }

  private isPositionVisible(x: Fixed, y: Fixed): boolean {
    if (this.bypassVision) return true;
    for (let i = 0; i < this.visionSources.length; i++) {
      const v = this.visionSources[i];
      if (distSq(v.x, v.y, x, y) <= v.radiusSq) return true;
    }
    return false;
  }

  // Persistent reveal: an enemy entity is shown if it sits on any tile
  // the player has ever explored. Falls back to live vision when no
  // Exploration tracker is wired (older test paths).
  private isPositionExplored(x: Fixed, y: Fixed): boolean {
    if (this.bypassVision) return true;
    if (this.exploration) {
      return this.exploration.isPositionExplored(toFloat(x), toFloat(y));
    }
    return this.isPositionVisible(x, y);
  }

  // Read-only mesh registries used by the input controller for raycasting.
  get unitMeshMap(): ReadonlyMap<number, THREE.Group> {
    return this.unitGroupView;
  }

  get nodeMeshMap(): ReadonlyMap<number, THREE.Group> {
    return this.nodeGroupView;
  }

  get structureMeshMap(): ReadonlyMap<number, THREE.Group> {
    return this.structureGroupView;
  }

  get hqMeshMap(): ReadonlyMap<Faction, THREE.Group> {
    return this.hqGroupView;
  }

  // Each unit/structure/HQ owns its own selection ring; toggling rings
  // requires walking the registry. Cheap (entity counts are small).
  // Phase 3.10.3 extends the original Phase 3.3 multi-unit signature
  // with optional structure / HQ slots — the action bar reads these
  // to decide what to show.
  applyInputVisuals(
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null = null,
    selectedHqFaction: Faction | null = null,
    selectedNodeId: number | null = null,
  ): void {
    for (const [id, vis] of this.unitMeshes) {
      const selected = selectedUnitIds.has(id);
      vis.selectionRing.visible = selected;
      vis.hpBar.group.visible = selected;
    }
    for (const [id, vis] of this.structureMeshes) {
      const selected = id === selectedStructureId;
      vis.selectionRing.visible = selected;
      vis.hpBar.group.visible = selected;
    }
    for (const f of [0, 1] as const) {
      const v = this.hqMeshes[f];
      if (!v) continue;
      const selected = f === selectedHqFaction;
      v.selectionRing.visible = selected;
      v.hpBar.group.visible = selected;
    }
    for (const [id, vis] of this.nodeMeshes) {
      vis.selectionRing.visible = id === selectedNodeId;
    }
  }

  // Phase C.1: fire a "needs energy" lightning cue on a worker. Called
  // by the input controller when it detects a blocked command on a
  // charge-mode worker. No-op if the worker has no mesh yet (unlikely
  // but harmless).
  triggerEnergyCue(workerId: number): void {
    const v = this.unitMeshes.get(workerId);
    if (v) v.energyCue.trigger();
  }

  private spawnHqs(): void {
    for (const f of [0, 1] as const) {
      const fs = this.sim.state.factions[f];
      const v = buildHqMesh(f, toFloat(fs.hqX), toFloat(fs.hqY));
      // Phase 3.10.3: tag the mesh group + register for raycasting so
      // the input controller can pick the HQ on click.
      v.group.userData.hqFaction = f;
      this.entitiesGroup.add(v.group);
      this.hqMeshes[f] = v;
      this.hqGroupView.set(f, v.group);
    }
  }

  private syncHqs(dt: number): void {
    for (const f of [0, 1] as const) {
      const v = this.hqMeshes[f];
      if (!v) continue;
      // Phase C.4 building life — breathe the accent cap whenever the HQ is
      // on screen (cheap; two HQs at most).
      v.tickLife(dt);
      const fs = this.sim.state.factions[f];
      // Phase 3.8: enemy HQ hidden until in the player's vision.
      // Friendly HQ always visible.
      const isOwn = f === this.playerFaction;
      v.group.visible = isOwn || this.bypassVision || this.isPositionExplored(fs.hqX, fs.hqY);
      const maxHp = fs.hqHp > 0 ? Math.max(toFloat(fs.hqHp), 0.0001) : 0;
      // Read max from spec — we don't have it on FactionState, so derive
      // from initial state by tracking max separately. Simpler: cap
      // ratio at 1 by taking max from the highest hp seen so far.
      // For Phase 1.7-fix scope, just use a known constant: HQ has
      // hqMaxHp from spec; in main.ts we use 250.
      // Reach into hpBar with current/derived max — falling back to the
      // observed peak avoids needing to plumb hqMaxHp through.
      const knownMax = Math.max(maxHp, this.hqMaxHpSeen[f]);
      this.hqMaxHpSeen[f] = knownMax;
      v.hpBar.update(toFloat(fs.hqHp), knownMax);
    }
  }

  private readonly hqMaxHpSeen: [number, number] = [0.0001, 0.0001];

  private syncNodes(): void {
    for (const n of this.sim.state.nodes) {
      let v = this.nodeMeshes.get(n.id);
      if (!v && n.alive) {
        v = buildNodeMesh(toFloat(n.x), toFloat(n.y), n.kind);
        v.group.userData.nodeId = n.id;
        this.entitiesGroup.add(v.group);
        this.nodeMeshes.set(n.id, v);
        this.nodeGroupView.set(n.id, v.group);
      }
      // Phase 3.8: nodes are visible iff alive AND discovered by the
      // player faction (or in observer mode). Discovery is permanent —
      // once shown, stays shown even outside current vision. The
      // input controller's pickLiveNode() iterates over visible
      // meshes, so this gate doubles as the click-to-assign filter.
      if (v) {
        v.group.visible = n.alive
          && (this.bypassVision || n.discoveredBy[this.playerFaction]);
        // Phase 3.10.9: per-frame remaining-amount label + silhouette
        // emissive fade. Pure presentation; sim hash is unaffected.
        // Using maxReserve as the "max" reference works for both
        // colour nodes (regenerating, real cap) and energy/flux nodes
        // (cap = initial remaining; the label still shows current and
        // the silhouette fades correctly as it drains).
        if (v.group.visible) {
          // Energy nodes: max-reserve = initial remaining (no regen).
          // We don't have a stored cap; derive it from the highest
          // value seen so the silhouette fade stays sensible.
          const seen = this.nodeMaxSeen.get(n.id);
          const max = seen === undefined || toFloat(n.remaining) > seen
            ? toFloat(n.remaining)
            : seen;
          this.nodeMaxSeen.set(n.id, max);
          v.setRemaining(toFloat(n.remaining), Math.max(max, 0.0001));
        }
      }
    }
  }

  private readonly nodeMaxSeen = new Map<number, number>();

  private syncStructures(dt: number): void {
    for (const s of this.sim.state.structures) {
      let v = this.structureMeshes.get(s.id);
      if (!v && s.alive) {
        if (s.kind === 'workPod') {
          v = buildWorkPodMesh(s.faction, toFloat(s.x), toFloat(s.y));
          v.group.userData.structureId = s.id;
          this.entitiesGroup.add(v.group);
          this.structureMeshes.set(s.id, v);
          this.structureGroupView.set(s.id, v.group);
        }
      }
      if (!v) continue;
      // Friendly structures always visible; enemy structures hidden
      // until in current vision.
      const isOwn = s.faction === this.playerFaction;
      v.group.visible = s.alive
        && (isOwn || this.bypassVision || this.isPositionExplored(s.x, s.y));
      if (!s.alive) continue;
      // Build progress ratio (0..1) drives the rising silhouette + dim
      // body / scaffolding fade.
      const total = STRUCTURE_STATS.workPod.buildTicks;
      const ratio = total === 0 ? 1 : 1 - s.buildTicksRemaining / total;
      v.setBuildProgress(ratio);
      // Phase C.4 building life — breathe the cap once the pod is built.
      // Runs after setBuildProgress so the swell sits on top of the resting
      // intensity it just set.
      v.tickLife(dt, s.buildTicksRemaining === 0);
      v.hpBar.update(toFloat(s.hp), toFloat(STRUCTURE_STATS.workPod.maxHp));
    }
  }

  private syncUnits(alpha: number, dt: number): void {
    // Phase C.4: collect work-state beams for visible working workers, then
    // reconcile the pool once after the loop.
    const beamSpecs: BeamSpec[] = [];
    for (const u of this.sim.state.units) {
      let v = this.unitMeshes.get(u.id);
      if (!v) {
        v = buildUnitMesh(u.kind, u.faction, toFloat(u.x), toFloat(u.y));
        v.group.userData.unitId = u.id;
        this.entitiesGroup.add(v.group);
        this.unitMeshes.set(u.id, v);
        this.unitGroupView.set(u.id, v.group);
        // Phase 3.9.6: this is the first time we've ever seen this id —
        // the unit was just spawned. Trigger the placement scale-in
        // pulse so the player's eye catches "a thing arrived here." On
        // initial scene load there are no pre-spawned units (only HQs),
        // so this fires only on actual TrainUnit / TrainAtStructure
        // commits.
        v.triggerPlacementPulse();
      }
      v.tickPlacementPulse(dt);

      // Phase 3.8: friendly units always visible; enemy units hidden
      // unless within the player's current vision. The position lerp
      // below uses the fresh sim coords either way.
      const isOwn = u.faction === this.playerFaction;
      const visible = u.alive
        && (isOwn || this.bypassVision || this.isPositionExplored(u.x, u.y));

      if (!u.alive) {
        // Phase 3.9.6: unit died this tick. Move the visual into the
        // dying pool — its death pulse plays out in tickDyingUnits
        // before the mesh is finally hidden + disposed. We *also*
        // remove it from unitMeshes so the next syncUnits doesn't
        // re-tick it as if alive.
        if (!this.dyingUnits.has(u.id)) {
          // Phase C.4: clear the at-rest/work-state cues so the corpse plays
          // its death pulse as a dark, grounded silhouette rather than a
          // lifted, glowing, charge-ringed worker frozen mid-state. dt=1
          // forces a full ease step so the move glow snaps to rest (the
          // dying pool never ticks setMoveGlow again).
          v.chargeRing.set(false, 0, dt);
          v.setMoveGlow(0, 1);
          v.setIdleBob(0);
          v.triggerDeathPulse();
          this.dyingUnits.set(u.id, v);
          this.unitMeshes.delete(u.id);
          this.unitGroupView.delete(u.id);
        }
        continue;
      }
      v.group.visible = visible;

      const curX = toFloat(u.x);
      const curY = toFloat(u.y);
      const prev = this.prevUnitPos.get(u.id);
      const lerpX = prev ? prev.x + (curX - prev.x) * alpha : curX;
      const lerpY = prev ? prev.y + (curY - prev.y) * alpha : curY;
      const w = tileFloatToWorld(lerpX, lerpY);
      // Group sits on the floor so the selection ring + chrome stay pinned;
      // the idle hover lifts only the body (below).
      v.group.position.set(w.x, 0, w.z);
      // Phase C.4 worker idle hover — a slow positive lift so a standing
      // worker reads alive without clipping the grid. Per-id phase offset
      // desyncs the crowd. Rides on top of the position lerp, so it's
      // harmless during movement (the distinct move cue lands separately).
      v.setIdleBob(workerHover(this.lifeClock + phaseOffset(u.id, WORKER_HOVER_PERIOD_S)));

      const maxHp = UNIT_STATS[u.kind].maxHp;
      v.hpBar.update(toFloat(u.hp), toFloat(maxHp));
      // Phase C.1/C.4: charge ring + (hidden) bar + energy cue. The ring is
      // the readable charge indicator; the bar is kept hidden for the
      // portrait + types. Cue ticks toward fade-out (trigger fires from
      // outside this method when the input controller blocks a cmd).
      if (u.kind === 'worker') {
        const charging = isInChargeMode(u);
        v.chargeRing.set(charging, u.maxCharge > 0 ? u.charge / u.maxCharge : 0, dt);
        v.chargeBar.update(u.charge, u.maxCharge);
        // Move cue — energise the body while the worker is in transit.
        const moving = u.phase === 'movingToNode'
          || u.phase === 'returning'
          || u.phase === 'movingToBuildSite'
          || u.phase === 'walkingToCharge';
        v.setMoveGlow(moving ? 1 : 0, dt);
        // Work-state beam — only for visible workers (no beams through fog).
        if (visible) {
          const beam = this.workBeamSpec(u, w.x, w.z);
          if (beam !== null) beamSpecs.push(beam);
        }
      }
      v.energyCue.tick(dt);
    }
    this.workBeams.sync(beamSpecs, dt);
  }

  // Phase C.4: build the work-state beam spec for a working worker, or null
  // when it's not in a beam-worthy phase (or its target has gone). Endpoints
  // are Three.js world XZ; colour reads the work-state. The target tile is
  // vision-gated (isPositionExplored) so a visible enemy worker can't draw a
  // beam into the fog and reveal an undiscovered node / pod / HQ.
  private workBeamSpec(u: Worker, fromX: number, fromZ: number): BeamSpec | null {
    switch (u.phase) {
      case 'harvesting': {
        const n = this.findAliveNode(u.targetNodeId);
        if (n === null || !this.isPositionExplored(n.x, n.y)) return null;
        const w = tileFloatToWorld(toFloat(n.x), toFloat(n.y));
        return { key: u.id, fromX, fromZ, toX: w.x, toZ: w.z, color: HARVEST_BEAM_COLOR };
      }
      case 'building': {
        const s = this.findAliveStructure(u.targetStructureId);
        if (s === null || !this.isPositionExplored(s.x, s.y)) return null;
        const w = tileFloatToWorld(toFloat(s.x), toFloat(s.y));
        return { key: u.id, fromX, fromZ, toX: w.x, toZ: w.z, color: FACTION_BEAM_COLOR[u.faction] };
      }
      case 'charging': {
        const spot = this.chargeSpotWorld(u);
        if (spot === null) return null;
        return { key: u.id, fromX, fromZ, toX: spot.x, toZ: spot.z, color: CHARGE_BEAM_COLOR };
      }
      default:
        return null;
    }
  }

  private findAliveNode(id: number): { x: Fixed; y: Fixed } | null {
    if (id === 0) return null;
    for (const n of this.sim.state.nodes) if (n.id === id && n.alive) return n;
    return null;
  }

  private findAliveStructure(id: number): { x: Fixed; y: Fixed } | null {
    if (id === 0) return null;
    for (const s of this.sim.state.structures) if (s.id === id && s.alive) return s;
    return null;
  }

  // The charge spot a worker is plugged into: a pod structure, or the faction
  // HQ when chargeTargetStructureId is 0 (HQs aren't in the structures array).
  // Vision-gated like the other beam targets — null when the spot is fogged.
  private chargeSpotWorld(u: Worker): { x: number; z: number } | null {
    if (u.chargeTargetStructureId !== 0) {
      const s = this.findAliveStructure(u.chargeTargetStructureId);
      if (s === null || !this.isPositionExplored(s.x, s.y)) return null;
      return tileFloatToWorld(toFloat(s.x), toFloat(s.y));
    }
    const fs = this.sim.state.factions[u.faction];
    if (!this.isPositionExplored(fs.hqX, fs.hqY)) return null;
    return tileFloatToWorld(toFloat(fs.hqX), toFloat(fs.hqY));
  }

  // Phase 3.9.6: advance the death-pulse animation on units that died
  // recently. Once the pulse completes, hide + remove the mesh.
  private tickDyingUnits(dt: number): void {
    for (const [id, v] of this.dyingUnits) {
      const stillPulsing = v.tickDeathPulse(dt);
      if (!stillPulsing) {
        v.group.visible = false;
        this.entitiesGroup.remove(v.group);
        this.dyingUnits.delete(id);
      }
    }
  }

  dispose(): void {
    this.workBeams.dispose();
    removeHoverHalos(this.hoverHalos);
    this.hoverGroup = null;
    for (const v of this.unitMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const v of this.nodeMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const v of this.structureMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const h of this.hqMeshes) if (h) this.entitiesGroup.remove(h.group);
    this.unitMeshes.clear();
    this.nodeMeshes.clear();
    this.structureMeshes.clear();
    this.unitGroupView.clear();
    this.nodeGroupView.clear();
    this.structureGroupView.clear();
    this.prevUnitPos.clear();
  }
}

// Hover-outline glow. Bloom now does most of the lifting via
// post-processing, so hover just bumps the linewidth of each glow
// edge to thicken the bloom-bearing pixels and stashes the original
// width for restoration on un-hover.
const HOVER_LINEWIDTH_FACTOR = 1.8;

interface HoverHaloRef {
  material: LineMaterial;
  originalLinewidth: number;
}

function applyHoverOutlineTint(group: THREE.Group, halos: HoverHaloRef[]): void {
  group.traverse((obj) => {
    if (!(obj instanceof LineSegments2)) return;
    const material = obj.material as LineMaterial;
    halos.push({ material, originalLinewidth: material.linewidth });
    material.linewidth = material.linewidth * HOVER_LINEWIDTH_FACTOR;
  });
}

function removeHoverHalos(halos: HoverHaloRef[]): void {
  for (const h of halos) {
    h.material.linewidth = h.originalLinewidth;
  }
  halos.length = 0;
}

