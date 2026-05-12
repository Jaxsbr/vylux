// Tiny WebGL scene embedded inside the selection-portrait box. Renders
// the actual in-game mesh for the selected entity (HQ / worker / work
// pod / energy node) at an isometric angle that matches the main
// scene — so the portrait reads as "you've selected this 3D thing"
// rather than an abstract letter glyph.
//
// One renderer + one shared scene; we add/remove a single child group
// when the entity changes. Meshes are cached by (kind, faction) so
// repeated selections don't rebuild them. We render lazily — only when
// the entity actually changes — because nothing in the portrait scene
// animates (selection rings, hp bars, build progress are all toggled
// off; the per-tile transform is constant).

import * as THREE from 'three';
import type { Faction } from '../sim/types';
import {
  buildHqMesh,
  buildNodeMesh,
  buildUnitMesh,
  buildWorkPodMesh,
} from './meshes';

export type PortraitKind = 'hq' | 'worker' | 'workPod' | 'energyNode';

export interface PortraitEntity {
  kind: PortraitKind;
  // Energy nodes have no owning faction; null is the neutral case.
  faction: Faction | null;
}

export class PortraitRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly root: THREE.Group;
  private readonly cache = new Map<string, THREE.Group>();
  private active: THREE.Group | null = null;

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
      alpha: true,
      // Single-render-per-change pattern, so we don't need a persistent
      // animation loop — preserveDrawingBuffer keeps the result on
      // screen between render() calls without re-issuing.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x0d1117, 0); // transparent over the portrait box bg

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(3, 5, 3);
    this.scene.add(dir);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
    this.camDir = new THREE.Vector3(0.9, 1.1, 0.9).normalize();
  }

  setEntity(entity: PortraitEntity | null): void {
    if (this.active !== null) {
      this.root.remove(this.active);
      this.active = null;
    }
    if (entity === null) return;

    const key = `${entity.kind}|${entity.faction ?? 'neutral'}`;
    let mesh = this.cache.get(key);
    if (mesh === undefined) {
      mesh = this.buildEntity(entity);
      this.cache.set(key, mesh);
    }
    this.root.add(mesh);
    this.active = mesh;
    this.fitCameraTo(mesh);
    this.render();
  }

  private buildEntity(entity: PortraitEntity): THREE.Group {
    // Each builder positions the mesh on its tile-0 world spot; the
    // wrapper group below resets to origin so the camera fit works in a
    // single coordinate space. We also strip the auxiliary affordances
    // (selection ring, HP bar, scaffolding) — those make sense in-world
    // but clutter the portrait.
    const wrapper = new THREE.Group();
    const f: Faction = entity.faction ?? 0;
    switch (entity.kind) {
      case 'hq': {
        const v = buildHqMesh(f, 0, 0);
        v.group.position.set(0, 0, 0);
        v.selectionRing.visible = false;
        v.hpBar.group.visible = false;
        wrapper.add(v.group);
        break;
      }
      case 'worker': {
        const v = buildUnitMesh('worker', f, 0, 0);
        v.group.position.set(0, 0, 0);
        v.selectionRing.visible = false;
        v.hpBar.group.visible = false;
        wrapper.add(v.group);
        break;
      }
      case 'workPod': {
        const v = buildWorkPodMesh(f, 0, 0);
        v.group.position.set(0, 0, 0);
        v.selectionRing.visible = false;
        v.hpBar.group.visible = false;
        // Show the pod as completed (scaffolding gone, full body) so
        // the portrait reads as "this is what a work pod is" rather
        // than "you've selected a half-built thing".
        v.setBuildProgress(1);
        wrapper.add(v.group);
        break;
      }
      case 'energyNode': {
        const v = buildNodeMesh(0, 0, 'energy');
        v.group.position.set(0, 0, 0);
        // Use a fixed mid-bright emissive for the portrait silhouette
        // so it reads consistently regardless of in-world depletion.
        v.setRemaining(1, 1);
        wrapper.add(v.group);
        break;
      }
    }
    return wrapper;
  }

  private fitCameraTo(group: THREE.Group): void {
    // Use a SHARED frustum size across every entity so size relationships
    // are preserved — a worker should clearly look smaller than an HQ.
    // HQ is the largest mesh in the roster (~3.4 world-y tall after
    // HQ_SCALE); this halfExtent crops the HQ silhouette slightly at
    // the top, which is the "close-up" feel the player asked for, and
    // still leaves the smaller meshes (worker / pod / node) sitting
    // proportionally inside the frame.
    const halfExtent = 1.3;
    this.camera.left = -halfExtent;
    this.camera.right = halfExtent;
    this.camera.top = halfExtent;
    this.camera.bottom = -halfExtent;
    this.camera.updateProjectionMatrix();

    // Anchor the lookAt on each entity's own bounding-sphere centre so
    // tall meshes don't sit half-off the bottom edge and short meshes
    // aren't lost in empty headroom. Distance is well outside the
    // ±50 ortho near/far clip.
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const distance = 10;
    this.camera.position.copy(this.camDir).multiplyScalar(distance).add(center);
    this.camera.lookAt(center);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const g of this.cache.values()) {
      g.traverse((obj) => {
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
