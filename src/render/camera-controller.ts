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
// over the canvas pixel width.
//
// Phase 3.10.9 — iso-rotated pan input.
//
// The camera sits at +x +y +z and looks at origin, so its right vector
// in world space is (+x, 0, -z) and its ground-projected up vector is
// (+x, 0, +z) — both at 45° to the world axes. A naïve "screen-x →
// world-x, screen-y → world-z" mapping panned the map along the world
// axes, which to the player looked like "left and right both shift the
// map diagonally," because their perceived horizontal IS that
// diagonal in world space.
//
// `screenToWorldDelta` rotates a screen-axis (right=+x, down=+y)
// vector into world (x, z) coords using the iso-camera basis. Both
// pointer drag and WASD/arrow input flow through it.
const ISO_R = Math.SQRT1_2; // cos(45°) = sin(45°) ≈ 0.7071

function screenToWorldDelta(sx: number, sy: number): { worldDx: number; worldDz: number } {
  // Camera right (world) ≈ (+r, 0, -r); camera ground-up (world) ≈
  // (-r, 0, -r) — i.e. screen-up reveals more of the world along
  // (-x, -z) (toward the camera position), so screen-DOWN (+sy)
  // moves the projected basis along (+r, 0, +r). Combined with the
  // outer negation in panBy that flips drag-direction → target-shift,
  // the net effect is: drag right pans along +x/-z (the player's
  // perceived horizontal, from bottom-left to top-right of the iso
  // grid); drag down pans along +x/+z (the player's perceived
  // vertical, top-left to bottom-right).
  const worldDx = (sx + sy) * ISO_R;
  const worldDz = (-sx + sy) * ISO_R;
  return { worldDx, worldDz };
}

import * as THREE from 'three';
import { GRID_CONSTANTS } from '../grid';
import { DEFAULT_HALF_HEIGHT, DEFAULT_ZOOM_SCALE, ZOOM_MAX, ZOOM_MIN } from './scene';

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
  private zoomScale = DEFAULT_ZOOM_SCALE;
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

  // Snap the pan target to a world-space (x, z) position. Used at match
// start to centre the player's HQ in the viewport; respects the same
// pan limits as drag/keyboard panning.
  centerOn(worldX: number, worldZ: number): void {
    const limit = GRID_CONSTANTS.worldExtent * PAN_LIMIT_RATIO;
    this.target.x = clamp(worldX, -limit, limit);
    this.target.z = clamp(worldZ, -limit, limit);
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
    // Resolve held keys into a screen-space intent vector (sx +right,
    // sy +down). The iso rotation in `screenToWorldDelta` then maps
    // that intent into world (x, z). Without the rotation, "a" and
    // "d" would pan the map along the world-x axis — but the player
    // perceives "left/right" as the iso diagonal.
    let sx = 0;
    let sy = 0;
    if (this.heldKeys.has('w') || this.heldKeys.has('arrowup')) sy -= 1;
    if (this.heldKeys.has('s') || this.heldKeys.has('arrowdown')) sy += 1;
    if (this.heldKeys.has('a') || this.heldKeys.has('arrowleft')) sx -= 1;
    if (this.heldKeys.has('d') || this.heldKeys.has('arrowright')) sx += 1;
    if (sx === 0 && sy === 0) return;
    // Normalize so diagonal key combos aren't sqrt(2)× faster.
    const len = Math.hypot(sx, sy);
    sx /= len;
    sy /= len;
    const speed = KEY_PAN_SPEED * dtSeconds;
    const { worldDx, worldDz } = screenToWorldDelta(sx * speed, sy * speed);
    this.panBy(worldDx, worldDz);
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
    // Pixel delta → world delta. Two steps:
    //   1. scale pixels into camera-plane world units via the current
    //      frustum width / canvas pixel width;
    //   2. rotate from screen-axis (right=+x, down=+y) into world (x, z)
    //      using the iso-camera basis (45° rotation).
    // Drag-pan moves the world *under* the cursor, so we negate the
    // resulting world delta — dragging the mouse to the player's right
    // shifts the map right, which means the camera target moves left.
    const c = this.opts.camera;
    const rect = this.opts.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const worldPerPxX = (c.right - c.left) / rect.width;
    const worldPerPxY = (c.top - c.bottom) / rect.height;
    const { worldDx, worldDz } = screenToWorldDelta(dx * worldPerPxX, dy * worldPerPxY);
    this.panBy(-worldDx, -worldDz);
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
