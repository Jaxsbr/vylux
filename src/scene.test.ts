import { describe, it, expect } from 'vitest';
import { computeCameraPosition, SCENE_CONSTANTS } from './scene';

describe('computeCameraPosition', () => {
  it('places camera at the configured distance from origin', () => {
    const p = computeCameraPosition(45, 30, 30);
    const r = Math.hypot(p.x, p.y, p.z);
    expect(r).toBeCloseTo(30, 5);
  });

  it('produces equal x and z for yaw=45 and keeps y = sin(elev) * d', () => {
    const p = computeCameraPosition(45, 30, 30);
    expect(p.x).toBeCloseTo(p.z, 5);
    expect(p.y).toBeCloseTo(Math.sin((30 * Math.PI) / 180) * 30, 5);
  });

  it('is pure and deterministic for the scene constants', () => {
    const a = computeCameraPosition(
      SCENE_CONSTANTS.cameraYawDeg,
      SCENE_CONSTANTS.cameraElevationDeg,
      SCENE_CONSTANTS.cameraDistance,
    );
    const b = computeCameraPosition(
      SCENE_CONSTANTS.cameraYawDeg,
      SCENE_CONSTANTS.cameraElevationDeg,
      SCENE_CONSTANTS.cameraDistance,
    );
    expect(a).toEqual(b);
  });
});
