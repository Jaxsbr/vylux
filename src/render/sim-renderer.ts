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
import { toFloat } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import { UNIT_STATS } from '../sim/units-config';
import {
  buildHqMesh,
  buildNodeMesh,
  buildUnitMesh,
  type HqVisual,
  type UnitVisual,
  type NodeVisual,
} from './meshes';
import { tileFloatToWorld } from './scene';

interface PrevPosition {
  x: number;
  y: number;
}

export class SimRenderer {
  private readonly entitiesGroup: THREE.Group;
  private readonly sim: Sim;

  private readonly hqMeshes: [HqVisual | null, HqVisual | null] = [null, null];
  private readonly unitMeshes = new Map<number, UnitVisual>();
  private readonly nodeMeshes = new Map<number, NodeVisual>();
  private readonly prevUnitPos = new Map<number, PrevPosition>();

  // Combined raycast-target views for the input controller.
  private readonly unitGroupView = new Map<number, THREE.Group>();
  private readonly nodeGroupView = new Map<number, THREE.Group>();

  constructor(sim: Sim, entitiesGroup: THREE.Group, _playerFaction: Faction) {
    this.sim = sim;
    this.entitiesGroup = entitiesGroup;
    void _playerFaction; // reserved for fog-of-war / faction-specific visuals (Phase 3)
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
    this.syncHqs();
    this.syncNodes();
    this.syncUnits(alpha);
  }

  // Read-only mesh registries used by the input controller for raycasting.
  get unitMeshMap(): ReadonlyMap<number, THREE.Group> {
    return this.unitGroupView;
  }

  get nodeMeshMap(): ReadonlyMap<number, THREE.Group> {
    return this.nodeGroupView;
  }

  // Each unit/HQ owns its own selection ring; toggling one ring
  // requires walking the registry. Cheap (entity counts are small).
  applyInputVisuals(selectedUnitId: number | null): void {
    for (const [id, vis] of this.unitMeshes) {
      vis.selectionRing.visible = id === selectedUnitId;
    }
  }

  private spawnHqs(): void {
    for (const f of [0, 1] as const) {
      const fs = this.sim.state.factions[f];
      const v = buildHqMesh(f, toFloat(fs.hqX), toFloat(fs.hqY));
      this.entitiesGroup.add(v.group);
      this.hqMeshes[f] = v;
    }
  }

  private syncHqs(): void {
    for (const f of [0, 1] as const) {
      const v = this.hqMeshes[f];
      if (!v) continue;
      const fs = this.sim.state.factions[f];
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
        v = buildNodeMesh(toFloat(n.x), toFloat(n.y));
        v.group.userData.nodeId = n.id;
        this.entitiesGroup.add(v.group);
        this.nodeMeshes.set(n.id, v);
        this.nodeGroupView.set(n.id, v.group);
      }
      if (v) v.group.visible = n.alive;
    }
  }

  private syncUnits(alpha: number): void {
    for (const u of this.sim.state.units) {
      let v = this.unitMeshes.get(u.id);
      if (!v) {
        v = buildUnitMesh(u.kind, u.faction, toFloat(u.x), toFloat(u.y));
        v.group.userData.unitId = u.id;
        this.entitiesGroup.add(v.group);
        this.unitMeshes.set(u.id, v);
        this.unitGroupView.set(u.id, v.group);
      }
      v.group.visible = u.alive;
      if (!u.alive) continue;

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

  dispose(): void {
    for (const v of this.unitMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const v of this.nodeMeshes.values()) this.entitiesGroup.remove(v.group);
    for (const h of this.hqMeshes) if (h) this.entitiesGroup.remove(h.group);
    this.unitMeshes.clear();
    this.nodeMeshes.clear();
    this.unitGroupView.clear();
    this.nodeGroupView.clear();
    this.prevUnitPos.clear();
  }
}
