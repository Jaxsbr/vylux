// Reconciles sim state with Three.js mesh state.
//
// Lifecycle:
// - capturePrev() snapshots positions just before a sim tick advances,
//   so the renderer has a "from" position for interpolation.
// - update(alpha) reads current sim state, lerps positions from the
//   captured snapshot to the live state, and updates each mesh.
//   Newly-spawned units get a mesh; dead units (alive=false) get
//   theirs hidden (kept around for potential resurrection / cleanup).
//
// The sim is the source of truth. This module never writes back into
// sim state — it's a one-way consumer (PRD §3.3).

import * as THREE from 'three';
import { toFloat } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { EnergyNode, Unit } from '../sim/types';
import { buildHqMesh, buildNodeMesh, buildUnitMesh } from './meshes';
import { tileFloatToWorld } from './scene';

interface PrevPosition {
  x: number;
  y: number;
}

export class SimRenderer {
  private readonly entitiesGroup: THREE.Group;
  private readonly sim: Sim;

  // Mesh registries — one per kind so we can dispose materials cleanly
  // if needed and so HQs don't get confused with units (HQs share the
  // FactionState rather than the unit array).
  private readonly hqMeshes: [THREE.Group | null, THREE.Group | null] = [null, null];
  private readonly unitMeshes = new Map<number, THREE.Group>();
  private readonly nodeMeshes = new Map<number, THREE.Group>();

  // Position snapshot taken just before a sim tick. Lerp source for
  // smooth movement at render rate.
  private readonly prevUnitPos = new Map<number, PrevPosition>();

  constructor(sim: Sim, entitiesGroup: THREE.Group) {
    this.sim = sim;
    this.entitiesGroup = entitiesGroup;
    this.spawnHqs();
  }

  // Call BEFORE sim.step() to remember positions for interpolation.
  capturePrev(): void {
    this.prevUnitPos.clear();
    for (const u of this.sim.state.units) {
      if (!u.alive) continue;
      this.prevUnitPos.set(u.id, { x: toFloat(u.x), y: toFloat(u.y) });
    }
  }

  // Call every render frame. `alpha` ∈ [0, 1] is the fraction of the
  // current sim tick that has elapsed in wall-clock since capturePrev().
  update(alpha: number): void {
    this.syncNodes();
    this.syncUnits(alpha);
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
      let mesh = this.unitMeshes.get(u.id);
      if (!mesh) {
        mesh = buildUnitMesh(u.kind, u.faction);
        this.entitiesGroup.add(mesh);
        this.unitMeshes.set(u.id, mesh);
      }
      mesh.visible = u.alive;
      if (!u.alive) continue;

      const curX = toFloat(u.x);
      const curY = toFloat(u.y);
      const prev = this.prevUnitPos.get(u.id);
      const lerpX = prev ? prev.x + (curX - prev.x) * alpha : curX;
      const lerpY = prev ? prev.y + (curY - prev.y) * alpha : curY;
      const w = tileFloatToWorld(lerpX, lerpY);
      mesh.position.set(w.x, 0, w.z);
    }
  }

  // Clean up all meshes — call when changing scenes or restarting a match.
  // Material disposal is best-effort; modern Three.js lets us leak briefly
  // without correctness issues.
  dispose(): void {
    for (const m of this.unitMeshes.values()) this.entitiesGroup.remove(m);
    for (const m of this.nodeMeshes.values()) this.entitiesGroup.remove(m);
    for (const h of this.hqMeshes) if (h) this.entitiesGroup.remove(h);
    this.unitMeshes.clear();
    this.nodeMeshes.clear();
    this.prevUnitPos.clear();
  }
}

// Read-only snapshot helpers for tests / overlays — not used by the
// renderer itself but useful for input layers in 1.5.
export function unitForRenderable(u: Unit): { id: number; kind: string; alive: boolean } {
  return { id: u.id, kind: u.kind, alive: u.alive };
}

export function nodeForRenderable(n: EnergyNode): { id: number; alive: boolean } {
  return { id: n.id, alive: n.alive };
}
