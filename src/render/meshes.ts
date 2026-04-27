// Mesh builders — facade over the prototype's Tron-style mesh code in
// `./legacy/`. The legacy modules carry both visual code and the
// prototype's per-entity state machines; we use only the visual side
// (group + selection ring + hp bar) and let the deterministic sim own
// all state. This restores the polished prototype look-and-feel that
// was lost in earlier sub-phases of Phase 1.

import * as THREE from 'three';
import type { Faction, ResourceKind, UnitKind } from '../sim/types';
import { buildHQ as legacyBuildHQ } from './legacy/hq';
import { buildWorker as legacyBuildWorker } from './legacy/worker';
import { buildDefender as legacyBuildDefender } from './legacy/defender';
import { buildRaider as legacyBuildRaider } from './legacy/raider';
import { buildEnergyNode as legacyBuildEnergyNode } from './legacy/energy-node';
import { buildHpBar, type HpBar } from './legacy/hp-bar';
import type { FactionId } from './legacy/placement';
import { GRID_CONSTANTS, tileToWorld } from './legacy/grid';

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
    case 'vanguard': {
      // Phase 3.2 placeholder: a scaled-up raider mesh. Faction-
      // asymmetric tier-2 visuals arrive in 3.4. The 1.5x scale on
      // x and z reads as "bigger raider" without sliding off the grid.
      const b = legacyBuildRaider(fid, tileX, tileY);
      b.mesh.scale.set(1.5, 1.5, 1.5);
      b.hpBar.group.visible = true;
      return { group: b.mesh, hpBar: b.hpBar, selectionRing: b.selectionRing };
    }
  }
}

// Phase 3.1: Flux nodes are visually distinct from Energy nodes —
// bright green rim instead of the legacy pale-cyan. Energy nodes keep
// the existing look for visual continuity.
//
// Phase 3.5: faction-locked colour nodes get the faction palette
// (cyan rim for blue / faction 0, red-orange for red / faction 1).
// Picking the rim colour the same way as the unit faction means the
// player reads "this is your colour" by sight without consulting a
// legend.
const FLUX_RIM_COLOR = 0x66ff44;
const BLUE_RIM_COLOR = 0x00e5ff;  // matches faction-0 (cyan) HQ + unit emissive
const RED_RIM_COLOR = 0xff6a33;   // matches faction-1 (red-orange)

export function buildNodeMesh(tileX: number, tileY: number, kind: ResourceKind = 'energy'): NodeVisual {
  const b = legacyBuildEnergyNode(tileX, tileY);
  const rim =
    kind === 'flux' ? FLUX_RIM_COLOR :
    kind === 'blue' ? BLUE_RIM_COLOR :
    kind === 'red' ? RED_RIM_COLOR :
    null;
  if (rim !== null) {
    b.group.traverse((obj) => {
      if (obj.name === 'node-rim' && obj instanceof THREE.Mesh) {
        const m = obj.material as THREE.MeshStandardMaterial;
        m.color.set(rim);
        m.emissive.set(rim);
      }
    });
  }
  return { group: b.group };
}

// Phase 3.0 production building. Visually a low boxy structure with
// faction-coloured edge trim — distinct from the HQ (which is a tiered
// spire) and from units. Faction-asymmetric silhouettes arrive in 3.4
// when each side gets its proper visual identity; this is a placeholder
// that reads as "a building that is not the HQ."
//
// While under construction (sim's buildTicksRemaining > 0), the body is
// dimmer; the renderer flips it to operational shading once build hits
// zero. Built once per structure id; the renderer doesn't re-create.

const PRODUCTION_FACTION_EMISSIVE: Record<FactionId, number> = {
  blue: 0x00e0ff,
  red: 0xff4a1a,
};
const PRODUCTION_BODY_COLOR = 0x0d1117;
const PRODUCTION_DIMENSIONS = {
  width: 0.7,
  height: 0.45,
  centerY: 0.225,
} as const;

export interface ProductionVisual {
  group: THREE.Group;
  hpBar: HpBar;
  // Sim-renderer calls this each frame so the building visually "fills
  // in" as it nears completion. ratio in [0, 1] where 0 = just placed,
  // 1 = operational. Cheap; sets material emissive intensity.
  setBuildProgress(ratio: number): void;
}

// Phase 3.2: same shape as ProductionVisual but the body is a tall slim
// cylinder so the Spire reads as a tech building, not a production
// hangar. Faction-asymmetric tier-2 visuals arrive in 3.4.
export interface UpgradeVisual {
  group: THREE.Group;
  hpBar: HpBar;
  setBuildProgress(ratio: number): void;
  // Pulse intensity while research is running. ratio 0 = idle, 1 =
  // mid-research; renderer hooks this off researchTicksRemaining.
  setResearchProgress(ratio: number): void;
}

export function buildProductionMesh(faction: Faction, tileX: number, tileY: number): ProductionVisual {
  const fid = factionToId(faction);
  const emissive = PRODUCTION_FACTION_EMISSIVE[fid];

  const group = new THREE.Group();
  group.name = `production-${fid}`;

  const geo = new THREE.BoxGeometry(
    PRODUCTION_DIMENSIONS.width,
    PRODUCTION_DIMENSIONS.height,
    PRODUCTION_DIMENSIONS.width,
  );
  const bodyMat = new THREE.MeshStandardMaterial({
    color: PRODUCTION_BODY_COLOR,
    emissive,
    emissiveIntensity: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const body = new THREE.Mesh(geo, bodyMat);
  body.position.y = PRODUCTION_DIMENSIONS.centerY;
  body.name = 'production-body';
  group.add(body);

  const edgesGeo = new THREE.EdgesGeometry(geo);
  const edgesMat = new THREE.LineBasicMaterial({ color: emissive });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  edges.position.y = PRODUCTION_DIMENSIONS.centerY;
  edges.name = 'production-trim';
  group.add(edges);

  const hpBar = buildHpBar(fid, PRODUCTION_DIMENSIONS.height + 0.4);
  hpBar.group.visible = true;
  group.add(hpBar.group);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  return {
    group,
    hpBar,
    setBuildProgress(ratio: number): void {
      // Under construction → trim is dimmed; operational → full intensity.
      // Linear blend for now; the visual pass in 3.4 can replace this
      // with a proper "scaffolding" or "rising-from-the-ground" effect.
      const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
      const trimMat = edges.material as THREE.LineBasicMaterial;
      trimMat.opacity = 0.25 + 0.75 * clamped;
      trimMat.transparent = clamped < 1;
      bodyMat.opacity = 0.4 + 0.6 * clamped;
      bodyMat.transparent = clamped < 1;
    },
  };
}

// Phase 3.2 upgrade structure (Spire). Tall slim cylinder with a glowing
// finial — visually distinct from Forges so the player can read at a
// glance which structure is which. Same build-progress fade as Forges.
const SPIRE_DIMS = {
  baseRadius: 0.32,
  topRadius: 0.18,
  height: 0.95,
  finialRadius: 0.16,
  finialHeight: 0.18,
} as const;

export function buildSpireMesh(faction: Faction, tileX: number, tileY: number): UpgradeVisual {
  const fid = factionToId(faction);
  const emissive = PRODUCTION_FACTION_EMISSIVE[fid];

  const group = new THREE.Group();
  group.name = `spire-${fid}`;

  const bodyGeo = new THREE.CylinderGeometry(
    SPIRE_DIMS.topRadius,
    SPIRE_DIMS.baseRadius,
    SPIRE_DIMS.height,
    16,
  );
  const bodyMat = new THREE.MeshStandardMaterial({
    color: PRODUCTION_BODY_COLOR,
    emissive,
    emissiveIntensity: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = SPIRE_DIMS.height / 2;
  body.name = 'spire-body';
  group.add(body);

  const finialGeo = new THREE.CylinderGeometry(
    SPIRE_DIMS.finialRadius,
    SPIRE_DIMS.finialRadius,
    SPIRE_DIMS.finialHeight,
    12,
  );
  const finialMat = new THREE.MeshStandardMaterial({
    color: emissive,
    emissive,
    emissiveIntensity: 1.5,
  });
  const finial = new THREE.Mesh(finialGeo, finialMat);
  finial.position.y = SPIRE_DIMS.height + SPIRE_DIMS.finialHeight / 2;
  finial.name = 'spire-finial';
  group.add(finial);

  const hpBar = buildHpBar(fid, SPIRE_DIMS.height + SPIRE_DIMS.finialHeight + 0.2);
  hpBar.group.visible = true;
  group.add(hpBar.group);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  return {
    group,
    hpBar,
    setBuildProgress(ratio: number): void {
      const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
      bodyMat.opacity = 0.4 + 0.6 * clamped;
      bodyMat.transparent = clamped < 1;
      finialMat.emissiveIntensity = 0.2 + 1.3 * clamped;
    },
    setResearchProgress(ratio: number): void {
      // Pulse the finial brighter while research is running so the
      // player can read "this Spire is busy" at a glance.
      const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
      finialMat.emissiveIntensity = clamped > 0 ? 1.5 + 1.5 * clamped : 1.5;
    },
  };
}

// Phase 3.6 Pylon (supply structure). A short truncated-cone base with
// a glowing cap on top — visually distinct from Forge (boxy) and Spire
// (tall finial), and small enough that two or three Pylons in the home
// patch don't crowd the silhouette. Same build-progress fade.
const PYLON_DIMS = {
  baseRadius: 0.28,
  topRadius: 0.18,
  height: 0.4,
  capRadius: 0.22,
  capHeight: 0.1,
} as const;

export interface SupplyVisual {
  group: THREE.Group;
  hpBar: HpBar;
  setBuildProgress(ratio: number): void;
}

// Phase 3.7: trail-segment mesh. A small flat glowing tile placed at
// the segment's tile coords. Per-segment material is unique so the
// renderer can fade opacity + emissive intensity with age. Cheap to
// construct (max ~40 segments per active trail × a few trails) but
// the per-tick rebuild pattern would still benefit from instancing
// if trail counts grow — punted to later sub-phases since the visual
// is already crisp at the current scale.
const TRAIL_SEGMENT_DIMS = {
  width: 0.32,
  height: 0.06,
} as const;

export interface TrailSegmentVisual {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

export function buildTrailSegmentMesh(faction: Faction, tileX: number, tileY: number): TrailSegmentVisual {
  const fid = factionToId(faction);
  const emissive = PRODUCTION_FACTION_EMISSIVE[fid];
  const geo = new THREE.BoxGeometry(
    TRAIL_SEGMENT_DIMS.width,
    TRAIL_SEGMENT_DIMS.height,
    TRAIL_SEGMENT_DIMS.width,
  );
  const material = new THREE.MeshStandardMaterial({
    color: emissive,
    emissive,
    emissiveIntensity: 1.4,
    transparent: true,
    opacity: 1,
  });
  const mesh = new THREE.Mesh(geo, material);
  // Compute world coords inline (tileX/tileY may be fractional — the
  // worker's sim position when the segment was laid). Same offset
  // formula as tileToWorld but without the integer-coord assertion.
  const offset = -GRID_CONSTANTS.worldExtent / 2 + GRID_CONSTANTS.tileSize / 2;
  const wx = offset + tileX * GRID_CONSTANTS.tileSize;
  const wz = offset + tileY * GRID_CONSTANTS.tileSize;
  // Sit just above the grid plane so the segment doesn't z-fight with
  // the tile mesh.
  mesh.position.set(wx, TRAIL_SEGMENT_DIMS.height / 2 + 0.01, wz);
  return { mesh, material };
}

export function buildPylonMesh(faction: Faction, tileX: number, tileY: number): SupplyVisual {
  const fid = factionToId(faction);
  const emissive = PRODUCTION_FACTION_EMISSIVE[fid];

  const group = new THREE.Group();
  group.name = `pylon-${fid}`;

  const bodyGeo = new THREE.CylinderGeometry(
    PYLON_DIMS.topRadius,
    PYLON_DIMS.baseRadius,
    PYLON_DIMS.height,
    12,
  );
  const bodyMat = new THREE.MeshStandardMaterial({
    color: PRODUCTION_BODY_COLOR,
    emissive,
    emissiveIntensity: 0.08,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = PYLON_DIMS.height / 2;
  body.name = 'pylon-body';
  group.add(body);

  // Glowing cap on top — reads "this is the supply broadcaster" at a
  // glance.
  const capGeo = new THREE.CylinderGeometry(
    PYLON_DIMS.capRadius,
    PYLON_DIMS.capRadius,
    PYLON_DIMS.capHeight,
    12,
  );
  const capMat = new THREE.MeshStandardMaterial({
    color: emissive,
    emissive,
    emissiveIntensity: 1.2,
  });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = PYLON_DIMS.height + PYLON_DIMS.capHeight / 2;
  cap.name = 'pylon-cap';
  group.add(cap);

  const hpBar = buildHpBar(fid, PYLON_DIMS.height + PYLON_DIMS.capHeight + 0.2);
  hpBar.group.visible = true;
  group.add(hpBar.group);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  return {
    group,
    hpBar,
    setBuildProgress(ratio: number): void {
      const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
      bodyMat.opacity = 0.4 + 0.6 * clamped;
      bodyMat.transparent = clamped < 1;
      capMat.emissiveIntensity = 0.2 + 1.0 * clamped;
    },
  };
}
