import * as THREE from 'three';
import { tileToWorld } from './grid';
import {
  eventPulseIntensity,
  CAPTURE_PULSE_DURATION,
  CAPTURE_PULSE_PEAK_DELTA,
} from './event-pulse';

// Neutral rim: pale-cyan — reads as part of the Tron circuit palette while
// staying clearly distinct from the faction cyan (#00e0ff) and red (#ff4a1a).
const NEUTRAL_RIM = 0x9ceaf4;
const BLUE_RIM = 0x00e0ff;
const RED_RIM = 0xff4a1a;

// Body: near-charcoal with very low emissive so bloom leaves only a faint aura.
const BODY_COLOR = 0x0d1117;
const BODY_EMISSIVE = 0x0d1117;

// Four nodes in a central-diamond pattern:
//   top-left quad, top-right quad, bottom-left quad, bottom-right quad.
// Each sits on a quad-midpoint away from HQ corners (0,0) and (19,19).
export const NODE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [5, 5],   // near blue HQ corner — first node to contest
  [14, 5],  // top-right quadrant
  [5, 14],  // bottom-left quadrant
  [14, 14], // near red HQ corner — last node to contest
] as const;

export type FactionHold = 'blue' | 'red' | null;

export type EnergyNodeBundle = {
  /** The group placed into the scene. */
  group: THREE.Group;
  /** Shift rim emissive to faction colour or reset to neutral. */
  setFactionHold: (faction: FactionHold) => void;
  tileX: number;
  tileY: number;
  /** Fractional point accumulator for node-control scoring. Resets on holder change. */
  pointAccumulator: number;
  /** Last known holder — used to detect holder changes and reset the accumulator. */
  lastHolder: FactionHold;
  /**
   * Fire a capture pulse on the node rim. Call when ownership flips.
   */
  triggerCapturePulse: () => void;
  /**
   * Advance the capture-pulse animation. Call every frame with the frame delta.
   */
  tickCapturePulse: (dt: number) => void;
  /**
   * Read-only: seconds elapsed since capture pulse fired, or -1 when not active.
   */
  readonly capturePulseElapsed: number;
};

const NODE_CONSTANTS = {
  // Hex prism approximated by a CylinderGeometry with 6 radial segments.
  radius: 0.42,
  height: 0.08,   // very flat — floor-embedded look
  radialSegments: 6,
  // Y position: half-height above the tile plane (Y=0) so the top face is at
  // exactly height/2 = 0.04. Visually flush with the grid.
  centerY: 0.04,
  // Rim: thin disc on the top face, slightly larger radius.
  rimRadius: 0.44,
  rimHeight: 0.02,
  rimY: 0.09, // top of body + half rim height
  bodyEmissiveIntensity: 0.15,
  rimEmissiveIntensity: 1.0,
} as const;

export function buildEnergyNode(tileX: number, tileY: number): EnergyNodeBundle {
  const group = new THREE.Group();
  group.name = `energy-node-${tileX}-${tileY}`;

  // Body — short hex prism, near-black with faint emissive.
  const bodyGeo = new THREE.CylinderGeometry(
    NODE_CONSTANTS.radius,
    NODE_CONSTANTS.radius,
    NODE_CONSTANTS.height,
    NODE_CONSTANTS.radialSegments,
  );
  const bodyMat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: BODY_EMISSIVE,
    emissiveIntensity: NODE_CONSTANTS.bodyEmissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = NODE_CONSTANTS.centerY;
  body.name = 'node-body';

  // Rim — thin disc atop the body, carries the faction/neutral glow.
  const rimGeo = new THREE.CylinderGeometry(
    NODE_CONSTANTS.rimRadius,
    NODE_CONSTANTS.rimRadius,
    NODE_CONSTANTS.rimHeight,
    NODE_CONSTANTS.radialSegments,
  );
  const rimMat = new THREE.MeshStandardMaterial({
    color: NEUTRAL_RIM,
    emissive: NEUTRAL_RIM,
    emissiveIntensity: NODE_CONSTANTS.rimEmissiveIntensity,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.y = NODE_CONSTANTS.rimY;
  rim.name = 'node-rim';

  group.add(body, rim);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  const setFactionHold = (faction: FactionHold): void => {
    const rimColor =
      faction === 'blue' ? BLUE_RIM : faction === 'red' ? RED_RIM : NEUTRAL_RIM;
    rimMat.color.set(rimColor);
    rimMat.emissive.set(rimColor);
  };

  let capturePulseElapsedInternal = -1;

  return {
    group,
    setFactionHold,
    tileX,
    tileY,
    pointAccumulator: 0,
    lastHolder: null,
    get capturePulseElapsed(): number { return capturePulseElapsedInternal; },

    triggerCapturePulse(): void {
      capturePulseElapsedInternal = 0;
    },

    tickCapturePulse(dt: number): void {
      if (capturePulseElapsedInternal < 0) return;
      capturePulseElapsedInternal += dt;
      rimMat.emissiveIntensity = eventPulseIntensity(
        NODE_CONSTANTS.rimEmissiveIntensity,
        CAPTURE_PULSE_PEAK_DELTA,
        capturePulseElapsedInternal,
        CAPTURE_PULSE_DURATION,
      );
      if (capturePulseElapsedInternal >= CAPTURE_PULSE_DURATION) {
        capturePulseElapsedInternal = -1;
        rimMat.emissiveIntensity = NODE_CONSTANTS.rimEmissiveIntensity;
      }
    },
  };
}
