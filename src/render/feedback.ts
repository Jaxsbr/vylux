// Phase 3.9.1 — Input feedback overlay.
//
// Renderer-only visual cues for the player's commands. The sim is
// untouched; nothing here affects state, replays, or the cross-OS
// determinism gate. Purpose: when the player issues a move order or
// assigns a worker, an obvious ring pulse appears at the target so the
// click "lands" visibly. Without this, every commanded action looks
// like a delayed nothing — units take ticks to react and the player
// can't tell the input registered.
//
// Three cue types ship in 3.9.1:
//   - move ping       : fading expanding ring at a right-click move target
//   - assign pulse    : faction-coloured ring at a node when workers are
//                       routed to it
//   - placement burst : short scale-in ring when a structure is placed
//
// Each cue has a fixed lifetime (sub-second) and is removed + disposed
// when it expires. The pool is small (max ~handful of in-flight pings
// at any time during normal play) so naive create-and-dispose is fine;
// no instancing needed.

import * as THREE from 'three';
import type { Faction } from '../sim/types';
import { tileFloatToWorld } from './scene';

const FACTION_COLOR: Record<Faction, number> = {
  0: 0x00e5ff, // cyan
  1: 0xff6a33, // red-orange
};

const NEUTRAL_COLOR = 0xb6e8ff; // soft cyan-white for placement bursts
const ASSIGN_COLOR = 0x66ff44;  // matches Flux node rim — reads as "harvest target"

const MOVE_PING_LIFETIME_MS = 600;
const ASSIGN_PULSE_LIFETIME_MS = 500;
const PLACEMENT_BURST_LIFETIME_MS = 350;

interface Ping {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  ageMs: number;
  lifetimeMs: number;
  startScale: number;
  endScale: number;
}

export class FeedbackOverlay {
  private readonly group: THREE.Group;
  private readonly pings: Ping[] = [];

  constructor(parent: THREE.Group) {
    this.group = new THREE.Group();
    this.group.name = 'feedback';
    parent.add(this.group);
  }

  // Fired by the input controller when the player commits a MoveUnit.
  // tileX/tileY come from the picker's rounded ground intersection (the
  // same tile coords the sim command carries).
  spawnMovePing(tileX: number, tileY: number, faction: Faction): void {
    this.spawnRing({
      tileX,
      tileY,
      color: FACTION_COLOR[faction],
      lifetimeMs: MOVE_PING_LIFETIME_MS,
      innerRadius: 0.2,
      outerRadius: 0.32,
      startScale: 0.6,
      endScale: 1.8,
    });
  }

  // Fired when workers are assigned to a node. Pulses at the node's
  // tile centre in a "this is your harvest target" green that contrasts
  // both faction palettes.
  spawnAssignPulse(tileX: number, tileY: number): void {
    this.spawnRing({
      tileX,
      tileY,
      color: ASSIGN_COLOR,
      lifetimeMs: ASSIGN_PULSE_LIFETIME_MS,
      innerRadius: 0.32,
      outerRadius: 0.46,
      startScale: 0.7,
      endScale: 1.5,
    });
  }

  // Fired when a structure is placed. Quick scale-in burst that confirms
  // the click landed before the building's own build-progress fade kicks
  // in (the building appears dim during construction so the burst is
  // useful as the immediate "yes, that registered" cue).
  spawnPlacementBurst(tileX: number, tileY: number): void {
    this.spawnRing({
      tileX,
      tileY,
      color: NEUTRAL_COLOR,
      lifetimeMs: PLACEMENT_BURST_LIFETIME_MS,
      innerRadius: 0.45,
      outerRadius: 0.6,
      startScale: 1.4,
      endScale: 0.9,
    });
  }

  private spawnRing(opts: {
    tileX: number;
    tileY: number;
    color: number;
    lifetimeMs: number;
    innerRadius: number;
    outerRadius: number;
    startScale: number;
    endScale: number;
  }): void {
    const geo = new THREE.RingGeometry(opts.innerRadius, opts.outerRadius, 32);
    const material = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2;
    const w = tileFloatToWorld(opts.tileX, opts.tileY);
    // Sit just above the grid plane to avoid z-fighting with tile lines.
    mesh.position.set(w.x, 0.04, w.z);
    mesh.scale.set(opts.startScale, opts.startScale, 1);
    this.group.add(mesh);
    this.pings.push({
      mesh,
      material,
      ageMs: 0,
      lifetimeMs: opts.lifetimeMs,
      startScale: opts.startScale,
      endScale: opts.endScale,
    });
  }

  // Per-frame update — driven from the same rAF loop as the HUD/camera.
  // dtMs comes in already-clamped (the bootstrap clamps to 100ms to
  // survive long tab pauses) so we don't have to re-clamp here.
  update(dtMs: number): void {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifetimeMs) {
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.material.dispose();
        this.pings.splice(i, 1);
        continue;
      }
      const t = p.ageMs / p.lifetimeMs;
      const scale = p.startScale + (p.endScale - p.startScale) * t;
      p.mesh.scale.set(scale, scale, 1);
      // Quadratic fade-out so the ring is bright at impact and tails
      // off cleanly. Linear felt sluggish on the way out.
      const fade = (1 - t) * (1 - t);
      p.material.opacity = 0.95 * fade;
    }
  }

  dispose(): void {
    for (const p of this.pings) {
      this.group.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.material.dispose();
    }
    this.pings.length = 0;
    this.group.parent?.remove(this.group);
  }
}
