import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildGrid, tileToWorld, GRID_CONSTANTS, type GridBundle } from './grid';
import {
  computeGhostView,
  computeHoverView,
  ghostEmissiveFor,
  proximityZoneTiles,
  type PlacedUnit,
  type PlacementState,
} from './placement';
import { buildHQ, type HQBundle } from './hq';
import { buildEnergyNode, NODE_POSITIONS, type EnergyNodeBundle } from './energy-node';
import { buildWorker, type WorkerBundle } from './worker';
import type { DefenderBundle } from './defender';
import type { RaiderBundle } from './raider';

export const SCENE_CONSTANTS = {
  backgroundColor: '#0a0a0a',
  cameraYawDeg: 45,
  cameraElevationDeg: 30,
  cameraDistance: 30,
  viewSize: 10,
  ambientIntensity: 0.3,
  directionalIntensity: 0.8,
  ghostSize: 0.8,
  ghostOpacity: 0.4,
  ghostY: 0.5,
  ghostInitialEmissive: 0x00e5ff,
  placedSize: 0.8,
  placedY: 0.5,
  // Dark mass, neon trim: placed buildings render as a matte near-black body
  // (identical across factions) with unlit edge lines in the faction hex. The
  // body's `emissive` field still carries the faction hex as a metadata label
  // (preserved for debug/Playwright), but `emissiveIntensity: 0` means the
  // body does not glow — faction identity reads only from the trim.
  buildingBodyColor: '#0d1117',
  // Bloom target: accent accents (emissiveIntensity ~2.0) halo brightly; dark body
  // faces (emissiveIntensity ~0.05) stay below threshold and don't wash the silhouette.
  // threshold=0.25 catches the accent strip/cap/tip (bright) while still suppressing
  // the dim body faces. strength reduced to 0.45 so halos are soft, not obliterating.
  bloomStrength: 0.45,
  bloomRadius: 0.5,
  bloomThreshold: 0.25,
  // HQ tile positions — left/right, each inset 3 tiles from the map edge,
  // vertically centred on the 20×20 grid (row 9 = floor((20-1)/2)).
  hqBlueTileX: 3,
  hqBlueTileY: 9,
  hqRedTileX: 16,
  hqRedTileY: 9,
} as const;

export type GhostBundle = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
};

export type PlacedMeshRecord = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  unit: PlacedUnit;
};

export type PlacedBundle = {
  group: THREE.Group;
  meshes: PlacedMeshRecord[];
};

export type ContextLostRef = { current: boolean };

export type SceneBundle = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  lights: { ambient: THREE.AmbientLight; directional: THREE.DirectionalLight };
  grid: GridBundle;
  ghost: GhostBundle;
  placed: PlacedBundle;
  hqs: { blue: HQBundle; red: HQBundle };
  energyNodes: EnergyNodeBundle[];
  /** All worker bundles — starter + any spawned via training or e2e hook. */
  workers: WorkerBundle[];
  /** All defender bundles — spawned via training or e2e hook. */
  defenders: DefenderBundle[];
  /** All raider bundles — spawned via training or e2e hook. */
  raiders: RaiderBundle[];
  backgroundColor: string;
  cameraRotation: { yawDeg: number; pitchDeg: number };
  lightCounts: { ambient: number; directional: number };
  contextLost: ContextLostRef;
  resize: (width: number, height: number) => void;
  render: () => void;
  raycastCenter: () => { tileX: number; tileY: number } | null;
  raycastPointer: (clientX: number, clientY: number) => { tileX: number; tileY: number } | null;
  /** Raycast against all worker meshes. Returns the worker hit, or null. */
  raycastWorker: (clientX: number, clientY: number) => WorkerBundle | null;
  /** Raycast against HQ meshes. Returns the HQBundle hit, or null. */
  raycastHq: (clientX: number, clientY: number) => import('./hq').HQBundle | null;
  /**
   * Call every frame with the current placement state. Also pass the armed
   * HQ position (null when no buildable is armed) so the proximity zone
   * highlight can be rendered.
   */
  reconcile: (state: PlacementState, zoneHq: { tileX: number; tileY: number } | null) => void;
};

export function computeCameraPosition(
  yawDeg: number,
  elevationDeg: number,
  distance: number,
): { x: number; y: number; z: number } {
  const yawRad = (yawDeg * Math.PI) / 180;
  const elevationRad = (elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(elevationRad) * distance;
  return {
    x: horizontal * Math.sin(yawRad),
    y: Math.sin(elevationRad) * distance,
    z: horizontal * Math.cos(yawRad),
  };
}

function buildGhost(): GhostBundle {
  const geometry = new THREE.BoxGeometry(
    SCENE_CONSTANTS.ghostSize,
    SCENE_CONSTANTS.ghostSize,
    SCENE_CONSTANTS.ghostSize,
  );
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: SCENE_CONSTANTS.ghostOpacity,
    emissive: SCENE_CONSTANTS.ghostInitialEmissive,
    emissiveIntensity: 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ghost';
  mesh.visible = false;
  return { mesh, material };
}

export function createScene(): SceneBundle {
  const {
    backgroundColor,
    cameraYawDeg,
    cameraElevationDeg,
    cameraDistance,
    viewSize,
    ambientIntensity,
    directionalIntensity,
    ghostY,
    placedSize,
    placedY,
    buildingBodyColor,
    hqBlueTileX,
    hqBlueTileY,
    hqRedTileX,
    hqRedTileY,
  } = SCENE_CONSTANTS;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(backgroundColor);

  const camera = new THREE.OrthographicCamera(-viewSize, viewSize, viewSize, -viewSize, 0.1, 200);
  const position = computeCameraPosition(cameraYawDeg, cameraElevationDeg, cameraDistance);
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
  const directional = new THREE.DirectionalLight(0xffffff, directionalIntensity);
  directional.position.set(10, 20, 10);
  scene.add(ambient, directional);

  const grid = buildGrid();
  scene.add(grid.group);

  const ghost = buildGhost();
  scene.add(ghost.mesh);

  const placedGroup = new THREE.Group();
  placedGroup.name = 'placed-units';
  scene.add(placedGroup);
  const placed: PlacedBundle = { group: placedGroup, meshes: [] };

  // Pre-placed HQs — always visible in the real game path (not gated by ?e2e=1).
  const blueHQ = buildHQ('blue', hqBlueTileX, hqBlueTileY);
  const redHQ = buildHQ('red', hqRedTileX, hqRedTileY);
  scene.add(blueHQ.group, redHQ.group);
  const hqs = { blue: blueHQ, red: redHQ };

  // Pre-placed energy nodes — 4 hex platforms at fixed grid positions.
  // Placed here (not in e2e-hook) so they appear in both real game and e2e scenes.
  const energyNodes: EnergyNodeBundle[] = NODE_POSITIONS.map(([tx, ty]) => {
    const node = buildEnergyNode(tx, ty);
    scene.add(node.group);
    return node;
  });

  // Starter workers — blue HQ at (3,9) gets workers at (4,9) and (3,10);
  // red HQ at (16,9) gets workers at (15,9) and (16,10).
  const workers: WorkerBundle[] = [];
  const starterWorkers: Array<['blue' | 'red', number, number]> = [
    ['blue', hqBlueTileX + 1, hqBlueTileY],
    ['blue', hqBlueTileX, hqBlueTileY + 1],
    ['red', hqRedTileX - 1, hqRedTileY],
    ['red', hqRedTileX, hqRedTileY + 1],
  ];
  for (const [faction, tx, ty] of starterWorkers) {
    const w = buildWorker(faction, tx, ty);
    scene.add(w.mesh);
    workers.push(w);
  }

  const defenders: DefenderBundle[] = [];
  const raiders: RaiderBundle[] = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    SCENE_CONSTANTS.bloomStrength,
    SCENE_CONSTANTS.bloomRadius,
    SCENE_CONSTANTS.bloomThreshold,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = (width: number, height: number): void => {
    const aspect = width / height || 1;
    camera.left = -viewSize * aspect;
    camera.right = viewSize * aspect;
    camera.top = viewSize;
    camera.bottom = -viewSize;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
    bloom.setSize(width, height);
  };
  resize(window.innerWidth, window.innerHeight);

  const render = (): void => {
    composer.render();
  };

  const raycaster = new THREE.Raycaster();
  const center = new THREE.Vector2(0, 0);
  const raycastHitAt = (ndc: THREE.Vector2): { tileX: number; tileY: number } | null => {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(grid.tileMeshes, false);
    if (hits.length === 0) {
      return null;
    }
    const ud = hits[0].object.userData as { tileX?: unknown; tileY?: unknown };
    if (typeof ud.tileX !== 'number' || typeof ud.tileY !== 'number') {
      return null;
    }
    return { tileX: ud.tileX, tileY: ud.tileY };
  };

  const raycastCenter = (): { tileX: number; tileY: number } | null => raycastHitAt(center);

  const pointer = new THREE.Vector2(0, 0);

  const toNDC = (clientX: number, clientY: number): THREE.Vector2 | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    if (pointer.x < -1 || pointer.x > 1 || pointer.y < -1 || pointer.y > 1) return null;
    return pointer;
  };

  const raycastPointer = (
    clientX: number,
    clientY: number,
  ): { tileX: number; tileY: number } | null => {
    const ndc = toNDC(clientX, clientY);
    if (ndc === null) return null;
    return raycastHitAt(ndc);
  };

  const raycastWorker = (clientX: number, clientY: number): WorkerBundle | null => {
    const ndc = toNDC(clientX, clientY);
    if (ndc === null) return null;
    raycaster.setFromCamera(ndc, camera);
    // Collect all descendant meshes from each worker group.
    const workerMeshes: THREE.Object3D[] = [];
    for (const w of workers) {
      w.mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          workerMeshes.push(obj);
        }
      });
    }
    const hits = raycaster.intersectObjects(workerMeshes, false);
    if (hits.length === 0) return null;
    // Walk up to find which WorkerBundle this hit belongs to.
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj !== null) {
      for (const w of workers) {
        if (obj === w.mesh) return w;
      }
      obj = obj.parent;
    }
    return null;
  };

  const raycastHq = (clientX: number, clientY: number): import('./hq').HQBundle | null => {
    const ndc = toNDC(clientX, clientY);
    if (ndc === null) return null;
    raycaster.setFromCamera(ndc, camera);
    const hqList = [hqs.blue, hqs.red];
    const hqMeshes: THREE.Object3D[] = [];
    for (const hq of hqList) {
      hq.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          hqMeshes.push(obj);
        }
      });
    }
    const hits = raycaster.intersectObjects(hqMeshes, false);
    if (hits.length === 0) return null;
    let hitObj: THREE.Object3D | null = hits[0].object;
    while (hitObj !== null) {
      for (const hq of hqList) {
        if (hitObj === hq.group) return hq;
      }
      hitObj = hitObj.parent;
    }
    return null;
  };

  const tileIndex = (tileX: number, tileY: number): number =>
    tileY * GRID_CONSTANTS.gridSize + tileX;

  let lastHover: { tileX: number; tileY: number } | null = null;
  // Zone tiles highlighted in the previous reconcile pass — cleared each frame.
  let lastZoneTiles: Array<{ tileX: number; tileY: number }> = [];
  // Semi-transparent cyan overlay for the proximity zone preview.
  const ZONE_COLOR = '#0a3040';

  const reconcile = (state: PlacementState, zoneHq: { tileX: number; tileY: number } | null): void => {
    // Clear previous zone highlights first.
    for (const t of lastZoneTiles) {
      const mesh = grid.tileMeshes[tileIndex(t.tileX, t.tileY)];
      if (mesh !== undefined) {
        (mesh.material as THREE.MeshStandardMaterial).color.set(GRID_CONSTANTS.tileColor);
      }
    }
    lastZoneTiles = [];

    if (lastHover !== null) {
      const prev = grid.tileMeshes[tileIndex(lastHover.tileX, lastHover.tileY)];
      (prev.material as THREE.MeshStandardMaterial).color.set(GRID_CONSTANTS.tileColor);
      lastHover = null;
    }

    // Render proximity zone highlight when a buildable is armed.
    if (zoneHq !== null) {
      const zoneTiles = proximityZoneTiles(zoneHq.tileX, zoneHq.tileY);
      for (const t of zoneTiles) {
        const mesh = grid.tileMeshes[tileIndex(t.tileX, t.tileY)];
        if (mesh !== undefined) {
          (mesh.material as THREE.MeshStandardMaterial).color.set(ZONE_COLOR);
          lastZoneTiles.push(t);
        }
      }
    }

    const hoverView = computeHoverView(state);
    if (hoverView.highlight) {
      const mesh = grid.tileMeshes[tileIndex(hoverView.tileX, hoverView.tileY)];
      (mesh.material as THREE.MeshStandardMaterial).color.set(hoverView.colorHex);
      lastHover = { tileX: hoverView.tileX, tileY: hoverView.tileY };
    }

    const ghostView = computeGhostView(state);
    if (ghostView.visible) {
      const world = tileToWorld(ghostView.tileX, ghostView.tileY);
      ghost.mesh.position.set(world.x, ghostY, world.z);
      ghost.material.emissive.set(ghostView.emissiveHex);
      ghost.mesh.visible = true;
    } else {
      ghost.mesh.visible = false;
    }

    // Append-only contract: placedUnits only grows in this phase, so reconcile
    // spawns meshes for new entries but never removes. Future phases that allow
    // units to leave state must add a removal branch to keep the scene in sync.
    for (const unit of state.placedUnits) {
      const already = placed.meshes.some(
        (rec) =>
          rec.unit.tileX === unit.tileX &&
          rec.unit.tileY === unit.tileY &&
          rec.unit.type === unit.type,
      );
      if (already) continue;
      const hex = ghostEmissiveFor(unit.type);
      const geometry = new THREE.BoxGeometry(placedSize, placedSize, placedSize);
      const material = new THREE.MeshStandardMaterial({
        color: buildingBodyColor,
        transparent: false,
        opacity: 1,
        emissive: hex,
        emissiveIntensity: 0,
        // Push faces slightly back so neon edges (which sit at identical depth
        // as the faces) consistently win the depth test — without this,
        // coplanar-edge z-fighting drops random vertical lines per-GPU.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'placed-unit';
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: hex }),
      );
      edges.name = 'placed-unit-trim';
      mesh.add(edges);
      const world = tileToWorld(unit.tileX, unit.tileY);
      mesh.position.set(world.x, placedY, world.z);
      placed.group.add(mesh);
      placed.meshes.push({ mesh, material, unit: { ...unit } });
    }
  };

  const contextLost: ContextLostRef = { current: false };

  return {
    scene,
    camera,
    renderer,
    composer,
    lights: { ambient, directional },
    grid,
    ghost,
    placed,
    hqs,
    energyNodes,
    workers,
    defenders,
    raiders,
    backgroundColor,
    cameraRotation: { yawDeg: cameraYawDeg, pitchDeg: -cameraElevationDeg },
    lightCounts: { ambient: 1, directional: 1 },
    contextLost,
    resize,
    render,
    raycastCenter,
    raycastPointer,
    raycastWorker,
    raycastHq,
    reconcile,
  };
}
