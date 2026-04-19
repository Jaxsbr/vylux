import type { SceneBundle } from './scene';
import { INITIAL_STATE, type FactionId, type PlacementState } from './placement';
import type { FactionEnergy } from './economy';
import type { FactionPoints } from './points';
import type { FactionHold } from './energy-node';
import * as THREE from 'three';

export type PlacedMeshDebug = {
  tileX: number;
  tileY: number;
  type: FactionId;
  position: { x: number; y: number; z: number };
  material: {
    emissive: string;
    opacity: number;
    transparent: boolean;
  };
};

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
  placedMeshes: PlacedMeshDebug[];
  placedCount: number;
};

export type VyluxHook = {
  state: PlacementState;
  readonly debug: VyluxDebug;
  raycastCenter: () => { tileX: number; tileY: number } | null;
  // Optional E2E-only extensions — present only when ?e2e=1 is in the URL.
  setScene?: (name: string) => void;
  ready?: () => Promise<void>;
  // HUD setters — always present once main.ts wires them up.
  setEnergy?: (patch: Partial<FactionEnergy>) => void;
  setPoints?: (patch: Partial<FactionPoints>) => void;
  // Node hold setter — drives faction-hold tinting on energy nodes.
  setNodeHolds?: (holds: Record<number, FactionHold>) => void;
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
  const placedMeshes: PlacedMeshDebug[] = bundle.placed.meshes.map((rec) => ({
    tileX: rec.unit.tileX,
    tileY: rec.unit.tileY,
    type: rec.unit.type,
    position: {
      x: rec.mesh.position.x,
      y: rec.mesh.position.y,
      z: rec.mesh.position.z,
    },
    material: {
      emissive: rec.material.emissive.getHexString(),
      opacity: rec.material.opacity,
      transparent: rec.material.transparent,
    },
  }));
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
    placedMeshes,
    placedCount: placedMeshes.length,
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
