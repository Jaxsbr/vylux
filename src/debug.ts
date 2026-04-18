import type { SceneBundle } from './scene';
import { INITIAL_STATE, type PlacementState } from './placement';
import * as THREE from 'three';

export type VyluxDebug = {
  backgroundColor: string;
  cameraType: string;
  cameraRotation: { yawDeg: number; pitchDeg: number };
  lightCounts: { ambient: number; directional: number };
  contextLost: boolean;
  tileCount: number;
  tileColors: string[];
  gridLineMaterial: { emissive: string; emissiveIntensity: number };
  ghost: {
    visible: boolean;
    position: { x: number; y: number; z: number };
    material: {
      emissive: string;
      opacity: number;
      transparent: boolean;
    };
  };
  ghostCount: number;
};

export type VyluxHook = {
  state: PlacementState;
  readonly debug: VyluxDebug;
  raycastCenter: () => { tileX: number; tileY: number } | null;
};

declare global {
  interface Window {
    __vylux?: VyluxHook;
  }
}

function countGhostMeshes(scene: THREE.Scene): number {
  let count = 0;
  scene.traverse((obj) => {
    if (obj.name === 'ghost') count++;
  });
  return count;
}

export function buildDebugSnapshot(bundle: SceneBundle): VyluxDebug {
  const liveTileColors = bundle.grid.tileMeshes.map((mesh) => {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    return '#' + mat.color.getHexString();
  });
  return {
    backgroundColor: bundle.backgroundColor,
    cameraType: bundle.camera.type,
    cameraRotation: bundle.cameraRotation,
    lightCounts: bundle.lightCounts,
    contextLost: bundle.contextLost.current,
    tileCount: bundle.grid.tileMeshes.length,
    tileColors: liveTileColors,
    gridLineMaterial: {
      emissive: bundle.grid.gridLineMaterial.emissive.getHexString(),
      emissiveIntensity: bundle.grid.gridLineMaterial.emissiveIntensity,
    },
    ghost: {
      visible: bundle.ghost.mesh.visible,
      position: {
        x: bundle.ghost.mesh.position.x,
        y: bundle.ghost.mesh.position.y,
        z: bundle.ghost.mesh.position.z,
      },
      material: {
        emissive: bundle.ghost.material.emissive.getHexString(),
        opacity: bundle.ghost.material.opacity,
        transparent: bundle.ghost.material.transparent,
      },
    },
    ghostCount: countGhostMeshes(bundle.scene),
  };
}

export function attachDebugHook(bundle: SceneBundle): VyluxHook | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const hook = {
    state: INITIAL_STATE as PlacementState,
    raycastCenter: bundle.raycastCenter,
  };
  Object.defineProperty(hook, 'debug', {
    get: () => buildDebugSnapshot(bundle),
    enumerable: true,
    configurable: false,
  });
  window.__vylux = hook as VyluxHook;
  return hook as VyluxHook;
}
