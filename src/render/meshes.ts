// Mesh builders — facade over the prototype's Tron-style mesh code in
// `./legacy/`. The legacy modules carry both visual code and the
// prototype's per-entity state machines; we use only the visual side
// (group + selection ring + hp bar) and let the deterministic sim own
// all state. This restores the polished prototype look-and-feel that
// was lost in earlier sub-phases of Phase 1.

import * as THREE from 'three';
import type { Faction, UnitKind } from '../sim/types';
import { buildHQ as legacyBuildHQ } from './legacy/hq';
import { buildWorker as legacyBuildWorker } from './legacy/worker';
import { buildDefender as legacyBuildDefender } from './legacy/defender';
import { buildRaider as legacyBuildRaider } from './legacy/raider';
import { buildEnergyNode as legacyBuildEnergyNode } from './legacy/energy-node';
import type { HpBar } from './legacy/hp-bar';
import type { FactionId } from './legacy/placement';

function factionToId(f: Faction): FactionId {
  return f === 0 ? 'blue' : 'red';
}

export interface HqVisual {
  group: THREE.Group;
  hpBar: HpBar;
  selectionRing: THREE.Mesh;
}

export interface UnitVisual {
  group: THREE.Group;
  hpBar: HpBar;
  selectionRing: THREE.Mesh;
}

export interface NodeVisual {
  group: THREE.Group;
}

export function buildHqMesh(faction: Faction, tileX: number, tileY: number): HqVisual {
  const b = legacyBuildHQ(factionToId(faction), tileX, tileY);
  return { group: b.group, hpBar: b.hpBar, selectionRing: b.selectionRing };
}

export function buildUnitMesh(
  kind: UnitKind,
  faction: Faction,
  tileX = 0,
  tileY = 0,
): UnitVisual {
  const fid = factionToId(faction);
  switch (kind) {
    case 'worker': {
      const b = legacyBuildWorker(fid, tileX, tileY);
      // The legacy worker keeps its hp bar hidden by default and pops it
      // on damage; for a cleaner read against the deterministic sim we
      // show it always. The hpBar.update(hp, max) call from sim-renderer
      // keeps the fill correct.
      b.hpBar.group.visible = true;
      return { group: b.mesh, hpBar: b.hpBar, selectionRing: b.selectionRing };
    }
    case 'defender': {
      const b = legacyBuildDefender(fid, tileX, tileY);
      b.hpBar.group.visible = true;
      return { group: b.mesh, hpBar: b.hpBar, selectionRing: b.selectionRing };
    }
    case 'raider': {
      const b = legacyBuildRaider(fid, tileX, tileY);
      b.hpBar.group.visible = true;
      return { group: b.mesh, hpBar: b.hpBar, selectionRing: b.selectionRing };
    }
  }
}

export function buildNodeMesh(tileX: number, tileY: number): NodeVisual {
  const b = legacyBuildEnergyNode(tileX, tileY);
  return { group: b.group };
}
