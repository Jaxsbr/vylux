// Reconciles sim state with Three.js mesh state.
//
// Lifecycle:
// - capturePrev() snapshots positions just before a sim tick advances,
//   so the renderer has a "from" position for interpolation.
// - update(alpha) reads current sim state, lerps positions from the
//   captured snapshot to the live state, and updates each mesh.
//   Newly-spawned units get a mesh; dead units (alive=false) get
//   theirs hidden (kept around for potential resurrection / cleanup).
// - applyInputVisuals(selectedUnitId) updates the selection ring under
//   the selected unit. Lives on this class because it needs access to
//   the same unit-mesh registry used for entity reconciliation.
//
// The sim is the source of truth. This module never writes back into
// sim state — it's a one-way consumer (PRD §3.3).

import * as THREE from 'three';
import { toFloat } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import { UNIT_STATS } from '../sim/units-config';
import {
  buildHpBar,
  buildHqMesh,
  buildNodeMesh,
  buildSelectionRing,
  buildUnitMesh,
  type HpBarBundle,
} from './meshes';
import { tileFloatToWorld } from './scene';

interface PrevPosition {
  x: number;
  y: number;
}

interface UnitMeshBundle {
  group: THREE.Group;
  hpBar: HpBarBundle;
}

export class SimRenderer {
  private readonly entitiesGroup: THREE.Group;
  private readonly sim: Sim;

  private readonly hqMeshes: [THREE.Group | null, THREE.Group | null] = [null, null];
  private readonly unitMeshes = new Map<number, UnitMeshBundle>();
  private readonly nodeMeshes = new Map<number, THREE.Group>();
  private readonly prevUnitPos = new Map<number, PrevPosition>();

  private readonly selectionRing: THREE.Mesh = buildSelectionRing();

  constructor(sim: Sim, entitiesGroup: THREE.Group, _playerFaction: Faction) {
    this.sim = sim;
    this.entitiesGroup = entitiesGroup;
    // playerFaction reserved for future per-player visuals (e.g. fog of
    // war in Phase 3); unused today but kept on the constructor signature
    // so call sites don't churn when it lands.
    void _playerFaction;
    this.selectionRing.visible = false;
    this.entitiesGroup.add(this.selectionRing);
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
    this.syncNodes();
    this.syncUnits(alpha);
  }

  // Read-only mesh registries used by the input controller for raycasting.
  get unitMeshMap(): ReadonlyMap<number, THREE.Group> {
    const view = new Map<number, THREE.Group>();
    for (const [id, bundle] of this.unitMeshes) view.set(id, bundle.group);
    return view;
  }

  get nodeMeshMap(): ReadonlyMap<number, THREE.Group> {
    return this.nodeMeshes;
  }

  applyInputVisuals(selectedUnitId: number | null): void {
    this.applySelectionRing(selectedUnitId);
  }

  private applySelectionRing(selectedUnitId: number | null): void {
    if (selectedUnitId === null) {
      this.selectionRing.visible = false;
      return;
    }
    const u = this.sim.state.units.find((x) => x.id === selectedUnitId);
    if (!u || !u.alive) {
      this.selectionRing.visible = false;
      return;
    }
    const w = tileFloatToWorld(toFloat(u.x), toFloat(u.y));
    this.selectionRing.position.set(w.x, 0.04, w.z);
    this.selectionRing.visible = true;
  }

  private spawnHqs(): void {
    for (const f of [0, 1] as const) {
      const fs = this.sim.state.factions[f];
      const mesh = buildHqMesh(f);
      const w = tileFloatToWorld(toFloat(fs.hqX), toFloat(fs.hqY));
      mesh.position.set(w.x, 0, w.z);
      this.entitiesGroup.add(mesh);
      this.hqMeshes[f] = mesh;
    }
  }

  private syncNodes(): void {
    for (const n of this.sim.state.nodes) {
      let mesh = this.nodeMeshes.get(n.id);
      if (!mesh && n.alive) {
        mesh = buildNodeMesh();
        mesh.userData.nodeId = n.id;
        const w = tileFloatToWorld(toFloat(n.x), toFloat(n.y));
        mesh.position.set(w.x, 0, w.z);
        this.entitiesGroup.add(mesh);
        this.nodeMeshes.set(n.id, mesh);
      }
      if (mesh) mesh.visible = n.alive;
    }
  }

  private syncUnits(alpha: number): void {
    for (const u of this.sim.state.units) {
      let bundle = this.unitMeshes.get(u.id);
      if (!bundle) {
        const group = buildUnitMesh(u.kind, u.faction);
        group.userData.unitId = u.id;
        const hpBar = buildHpBar(u.faction);
        // Position the HP bar above the unit silhouette.
        hpBar.group.position.y = 0.9;
        group.add(hpBar.group);
        this.entitiesGroup.add(group);
        bundle = { group, hpBar };
        this.unitMeshes.set(u.id, bundle);
      }
      bundle.group.visible = u.alive;
      if (!u.alive) continue;

      const curX = toFloat(u.x);
      const curY = toFloat(u.y);
      const prev = this.prevUnitPos.get(u.id);
      const lerpX = prev ? prev.x + (curX - prev.x) * alpha : curX;
      const lerpY = prev ? prev.y + (curY - prev.y) * alpha : curY;
      const w = tileFloatToWorld(lerpX, lerpY);
      bundle.group.position.set(w.x, 0, w.z);

      // HP bar: scale fill by hp / maxHp, anchored at the left edge so
      // damage shrinks the bar from the right.
      const maxHp = UNIT_STATS[u.kind].maxHp;
      const ratio = maxHp === 0 ? 0 : Math.max(0, Math.min(1, u.hp / maxHp));
      bundle.hpBar.fill.scale.x = Math.max(0.001, ratio);
      bundle.hpBar.fill.position.x = -((1 - ratio) * 0.58) / 2;
    }
  }

  dispose(): void {
    for (const b of this.unitMeshes.values()) this.entitiesGroup.remove(b.group);
    for (const m of this.nodeMeshes.values()) this.entitiesGroup.remove(m);
    for (const h of this.hqMeshes) if (h) this.entitiesGroup.remove(h);
    this.entitiesGroup.remove(this.selectionRing);
    this.unitMeshes.clear();
    this.nodeMeshes.clear();
    this.prevUnitPos.clear();
  }
}
