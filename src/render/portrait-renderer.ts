// Tiny WebGL scene embedded inside the selection-portrait box. Renders
// the actual in-game mesh for the selected entity (HQ / worker / work
// pod / energy node) at an isometric angle that matches the main
// scene — so the portrait reads as "you've selected this 3D thing"
// rather than an abstract letter glyph.
//
// Ad-hoc pass (2026-05-27): the portrait is no longer a frozen snapshot.
// Each frame it (a) drives the SAME in-game life animation the entity has
// on the battlefield — the HQ / pod emissive breathe, the worker idle
// hover, the energy-node spin — via each mesh view's `tickLife` / idle-bob,
// and (b) slowly turntable-rotates the entity at a fixed rate so the player
// sees it from every side. The entity mesh is recentred on its own bounding
// box so the spin pivots around the visual centre rather than the floor.
//
// One renderer + one shared scene; we swap a single child group when the
// entity changes. Meshes (and their view objects, so we can keep ticking
// their life) are cached by (kind, faction) so repeated selections don't
// rebuild them.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Faction } from '../sim/types';
import {
  buildHqMesh,
  buildNodeMesh,
  buildUnitMesh,
  buildWorkPodMesh,
  HQ_SCALE,
} from './meshes';
import { workerHover } from './entity-life';

export type PortraitKind = 'hq' | 'worker' | 'workPod' | 'energyNode';

export interface PortraitEntity {
  kind: PortraitKind;
  // Energy nodes have no owning faction; null is the neutral case.
  faction: Faction | null;
}

// A cached portrait entity: its recentred wrapper group + the per-frame
// life animation that mirrors the entity's in-game pulse/hover/spin, plus the
// orthographic half-extent that frames it.
interface CachedEntity {
  group: THREE.Group;
  halfExtent: number;
  tickLife(dt: number, clockS: number): void;
}

// Default ortho half-extent — tuned so a worker / pod / node sits comfortably
// in the frame. The HQ frame is derived from this so size relationships hold.
const PORTRAIT_HALF_EXTENT = 1.3;
// The HQ_SCALE this PORTRAIT_HALF_EXTENT was originally tuned against. The HQ
// portrait frustum scales with HQ_SCALE / this ref, so resizing the world HQ
// (e.g. to a 3×3 footprint) leaves the HQ portrait framed exactly as before —
// only the world mesh grows.
const HQ_PORTRAIT_REFERENCE_SCALE = 2.0;

// Turntable spin rate (radians/second). Slow enough to read as a gentle
// rotate-to-show-off, not a spin. ~0.5 rad/s ≈ one revolution every ~12.5 s.
const PORTRAIT_SPIN_RATE = 0.5;

export class PortraitRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  // Post-process composer (RenderPass → UnrealBloomPass → OutputPass) mirroring
  // the main scene's pipeline so the portrait's emissive trim + accent caps
  // bloom + pulse exactly like the in-game entity — without it the portrait
  // shows flat geometry with no glow.
  private readonly composer: EffectComposer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly root: THREE.Group;
  private readonly cache = new Map<string, CachedEntity>();
  private active: CachedEntity | null = null;

  // Animation state.
  private clockS = 0;
  // Accumulated turntable yaw (radians), advanced at PORTRAIT_SPIN_RATE.
  private spinYaw = 0;

  // Iso-angle direction unit vector, mirrors scene.ts CAMERA_OFFSET_RATIO
  // (0.9, 1.1, 0.9). Normalised so we can scale by per-entity frustum
  // size when fitting.
  private readonly camDir: THREE.Vector3;

  constructor(canvas: HTMLCanvasElement, size: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // We now render each frame while an entity is shown, but keep the
      // drawing buffer so a single setEntity() render (tests / non-animated
      // callers) still paints without an animate() loop driving it.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(size, size, false);
    // Opaque dark fill matching the portrait box bg. The bloom pipeline
    // composites cleanly over an opaque background (a transparent one leaves
    // dark halos around bright pixels), and #0d1117 is the same near-black the
    // box already paints, so the square reads identically.
    this.renderer.setClearColor(0x0d1117, 1);
    // Match the main scene's ACES tone mapping so the bloom falloff + emissive
    // luminance read the same in the portrait as on the battlefield.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(3, 5, 3);
    this.scene.add(dir);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
    this.camDir = new THREE.Vector3(0.9, 1.1, 0.9).normalize();

    // Same passes + tuning as scene.ts (strength 0.55 / radius 0.4 /
    // threshold 0.5) so the portrait's neon trim glows like the live arena.
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(size, size);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size, size), 0.55, 0.4, 0.5));
    this.composer.addPass(new OutputPass());
  }

  setEntity(entity: PortraitEntity | null): void {
    if (this.active !== null) {
      this.root.remove(this.active.group);
      this.active = null;
    }
    if (entity === null) {
      this.render(); // clear the buffer so a stale silhouette doesn't linger
      return;
    }

    const key = `${entity.kind}|${entity.faction ?? 'neutral'}`;
    let cached = this.cache.get(key);
    if (cached === undefined) {
      cached = this.buildEntity(entity);
      this.cache.set(key, cached);
    }
    this.root.add(cached.group);
    this.active = cached;
    // Start each new selection face-on, then spin — otherwise the entity pops
    // in pre-rotated to wherever the previous selection's turntable left off.
    this.spinYaw = 0;
    this.root.rotation.set(0, 0, 0);
    this.fitCameraTo(cached.halfExtent);
    this.render();
  }

  // Per-frame driver. Advances the entity's in-game life animation and the
  // slow turntable spin, then renders. No-op (and no GL work) when nothing is
  // selected.
  animate(dtSeconds: number): void {
    if (this.active === null) return;
    const dt = Math.max(0, Math.min(0.1, dtSeconds));
    this.clockS += dt;

    // Constant-rate turntable rotation around the vertical axis.
    this.spinYaw += PORTRAIT_SPIN_RATE * dt;
    this.root.rotation.set(0, this.spinYaw, 0);

    this.active.tickLife(dt, this.clockS);
    this.render();
  }

  private buildEntity(entity: PortraitEntity): CachedEntity {
    // Each builder positions the mesh on its tile-0 world spot; the wrapper
    // below recentres it on its own bounding box so the camera fit + the
    // turntable spin both work around the visual centre. We strip the
    // auxiliary affordances (selection ring, HP bar, scaffolding) — those
    // make sense in-world but clutter the portrait.
    const wrapper = new THREE.Group();
    const f: Faction = entity.faction ?? 0;
    let tick: (dt: number, clockS: number) => void = () => {};

    switch (entity.kind) {
      case 'hq': {
        const v = buildHqMesh(f, 0, 0);
        v.group.position.set(0, 0, 0);
        v.selectionRing.visible = false;
        v.hpBar.group.visible = false;
        wrapper.add(v.group);
        // In-game HQ life: the accent cap breathes. Same call SimRenderer makes.
        tick = (dt) => v.tickLife(dt);
        break;
      }
      case 'worker': {
        const v = buildUnitMesh('worker', f, 0, 0);
        v.group.position.set(0, 0, 0);
        v.selectionRing.visible = false;
        v.hpBar.group.visible = false;
        wrapper.add(v.group);
        // In-game worker life: a slow vertical idle hover. Drive the same
        // positive-only curve SimRenderer feeds the unit each frame.
        tick = (_dt, clockS) => v.setIdleBob(workerHover(clockS));
        break;
      }
      case 'workPod': {
        const v = buildWorkPodMesh(f, 0, 0);
        v.group.position.set(0, 0, 0);
        v.selectionRing.visible = false;
        v.hpBar.group.visible = false;
        // Show the pod as completed (scaffolding gone, full body) so the
        // portrait reads as "this is what a work pod is" rather than "you've
        // selected a half-built thing".
        v.setBuildProgress(1);
        wrapper.add(v.group);
        // In-game operational-pod life: the charge-bay cap breathes.
        tick = (dt) => v.tickLife(dt, true);
        break;
      }
      case 'energyNode': {
        const v = buildNodeMesh(0, 0, 'energy');
        v.group.position.set(0, 0, 0);
        wrapper.add(v.group);
        // In-game node life: the core slowly spins + breathes. The node's
        // tickLife ADDS its breathe on top of the remaining-driven base
        // emissive, relying on setRemaining being called first each frame to
        // reset that base (SimRenderer does exactly this). So reset it here
        // too — without the per-frame reset the breathe accumulates and the
        // portrait node blows out brighter every frame. A fixed full reserve
        // keeps the silhouette mid-bright regardless of in-world depletion.
        tick = (dt) => {
          v.setRemaining(1, 1);
          v.tickLife(dt);
        };
        break;
      }
    }

    // Recentre the mesh so its bounding-box centre sits at the wrapper
    // origin. The wrapper then turntable-rotates around the visual centre,
    // and the camera looks straight at the origin.
    const box = new THREE.Box3().setFromObject(wrapper);
    const center = box.getCenter(new THREE.Vector3());
    for (const child of wrapper.children) {
      child.position.sub(center);
    }

    // The HQ mesh scales with HQ_SCALE, so its frame must too — that keeps the
    // HQ portrait framed the same no matter how big the world HQ gets (e.g. a
    // 3×3 footprint). Everything else uses the default extent.
    const halfExtent = entity.kind === 'hq'
      ? PORTRAIT_HALF_EXTENT * (HQ_SCALE / HQ_PORTRAIT_REFERENCE_SCALE)
      : PORTRAIT_HALF_EXTENT;

    return { group: wrapper, halfExtent, tickLife: tick };
  }

  private fitCameraTo(halfExtent: number): void {
    // Per-entity frustum: workers / pods / nodes share PORTRAIT_HALF_EXTENT;
    // the HQ's is scaled so its (scaled) silhouette frames identically across
    // HQ_SCALE changes. The fixed-but-related extents preserve the "a worker
    // looks smaller than an HQ" size relationship.
    this.camera.left = -halfExtent;
    this.camera.right = halfExtent;
    this.camera.top = halfExtent;
    this.camera.bottom = -halfExtent;
    this.camera.updateProjectionMatrix();

    // Entities are recentred on the origin (see buildEntity), so the camera
    // always looks at (0, 0, 0); the turntable rotation keeps the centre
    // fixed. Distance is well outside the ±50 ortho near/far clip.
    const distance = 10;
    this.camera.position.copy(this.camDir).multiplyScalar(distance);
    this.camera.lookAt(0, 0, 0);
  }

  private render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    for (const c of this.cache.values()) {
      c.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          disposeMaterial(obj.material);
        } else if (obj instanceof THREE.Sprite) {
          // Worker energy-cue sprite carries a CanvasTexture on its
          // material's .map; the texture is per-worker so it has to
          // be disposed alongside the material.
          disposeMaterial(obj.material);
        }
      });
    }
    this.cache.clear();
    this.renderer.dispose();
  }
}

function disposeMaterial(m: THREE.Material | THREE.Material[]): void {
  const list = Array.isArray(m) ? m : [m];
  for (const mat of list) {
    const withMap = mat as { map?: THREE.Texture | null };
    if (withMap.map) withMap.map.dispose();
    mat.dispose();
  }
}
