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
import { distSq, rangeSq, toFloat, type Fixed } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import { HQ_VISION_RADIUS, STRUCTURE_STATS, UNIT_STATS } from '../sim/units-config';
import {
  buildHqMesh,
  buildNodeMesh,
  buildProductionMesh,
  buildPylonMesh,
  buildSpireMesh,
  buildTrailSegmentMesh,
  buildUnitMesh,
  type HqVisual,
  type UnitVisual,
  type NodeVisual,
  type ProductionVisual,
  type SupplyVisual,
  type UpgradeVisual,
} from './meshes';
import { tileFloatToWorld } from './scene';
import { TRAIL_SEGMENT_LIFETIME } from '../sim/units-config';

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

  private readonly hqMeshes: [HqVisual | null, HqVisual | null] = [null, null];
  private readonly unitMeshes = new Map<number, UnitVisual>();
  private readonly nodeMeshes = new Map<number, NodeVisual>();
  private readonly structureMeshes = new Map<number, ProductionVisual | UpgradeVisual | SupplyVisual>();
  // Phase 3.7: per-trail group of segment meshes. Re-built each frame
  // from the current sim segments (cheap — small counts; correct
  // because segments enter / leave / age in lockstep with sim time).
  private readonly trailGroups = new Map<number, THREE.Group>();
  private readonly prevUnitPos = new Map<number, PrevPosition>();

  // Phase 3.8: per-frame friendly vision-source cache. Refilled at the
  // top of update() so each enemy entity's visibility test is a linear
  // scan over a small list rather than a re-iteration of state.
  private readonly visionSources: VisionSource[] = [];

  // Combined raycast-target views for the input controller.
  private readonly unitGroupView = new Map<number, THREE.Group>();
  private readonly nodeGroupView = new Map<number, THREE.Group>();
  // Phase 3.10.3: structure + HQ raycast registries for the input
  // controller. Same shape as the unit/node maps; populated lazily as
  // sim-renderer creates the meshes.
  private readonly structureGroupView = new Map<number, THREE.Group>();
  private readonly hqGroupView = new Map<Faction, THREE.Group>();

  constructor(sim: Sim, entitiesGroup: THREE.Group, playerFaction: Faction, bypassVision = false) {
    this.sim = sim;
    this.entitiesGroup = entitiesGroup;
    this.playerFaction = playerFaction;
    this.bypassVision = bypassVision;
    this.spawnHqs();
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

    this.collectVisionSources();
    this.syncHqs();
    this.syncNodes();
    this.syncStructures();
    this.syncUnits(alpha, dt);
    this.tickDyingUnits(dt);
    this.syncTrails();
  }

  // Phase 3.9.6: track wall-clock time for animation tick deltas, and
  // a side-pool of meshes that are mid-death-pulse (the unit is dead in
  // sim but the mesh stays visible until the pulse finishes).
  private lastAnimMs = -1;
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
    for (const s of this.sim.state.structures) {
      if (!s.alive || s.faction !== this.playerFaction) continue;
      this.visionSources.push({
        x: s.x,
        y: s.y,
        radiusSq: rangeSq(STRUCTURE_STATS[s.kind].visionRadius),
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
  ): void {
    for (const [id, vis] of this.unitMeshes) {
      vis.selectionRing.visible = selectedUnitIds.has(id);
    }
    for (const [id, vis] of this.structureMeshes) {
      vis.selectionRing.visible = id === selectedStructureId;
    }
    for (const f of [0, 1] as const) {
      const v = this.hqMeshes[f];
      if (v) v.selectionRing.visible = f === selectedHqFaction;
    }
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

  private syncHqs(): void {
    for (const f of [0, 1] as const) {
      const v = this.hqMeshes[f];
      if (!v) continue;
      const fs = this.sim.state.factions[f];
      // Phase 3.8: enemy HQ hidden until in the player's vision.
      // Friendly HQ always visible.
      const isOwn = f === this.playerFaction;
      v.group.visible = isOwn || this.bypassVision || this.isPositionVisible(fs.hqX, fs.hqY);
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
      }
    }
  }

  private syncStructures(): void {
    for (const s of this.sim.state.structures) {
      let v = this.structureMeshes.get(s.id);
      if (!v && s.alive) {
        if (s.kind === 'production') {
          v = buildProductionMesh(s.faction, toFloat(s.x), toFloat(s.y));
        } else if (s.kind === 'upgrade') {
          v = buildSpireMesh(s.faction, toFloat(s.x), toFloat(s.y));
        } else if (s.kind === 'supply') {
          v = buildPylonMesh(s.faction, toFloat(s.x), toFloat(s.y));
        }
        if (v !== undefined) {
          // Phase 3.10.3: tag + register for raycast picking.
          v.group.userData.structureId = s.id;
          this.entitiesGroup.add(v.group);
          this.structureMeshes.set(s.id, v);
          this.structureGroupView.set(s.id, v.group);
        }
      }
      if (!v) continue;
      // Phase 3.8: friendly structures always visible; enemy structures
      // hidden until in the player's current vision. Per-tick presence
      // (no last-known-position memory in v1).
      const isOwn = s.faction === this.playerFaction;
      const visible = s.alive
        && (isOwn || this.bypassVision || this.isPositionVisible(s.x, s.y));
      v.group.visible = visible;
      if (!s.alive) continue;

      const stats = STRUCTURE_STATS[s.kind];
      const buildTotal = stats.buildTicks;
      const buildRatio = buildTotal === 0 ? 1 : 1 - s.buildTicksRemaining / buildTotal;
      v.setBuildProgress(buildRatio);
      v.hpBar.update(toFloat(s.hp), toFloat(stats.maxHp));

      // Phase 3.10.7: scaffolding pulse + slow rotation while in
      // build phase. setBuildProgress already toggled visibility; we
      // just animate the live ring on top of that.
      if (v.scaffoldingRing.visible) {
        const t = performance.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.6); // 0..1
        const mat = v.scaffoldingRing.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.4 + 1.4 * pulse;
        mat.opacity = 0.35 + 0.45 * pulse;
        v.scaffoldingRing.rotation.z = t * 0.6;
      }

      // Upgrade-only: pulse the finial while research is running.
      if (s.kind === 'upgrade') {
        const upgradeVis = v as UpgradeVisual;
        // Pulse intensity tracks fraction-completed so the finial
        // brightens through the research window. researchTicksRemaining
        // counts down from TIER2_RESEARCH_TICKS to 0.
        const total = 80; // TIER2_RESEARCH_TICKS — kept inline to avoid pulling sim constants here
        const ratio = s.researchTicksRemaining > 0
          ? 1 - s.researchTicksRemaining / total
          : 0;
        upgradeVis.setResearchProgress(ratio);
      }
    }
  }

  private syncUnits(alpha: number, dt: number): void {
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
        && (isOwn || this.bypassVision || this.isPositionVisible(u.x, u.y));

      if (!u.alive) {
        // Phase 3.9.6: unit died this tick. Move the visual into the
        // dying pool — its death pulse plays out in tickDyingUnits
        // before the mesh is finally hidden + disposed. We *also*
        // remove it from unitMeshes so the next syncUnits doesn't
        // re-tick it as if alive.
        if (!this.dyingUnits.has(u.id)) {
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
      v.group.position.set(w.x, 0, w.z);

      const maxHp = UNIT_STATS[u.kind].maxHp;
      v.hpBar.update(toFloat(u.hp), toFloat(maxHp));
    }
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

  // Phase 3.7: trail rendering. Per-trail Three.js group containing
  // one small glowing tile per segment. Re-built each frame because:
  // (a) segments are cheap (max ~40 per active trail × a few trails);
  // (b) age determines opacity/intensity, which would otherwise need
  // per-segment material tracking; (c) per-tick segment add + drop
  // sequences are simpler to express by full rebuild than by diffing.
  // If trail counts blow up, switch to InstancedMesh + per-instance
  // material attributes.
  private syncTrails(): void {
    const sim = this.sim.state;
    // Tear down dead trails first so we can short-circuit alive
    // iteration. Iterate the renderer's map (not sim.trails) so dead
    // trails not present in sim get cleaned up too.
    for (const [trailId, group] of this.trailGroups) {
      const t = sim.trails.find((x) => x.id === trailId);
      if (!t || !t.alive) {
        this.entitiesGroup.remove(group);
        this.disposeGroup(group);
        this.trailGroups.delete(trailId);
      }
    }
    for (const t of sim.trails) {
      if (!t.alive) continue;
      let group = this.trailGroups.get(t.id);
      if (!group) {
        group = new THREE.Group();
        group.name = `trail-${t.id}`;
        this.entitiesGroup.add(group);
        this.trailGroups.set(t.id, group);
      }
      // Rebuild segments. Cleanup first so material/geometry don't leak.
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        if (child instanceof THREE.Mesh) {
          (child.geometry as THREE.BufferGeometry).dispose();
          (child.material as THREE.MeshStandardMaterial).dispose();
        }
      }
      const lifetime = sim.factions[t.ownerFaction].trailDurationResearched
        ? TRAIL_SEGMENT_LIFETIME * 2
        : TRAIL_SEGMENT_LIFETIME;
      for (const seg of t.segments) {
        const fade = Math.max(0, 1 - seg.age / lifetime);
        const visual = buildTrailSegmentMesh(t.ownerFaction, toFloat(seg.x), toFloat(seg.y));
        visual.material.opacity = 0.2 + 0.8 * fade;
        visual.material.emissiveIntensity = 0.4 + 1.4 * fade;
        group.add(visual.mesh);
      }
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.geometry as THREE.BufferGeometry).dispose();
        (obj.material as THREE.MeshStandardMaterial).dispose();
      }
    });
  }

  dispose(): void {
    for (const v of this.unitMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const v of this.nodeMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const v of this.structureMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const g of this.trailGroups.values()) {
      this.entitiesGroup.remove(g);
      this.disposeGroup(g);
    }
    for (const h of this.hqMeshes) if (h) this.entitiesGroup.remove(h.group);
    this.unitMeshes.clear();
    this.nodeMeshes.clear();
    this.structureMeshes.clear();
    this.trailGroups.clear();
    this.unitGroupView.clear();
    this.nodeGroupView.clear();
    this.prevUnitPos.clear();
  }
}
