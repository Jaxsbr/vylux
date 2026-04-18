import type { SceneBundle } from './scene';

export type VyluxDebug = {
  backgroundColor: string;
  cameraType: string;
  cameraRotation: { yawDeg: number; pitchDeg: number };
  lightCounts: { ambient: number; directional: number };
  contextLost: boolean;
  tileCount: number;
};

export type VyluxHook = {
  state: Record<string, unknown>;
  debug: VyluxDebug;
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
    tileCount: 0,
  };
}

export function attachDebugHook(bundle: SceneBundle): VyluxHook | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const hook: VyluxHook = {
    state: {},
    debug: buildDebugSnapshot(bundle),
  };
  window.__vylux = hook;
  return hook;
}
