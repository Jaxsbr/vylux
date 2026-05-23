// Phase C.4 — work-state beams.
//
// A glowing floor conduit drawn from a working worker to whatever it's
// working on: the node it's harvesting, the pod/HQ it's charging at, the
// structure it's building. The beam makes each work-state legible from across
// the map ("that worker is plugged into that node") and gives the arena
// motion at rest via a flowing opacity pulse.
//
// Renderer-only: positions are read from interpolated render coords, nothing
// is written back to the sim. Beams are pooled + keyed by worker id; the pool
// is tiny (one per actively-working worker) so create-on-demand + dispose-on-
// idle is cheap. Same lifecycle shape as FeedbackOverlay, but beams are
// continuous (alive while the phase holds) rather than fixed-lifetime cues.

import * as THREE from 'three';

// One beam to draw this frame. Endpoints are Three.js world XZ; `color` is
// chosen by the caller per work-state (green harvest, gold charge, faction
// build) so the manager stays state-agnostic.
export interface BeamSpec {
  key: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  color: number;
}

// Sits just above the fog overlay (y=0.05) like the other floor cues so it's
// never swallowed by fog.
const BEAM_Y = 0.06;
const BEAM_RENDER_ORDER = 3;
const BEAM_THICKNESS = 0.12;
const BEAM_HEIGHT = 0.05;
// Hide degenerate beams (worker sitting right on its target) — a zero-length
// quad is just z-fighting noise.
const MIN_BEAM_LENGTH = 0.06;

interface Beam {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.BoxGeometry;
}

export class WorkBeams {
  private readonly group: THREE.Group;
  private readonly beams = new Map<number, Beam>();
  private clock = 0;

  constructor(parent: THREE.Group) {
    this.group = new THREE.Group();
    this.group.name = 'work-beams';
    parent.add(this.group);
  }

  // Reconcile the pool against this frame's active beams. Unmatched beams
  // (the worker stopped working or went out of vision) are removed + disposed.
  // dt is wall-clock seconds (same clock SimRenderer drives its animations on).
  sync(specs: readonly BeamSpec[], dt: number): void {
    this.clock += dt;
    const seen = new Set<number>();
    for (const s of specs) {
      seen.add(s.key);
      let b = this.beams.get(s.key);
      if (b === undefined) {
        b = this.makeBeam();
        this.beams.set(s.key, b);
        this.group.add(b.mesh);
      }
      const dx = s.toX - s.fromX;
      const dz = s.toZ - s.fromZ;
      const len = Math.hypot(dx, dz);
      if (len < MIN_BEAM_LENGTH) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.visible = true;
      b.mesh.position.set((s.fromX + s.toX) / 2, BEAM_Y, (s.fromZ + s.toZ) / 2);
      // Box long axis is local +X; rotate it about Y so +X points from→to.
      b.mesh.rotation.y = Math.atan2(-dz, dx);
      b.mesh.scale.x = len;
      b.material.color.setHex(s.color);
      // Flowing pulse — a per-key phase offset so beams don't blink in sync.
      const pulse = 0.5 + 0.35 * Math.sin(this.clock * 6 + s.key * 1.7);
      b.material.opacity = pulse;
    }
    for (const [key, b] of this.beams) {
      if (seen.has(key)) continue;
      this.group.remove(b.mesh);
      b.geometry.dispose();
      b.material.dispose();
      this.beams.delete(key);
    }
  }

  private makeBeam(): Beam {
    // Unit-length along X; scale.x stretches it to the endpoint distance.
    const geometry = new THREE.BoxGeometry(1, BEAM_HEIGHT, BEAM_THICKNESS);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = BEAM_RENDER_ORDER;
    return { mesh, material, geometry };
  }

  dispose(): void {
    for (const b of this.beams.values()) {
      this.group.remove(b.mesh);
      b.geometry.dispose();
      b.material.dispose();
    }
    this.beams.clear();
    this.group.parent?.remove(this.group);
  }
}
