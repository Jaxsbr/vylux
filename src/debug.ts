import type { SceneBundle } from './scene';
import { INITIAL_STATE, type PlacementState } from './placement';

export type VyluxDebug = {
  backgroundColor: string;
  cameraType: string;
  cameraRotation: { yawDeg: number; pitchDeg: number };
  lightCounts: { ambient: number; directional: number };
  contextLost: boolean;
  tileCount: number;
  tileColors: string[];
  gridLineMaterial: { emissive: string; emissiveIntensity: number };
};

export type VyluxHook = {
  state: PlacementState;
  debug: VyluxDebug;
  raycastCenter: () => { tileX: number; tileY: number } | null;
};

declare global {
  interface Window {
    __vylux?: VyluxHook;
  }
}

export function buildDebugSnapshot(bundle: SceneBundle): VyluxDebug {
  return {
    backgroundColor: bundle.backgroundColor,
    cameraType: bundle.camera.type,
    cameraRotation: bundle.cameraRotation,
    lightCounts: bundle.lightCounts,
    contextLost: false,
    tileCount: bundle.grid.tileMeshes.length,
    tileColors: bundle.grid.tileColors.slice(),
    gridLineMaterial: {
      emissive: bundle.grid.gridLineMaterial.emissive.getHexString(),
      emissiveIntensity: bundle.grid.gridLineMaterial.emissiveIntensity,
    },
  };
}

export function attachDebugHook(bundle: SceneBundle): VyluxHook | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const hook: VyluxHook = {
    state: INITIAL_STATE,
    debug: buildDebugSnapshot(bundle),
    raycastCenter: bundle.raycastCenter,
  };
  window.__vylux = hook;
  return hook;
}
