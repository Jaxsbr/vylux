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

// Phase 3.9.3: visual-scale pass. The legacy meshes were sized for a
// 20×20 grid where one tile = ~one screen-cm; on the 32×32 grid (3.4)
// units read as ant-sized against the larger map. These scales fatten
// each mesh on its existing footprint without changing the sim's
// per-tile coordinates — the sim still sees a unit as a point at its
// (x,y), the renderer just draws a bigger silhouette. Selection rings
// + HP bars scale with the group so all the visual chrome stays in
// proportion.
//
// Sim-renderer never writes to .scale, so setting it once at build is
// stable across the lifetime of the mesh. The legacy placement-pulse
// animation that reset scale to 1 internally is not driven by the
// current Phase 3 sim-renderer (no external tickPlacementPulse caller),
// so scale stays at whatever we set here.
const UNIT_SCALE = 1.8;
const HQ_SCALE = 2.0;
const PRODUCTION_SCALE = 1.9;
const SPIRE_SCALE = 1.4;
const PYLON_SCALE = 1.4;

export interface HqVisual {
  group: THREE.Group;
  hpBar: HpBar;
  selectionRing: THREE.Mesh;
}

export interface UnitVisual {
  group: THREE.Group;
  hpBar: HpBar;
  selectionRing: THREE.Mesh;
  // Phase 3.9.6 animation API. The legacy mesh modules have these built
  // in already (placement scale-in + death emissive spike); 3.9.6 just
  // surfaces them through the wrapper interface. tickDeathPulse returns
  // true while the pulse is still running; sim-renderer waits on that
  // to dispose the mesh after a unit dies.
  triggerPlacementPulse(): void;
  triggerDeathPulse(): void;
  tickPlacementPulse(dt: number): void;
  tickDeathPulse(dt: number): boolean;
  readonly deathPulseActive: boolean;
}

export interface NodeVisual {
  group: THREE.Group;
  // Phase 3.10.9: per-frame "remaining" label update. The renderer
  // calls this each tick with the sim node's current remaining value;
  // the sprite label updates its text + fades when the node is nearly
  // empty. Pure presentation — sim hash is unaffected.
  setRemaining(value: number, max: number): void;
}

export function buildHqMesh(faction: Faction, tileX: number, tileY: number): HqVisual {
  const b = legacyBuildHQ(factionToId(faction), tileX, tileY);
  b.group.scale.set(HQ_SCALE, HQ_SCALE, HQ_SCALE);
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
      b.mesh.scale.set(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE);
      return wrapUnitVisual(b);
    }
    case 'defender': {
      const b = legacyBuildDefender(fid, tileX, tileY);
      b.hpBar.group.visible = true;
      b.mesh.scale.set(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE);
      return wrapUnitVisual(b);
    }
    case 'raider': {
      const b = legacyBuildRaider(fid, tileX, tileY);
      b.hpBar.group.visible = true;
      b.mesh.scale.set(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE);
      return wrapUnitVisual(b);
    }
    case 'vanguard': {
      // Phase 3.2 placeholder: a scaled-up raider mesh. Faction-
      // asymmetric tier-2 visuals arrive in 3.10. Vanguard reads as
      // ~1.5× a raider — apply that on top of the unit-wide UNIT_SCALE.
      const b = legacyBuildRaider(fid, tileX, tileY);
      const s = UNIT_SCALE * 1.5;
      b.mesh.scale.set(s, s, s);
      b.hpBar.group.visible = true;
      return wrapUnitVisual(b);
    }
  }
}

// Phase 3.9.6: forward the legacy mesh's pulse API through UnitVisual.
// All three legacy unit modules expose the same shape — placement +
// death pulse triggers + per-frame tickers — so the wrapper is uniform.
interface LegacyUnitMesh {
  mesh: THREE.Group;
  hpBar: HpBar;
  selectionRing: THREE.Mesh;
  triggerPlacementPulse(): void;
  triggerDeathPulse(): void;
  tickPlacementPulse(dt: number): void;
  tickDeathPulse(dt: number): boolean;
  readonly deathPulseActive: boolean;
}

function wrapUnitVisual(b: LegacyUnitMesh): UnitVisual {
  return {
    group: b.mesh,
    hpBar: b.hpBar,
    selectionRing: b.selectionRing,
    triggerPlacementPulse: () => b.triggerPlacementPulse(),
    triggerDeathPulse: () => b.triggerDeathPulse(),
    tickPlacementPulse: (dt) => b.tickPlacementPulse(dt),
    tickDeathPulse: (dt) => b.tickDeathPulse(dt),
    get deathPulseActive() { return b.deathPulseActive; },
  };
}

// Phase 3.10.9 — per-kind node visual identity. Each resource type
// gets a distinct silhouette + emissive palette layered on top of the
// shared legacy hex base, so a player can read "what kind of node is
// this" at a glance without consulting a legend or hovering for a
// tooltip. Matches the action-bar cost-glyph palette (E gold, F green,
// own colour faction-tinted).
//
// Energy → warm gold pylon (a tall slim octahedron pointing up).
// Flux   → green-teal floating crystal cluster (three small octahedra).
// Blue   → cyan diamond spire (tall stretched octahedron).
// Red    → red-orange spike (cone, wider base).
//
// Each node also carries a sprite-text label that always faces the
// camera, displaying the current remaining amount. Updated per frame
// from the sim's `remaining` value via NodeVisual.setRemaining().
const NODE_PALETTE: Record<ResourceKind, number> = {
  energy: 0xffd166, // gold — matches action-bar 'E' cost glyph
  flux:   0xa3ff66, // green — matches action-bar 'F' cost glyph
  blue:   0x00e5ff, // cyan — matches faction 0 + 'C' cost glyph
  red:    0xff6a33, // red-orange — matches faction 1 + 'C' cost glyph
};

export function buildNodeMesh(tileX: number, tileY: number, kind: ResourceKind = 'energy'): NodeVisual {
  const b = legacyBuildEnergyNode(tileX, tileY);
  const colour = NODE_PALETTE[kind];

  // Tint the legacy hex-base rim per kind so the disc reads as the
  // right resource even before the silhouette is in view.
  b.group.traverse((obj) => {
    if (obj.name === 'node-rim' && obj instanceof THREE.Mesh) {
      const m = obj.material as THREE.MeshStandardMaterial;
      m.color.set(colour);
      m.emissive.set(colour);
    }
  });

  // Kind-specific silhouette on top of the hex base. Built once at
  // node construction; the sim never moves nodes so no per-frame
  // position update is needed.
  const silhouette = buildNodeSilhouette(kind, colour);
  b.group.add(silhouette);

  // Always-on remaining-amount label. Stays anchored above the
  // silhouette and faces camera via THREE.Sprite.
  const label = buildNodeLabel(silhouette.userData.labelHeight as number);
  b.group.add(label.sprite);

  return {
    group: b.group,
    setRemaining(value: number, max: number): void {
      label.setText(`${Math.max(0, Math.round(value))}`);
      // Fade the silhouette emissive intensity as the node empties so
      // a nearly-depleted node reads as "this is dying" before the
      // hex base alone does.
      const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
      const intensity = 0.3 + 1.4 * ratio;
      silhouette.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const m = child.material as THREE.MeshStandardMaterial;
          if (m.emissive) m.emissiveIntensity = intensity;
        }
      });
    },
  };
}

function buildNodeSilhouette(kind: ResourceKind, colour: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `node-silhouette-${kind}`;

  const mat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 1.4,
  });

  let labelHeight = 0.5; // y above hex base where label sits
  switch (kind) {
    case 'energy': {
      // Gold pylon — tall slim octahedron pointing up. Reads as "the
      // workhorse resource" — a clean angular spike.
      const geo = new THREE.OctahedronGeometry(0.18, 0);
      const mesh = new THREE.Mesh(geo, mat());
      mesh.scale.set(1, 2.2, 1);
      mesh.position.y = 0.45;
      group.add(mesh);
      labelHeight = 0.95;
      break;
    }
    case 'flux': {
      // Green crystal cluster — three small octahedra clustered
      // together at slightly different heights. Reads as "rare,
      // precious, hand-cut" against energy's clean spike.
      for (const offset of [
        { x: 0,    y: 0.50, z: 0,    s: 1.0 },
        { x: 0.18, y: 0.38, z: 0.10, s: 0.7 },
        { x: -0.16, y: 0.42, z: -0.08, s: 0.8 },
      ]) {
        const geo = new THREE.OctahedronGeometry(0.14, 0);
        const mesh = new THREE.Mesh(geo, mat());
        mesh.scale.set(offset.s, offset.s * 1.4, offset.s);
        mesh.position.set(offset.x, offset.y, offset.z);
        group.add(mesh);
      }
      labelHeight = 0.95;
      break;
    }
    case 'blue': {
      // Cyan diamond spire — tall narrow octahedron, stretched
      // vertically. Same shape language as energy but colour-locked
      // to faction 0 + scaled tall to read as "premium colour pool."
      const geo = new THREE.OctahedronGeometry(0.16, 0);
      const mesh = new THREE.Mesh(geo, mat());
      mesh.scale.set(0.85, 3.0, 0.85);
      mesh.position.y = 0.55;
      group.add(mesh);
      labelHeight = 1.20;
      break;
    }
    case 'red': {
      // Red-orange spike — wider-based cone, faction 1's colour pool.
      // The cone shape (vs blue's diamond) reads as faction-asymmetric
      // even before colour parses.
      const geo = new THREE.ConeGeometry(0.2, 0.85, 6);
      const mesh = new THREE.Mesh(geo, mat());
      mesh.position.y = 0.50;
      group.add(mesh);
      labelHeight = 1.05;
      break;
    }
  }

  group.userData.labelHeight = labelHeight;
  return group;
}

interface NodeLabel {
  sprite: THREE.Sprite;
  setText(text: string): void;
}

function buildNodeLabel(height: number): NodeLabel {
  // Canvas-backed sprite. Width:height ratio fixed at 4:1; the canvas
  // is small (128×32) so font rendering is sharp at most camera zooms
  // without paying GPU memory for high-res text textures.
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('buildNodeLabel: 2d context unavailable');

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false, // always render on top so labels don't disappear behind silhouettes
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.85, 0.21, 1);
  sprite.position.y = height + 0.15;
  sprite.renderOrder = 999;

  let lastText = '';
  function setText(text: string): void {
    if (text === lastText) return; // skip repaint if value didn't change
    lastText = text;
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.font = 'bold 22px ui-monospace, Menlo, monospace';
    ctx!.textAlign = 'center';
    ctx!.textBaseline = 'middle';
    // Subtle outer glow for legibility against the dark grid.
    ctx!.shadowColor = 'rgba(0,0,0,0.85)';
    ctx!.shadowBlur = 6;
    ctx!.fillStyle = '#cde';
    ctx!.fillText(text, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
  }
  setText('—'); // placeholder until first sim sync
  return { sprite, setText };
}

// Phase 3.10.3: shared selection ring for structures. Faction-coloured
// flat ring sits just above the grid plane; SimRenderer toggles
// .visible based on the input controller's current selection. Same
// visual idiom as the unit + HQ rings so the player reads "this thing
// is selected" consistently regardless of entity kind.
function buildStructureSelectionRing(faction: Faction, innerR: number, outerR: number): THREE.Mesh {
  const fid = factionToId(faction);
  const color = PRODUCTION_FACTION_EMISSIVE[fid];
  const geo = new THREE.RingGeometry(innerR, outerR, 32);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.name = 'structure-selection-ring';
  ring.visible = false;
  return ring;
}

// Phase 3.10.7: scaffolding ring shown only while a structure is
// under construction. Faction-coloured, dashed-look via a thin
// ring with low opacity; pulses via the renderer's animation loop.
// Distinct from the selection ring (dimmer, wider radius, always-on
// during build).
function buildScaffoldingRing(faction: Faction, innerR: number, outerR: number): THREE.Mesh {
  const fid = factionToId(faction);
  const color = PRODUCTION_FACTION_EMISSIVE[fid];
  const geo = new THREE.RingGeometry(innerR, outerR, 48);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  ring.name = 'structure-scaffolding-ring';
  ring.visible = false;
  return ring;
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
  // Phase 3.10.3: cyan/red ring mesh under the structure, hidden by
  // default. SimRenderer toggles .visible based on the input
  // controller's selectedStructureId.
  selectionRing: THREE.Mesh;
  // Phase 3.10.7: pulsing ring at the base while the structure is
  // under construction. SimRenderer toggles + animates per frame.
  scaffoldingRing: THREE.Mesh;
  // Sim-renderer calls this each frame so the building visually "fills
  // in" as it nears completion. ratio in [0, 1] where 0 = just placed,
  // 1 = operational. Phase 3.10.7: also drives a y-scale rise from
  // the ground so the structure visibly grows during construction.
  setBuildProgress(ratio: number): void;
}

// Phase 3.2: same shape as ProductionVisual but the body is a tall slim
// cylinder so the Spire reads as a tech building, not a production
// hangar. Faction-asymmetric tier-2 visuals arrive in 3.4.
export interface UpgradeVisual {
  group: THREE.Group;
  hpBar: HpBar;
  selectionRing: THREE.Mesh;
  scaffoldingRing: THREE.Mesh;
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

  const selectionRing = buildStructureSelectionRing(faction, 0.55, 0.68);
  group.add(selectionRing);

  const scaffoldingRing = buildScaffoldingRing(faction, 0.62, 0.78);
  group.add(scaffoldingRing);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);
  group.scale.set(PRODUCTION_SCALE, PRODUCTION_SCALE, PRODUCTION_SCALE);

  return {
    group,
    hpBar,
    selectionRing,
    scaffoldingRing,
    setBuildProgress(ratio: number): void {
      // Phase 3.10.7: rises from the ground as build progresses.
      // ratio 0 = freshly placed (scale.y = 0.15, body translucent),
      // ratio 1 = operational (scale.y = 1, body opaque).
      const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
      const yScale = 0.15 + 0.85 * clamped;
      body.scale.y = yScale;
      body.position.y = PRODUCTION_DIMENSIONS.centerY * yScale;
      edges.scale.y = yScale;
      edges.position.y = PRODUCTION_DIMENSIONS.centerY * yScale;
      const trimMat = edges.material as THREE.LineBasicMaterial;
      trimMat.opacity = 0.35 + 0.65 * clamped;
      trimMat.transparent = clamped < 1;
      bodyMat.opacity = 0.45 + 0.55 * clamped;
      bodyMat.transparent = clamped < 1;
      // Scaffolding ring visible only while in build phase.
      scaffoldingRing.visible = clamped < 1;
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

  const selectionRing = buildStructureSelectionRing(faction, 0.50, 0.62);
  group.add(selectionRing);

  const scaffoldingRing = buildScaffoldingRing(faction, 0.55, 0.70);
  group.add(scaffoldingRing);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);
  group.scale.set(SPIRE_SCALE, SPIRE_SCALE, SPIRE_SCALE);

  return {
    group,
    hpBar,
    selectionRing,
    scaffoldingRing,
    setBuildProgress(ratio: number): void {
      const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
      // Spire rises tall as build progresses — the dramatic vertical
      // is what distinguishes it from a Forge.
      const yScale = 0.10 + 0.90 * clamped;
      body.scale.y = yScale;
      body.position.y = (SPIRE_DIMS.height / 2) * yScale;
      finial.position.y = SPIRE_DIMS.height * yScale + SPIRE_DIMS.finialHeight / 2;
      finial.visible = clamped > 0.5;
      bodyMat.opacity = 0.45 + 0.55 * clamped;
      bodyMat.transparent = clamped < 1;
      finialMat.emissiveIntensity = 0.2 + 1.3 * clamped;
      scaffoldingRing.visible = clamped < 1;
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
  selectionRing: THREE.Mesh;
  scaffoldingRing: THREE.Mesh;
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

  const selectionRing = buildStructureSelectionRing(faction, 0.42, 0.52);
  group.add(selectionRing);

  const scaffoldingRing = buildScaffoldingRing(faction, 0.46, 0.58);
  group.add(scaffoldingRing);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);
  group.scale.set(PYLON_SCALE, PYLON_SCALE, PYLON_SCALE);

  return {
    group,
    hpBar,
    selectionRing,
    scaffoldingRing,
    setBuildProgress(ratio: number): void {
      const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
      const yScale = 0.15 + 0.85 * clamped;
      body.scale.y = yScale;
      body.position.y = (PYLON_DIMS.height / 2) * yScale;
      cap.position.y = PYLON_DIMS.height * yScale + PYLON_DIMS.capHeight / 2;
      cap.visible = clamped > 0.4;
      bodyMat.opacity = 0.45 + 0.55 * clamped;
      bodyMat.transparent = clamped < 1;
      capMat.emissiveIntensity = 0.2 + 1.0 * clamped;
      scaffoldingRing.visible = clamped < 1;
    },
  };
}
