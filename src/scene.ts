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
  type PlacedUnit,
  type PlacementState,
} from './placement';
import { buildHQ, type HQBundle } from './hq';
import { buildEnergyNode, NODE_POSITIONS, type EnergyNodeBundle } from './energy-node';
import { buildWorker, type WorkerBundle } from './worker';

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
  // Bloom target: HQ tier edges readable at distance, faction halo present but
  // not washing the silhouette. threshold=0.45 passes HQ emissive (~1.4×faction
  // colour) while blocking dim grid dividers (0.4 intensity on grey 0x555555).
  bloomStrength: 0.8,
  bloomRadius: 0.6,
  bloomThreshold: 0.45,
  // HQ tile positions — GRID_SIZE = 20 so corner tiles are 0 and 19.
  hqBlueTile: 0,
  hqRedTile: 19,
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
  /** All worker bundles — starter + any spawned via e2e hook. */
  workers: WorkerBundle[];
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
  reconcile: (state: PlacementState) => void;
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
    hqBlueTile,
    hqRedTile,
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
  const blueHQ = buildHQ('blue', hqBlueTile, hqBlueTile);
  const redHQ = buildHQ('red', hqRedTile, hqRedTile);
  scene.add(blueHQ.group, redHQ.group);
  const hqs = { blue: blueHQ, red: redHQ };

  // Pre-placed energy nodes — 4 hex platforms at fixed grid positions.
  // Placed here (not in e2e-hook) so they appear in both real game and e2e scenes.
  const energyNodes: EnergyNodeBundle[] = NODE_POSITIONS.map(([tx, ty]) => {
    const node = buildEnergyNode(tx, ty);
    scene.add(node.group);
    return node;
  });

  // Starter workers — blue HQ at (0,0) gets workers at (1,0) and (0,1);
  // red HQ at (19,19) gets workers at (18,19) and (19,18).
  const workers: WorkerBundle[] = [];
  const starterWorkers: Array<['blue' | 'red', number, number]> = [
    ['blue', 1, 0],
    ['blue', 0, 1],
    ['red', 18, 19],
    ['red', 19, 18],
  ];
  for (const [faction, tx, ty] of starterWorkers) {
    const w = buildWorker(faction, tx, ty);
    scene.add(w.mesh);
    workers.push(w);
  }

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

  const tileIndex = (tileX: number, tileY: number): number =>
    tileY * GRID_CONSTANTS.gridSize + tileX;

  let lastHover: { tileX: number; tileY: number } | null = null;

  const reconcile = (state: PlacementState): void => {
    if (lastHover !== null) {
      const prev = grid.tileMeshes[tileIndex(lastHover.tileX, lastHover.tileY)];
      (prev.material as THREE.MeshStandardMaterial).color.set(GRID_CONSTANTS.tileColor);
      lastHover = null;
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
    backgroundColor,
    cameraRotation: { yawDeg: cameraYawDeg, pitchDeg: -cameraElevationDeg },
    lightCounts: { ambient: 1, directional: 1 },
    contextLost,
    resize,
    render,
    raycastCenter,
    raycastPointer,
    raycastWorker,
    reconcile,
  };
}
