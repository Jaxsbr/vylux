import * as THREE from 'three';

export const SCENE_CONSTANTS = {
  backgroundColor: '#0a0a0a',
  cameraYawDeg: 45,
  cameraElevationDeg: 30,
  cameraDistance: 30,
  viewSize: 12,
  ambientIntensity: 0.3,
  directionalIntensity: 0.8,
} as const;

export type SceneBundle = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  lights: { ambient: THREE.AmbientLight; directional: THREE.DirectionalLight };
  backgroundColor: string;
  cameraRotation: { yawDeg: number; pitchDeg: number };
  lightCounts: { ambient: number; directional: number };
  resize: (width: number, height: number) => void;
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

export function createScene(): SceneBundle {
  const {
    backgroundColor,
    cameraYawDeg,
    cameraElevationDeg,
    cameraDistance,
    viewSize,
    ambientIntensity,
    directionalIntensity,
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

  return {
    scene,
    camera,
    renderer,
    lights: { ambient, directional },
    backgroundColor,
    cameraRotation: { yawDeg: cameraYawDeg, pitchDeg: -cameraElevationDeg },
    lightCounts: { ambient: 1, directional: 1 },
    resize,
  };
}
