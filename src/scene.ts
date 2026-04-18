import * as THREE from 'three';
import { buildGrid, tileToWorld, GRID_CONSTANTS, type GridBundle } from './grid';
import {
  computeGhostView,
  computeHoverView,
  type PlacementState,
} from './placement';

export const SCENE_CONSTANTS = {
  backgroundColor: '#0a0a0a',
  cameraYawDeg: 45,
  cameraElevationDeg: 30,
  cameraDistance: 30,
  viewSize: 12,
  ambientIntensity: 0.3,
  directionalIntensity: 0.8,
  ghostSize: 0.8,
  ghostOpacity: 0.4,
  ghostY: 0.5,
  ghostInitialEmissive: 0x00e5ff,
} as const;

export type GhostBundle = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
};

export type ContextLostRef = { current: boolean };

export type SceneBundle = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  lights: { ambient: THREE.AmbientLight; directional: THREE.DirectionalLight };
  grid: GridBundle;
  ghost: GhostBundle;
  backgroundColor: string;
  cameraRotation: { yawDeg: number; pitchDeg: number };
  lightCounts: { ambient: number; directional: number };
  contextLost: ContextLostRef;
  resize: (width: number, height: number) => void;
  raycastCenter: () => { tileX: number; tileY: number } | null;
  raycastPointer: (clientX: number, clientY: number) => { tileX: number; tileY: number } | null;
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

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const resize = (width: number, height: number): void => {
    const aspect = width / height || 1;
    camera.left = -viewSize * aspect;
    camera.right = viewSize * aspect;
    camera.top = viewSize;
    camera.bottom = -viewSize;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  resize(window.innerWidth, window.innerHeight);

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
  const raycastPointer = (
    clientX: number,
    clientY: number,
  ): { tileX: number; tileY: number } | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    if (pointer.x < -1 || pointer.x > 1 || pointer.y < -1 || pointer.y > 1) return null;
    return raycastHitAt(pointer);
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
  };

  const contextLost: ContextLostRef = { current: false };

  return {
    scene,
    camera,
    renderer,
    lights: { ambient, directional },
    grid,
    ghost,
    backgroundColor,
    cameraRotation: { yawDeg: cameraYawDeg, pitchDeg: -cameraElevationDeg },
    lightCounts: { ambient: 1, directional: 1 },
    contextLost,
    resize,
    raycastCenter,
    raycastPointer,
    reconcile,
  };
}
