// Camera pan + zoom (Phase 3.4).
//
// Pure presentation — does not touch the sim. Owns:
//   - the look-at target (world position the camera is centred on)
//   - the zoom scale (multiplies the scene's default halfHeight)
//   - input handlers for middle-mouse drag, WASD/arrow keys, scroll wheel
//
// The orthographic iso camera stays at `target + offset` where `offset`
// is the iso angle vector handed in by the scene. Panning translates
// target; zoom changes the camera frustum via scene.setHalfHeight.
//
// Keyboard pan integrates per-rAF in update() so a held key produces
// continuous motion rather than one nudge per repeat. Pointer pan
// converts pixel deltas to world-units via the current frustum width
// over the canvas pixel width — same scale on both axes since the iso
// view's screen-x/world-x and screen-y/world-z map linearly under
// orthographic projection.

import * as THREE from 'three';
import { GRID_CONSTANTS } from '../grid';
import { DEFAULT_HALF_HEIGHT, ZOOM_MAX, ZOOM_MIN } from './scene';

// World-units-per-second of pan from a fully-held WASD/arrow key.
// Tuned so a player can cross the (32-tile) map in ~3–4 seconds.
const KEY_PAN_SPEED = 12;

// Multiplier per scroll wheel notch. Negative deltaY = zoom in (smaller
// halfHeight); positive = zoom out. Modest step so the player can fine-
// tune without committing to one big jump.
const ZOOM_STEP = 1.1;

// Pan target is clamped to ±PAN_LIMIT_RATIO * worldExtent on either
// axis so the player can scroll past the grid edge for context but
// can't lose the map entirely.
const PAN_LIMIT_RATIO = 0.6;

export interface CameraControllerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.OrthographicCamera;
  cameraOffset: THREE.Vector3;
  setHalfHeight: (halfHeight: number) => void;
}

export class CameraController {
  private readonly opts: CameraControllerOptions;
  private readonly target = new THREE.Vector3(0, 0, 0);
  private zoomScale = 1;
  private readonly heldKeys = new Set<string>();
  private dragging = false;
  // Last-seen client coords during a middle-mouse drag.
  private lastClientX = 0;
  private lastClientY = 0;

  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly onBlur = () => this.heldKeys.clear();

  constructor(opts: CameraControllerOptions) {
    this.opts = opts;
    opts.canvas.addEventListener('pointerdown', this.onPointerDown);
    opts.canvas.addEventListener('pointermove', this.onPointerMove);
    opts.canvas.addEventListener('pointerup', this.onPointerUp);
    opts.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.applyTransform();
  }

  detach(): void {
    const c = this.opts.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  // Called once per render frame with the elapsed time in seconds since
  // the previous call. Drives keyboard-held panning. Pointer pan +
  // wheel zoom apply immediately in their event handlers.
  update(dtSeconds: number): void {
    if (this.heldKeys.size === 0) return;
    let dx = 0;
    let dz = 0;
    if (this.heldKeys.has('w') || this.heldKeys.has('arrowup')) dz -= 1;
    if (this.heldKeys.has('s') || this.heldKeys.has('arrowdown')) dz += 1;
    if (this.heldKeys.has('a') || this.heldKeys.has('arrowleft')) dx -= 1;
    if (this.heldKeys.has('d') || this.heldKeys.has('arrowright')) dx += 1;
    if (dx === 0 && dz === 0) return;
    // Normalize so diagonal pan isn't sqrt(2)x faster.
    const len = Math.hypot(dx, dz);
    dx /= len;
    dz /= len;
    const speed = KEY_PAN_SPEED * dtSeconds;
    this.panBy(dx * speed, dz * speed);
  }

  // ----- event handlers --------------------------------------------------

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 1) return; // middle mouse only
    e.preventDefault();
    this.dragging = true;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    try {
      this.opts.canvas.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already captured
      // by another element; the drag still works without it.
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastClientX;
    const dy = e.clientY - this.lastClientY;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    // Pixel delta → world delta via current frustum width / canvas
    // pixel width. Drag-pan moves the world *under* the cursor, so
    // negate the deltas: dragging right pulls the map right (target
    // shifts left).
    const c = this.opts.camera;
    const rect = this.opts.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const worldPerPxX = (c.right - c.left) / rect.width;
    const worldPerPxY = (c.top - c.bottom) / rect.height;
    this.panBy(-dx * worldPerPxX, -dy * worldPerPxY);
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.button !== 1) return;
    if (!this.dragging) return;
    this.dragging = false;
    try {
      this.opts.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // releasePointerCapture throws if not captured; not fatal.
    }
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    this.setZoomScale(this.zoomScale * factor);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (this.isPanKey(k)) {
      this.heldKeys.add(k);
      // Don't preventDefault — Esc and other handlers in the page may
      // still want the event. Pan keys aren't browser-meaningful by
      // default in our context.
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (this.isPanKey(k)) this.heldKeys.delete(k);
  }

  private isPanKey(k: string): boolean {
    return (
      k === 'w' || k === 'a' || k === 's' || k === 'd' ||
      k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright'
    );
  }

  // ----- transform helpers -----------------------------------------------

  private panBy(dx: number, dz: number): void {
    const limit = GRID_CONSTANTS.worldExtent * PAN_LIMIT_RATIO;
    this.target.x = clamp(this.target.x + dx, -limit, limit);
    this.target.z = clamp(this.target.z + dz, -limit, limit);
    this.applyTransform();
  }

  private setZoomScale(scale: number): void {
    this.zoomScale = clamp(scale, ZOOM_MIN, ZOOM_MAX);
    this.opts.setHalfHeight(DEFAULT_HALF_HEIGHT * this.zoomScale);
  }

  private applyTransform(): void {
    const c = this.opts.camera;
    c.position.set(
      this.target.x + this.opts.cameraOffset.x,
      this.target.y + this.opts.cameraOffset.y,
      this.target.z + this.opts.cameraOffset.z,
    );
    c.lookAt(this.target.x, this.target.y, this.target.z);
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
