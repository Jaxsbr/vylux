// Phase C.6 — the tutorial "coach".
//
// A DOM overlay that shows a callout bubble for the current step and a
// looping ghost-cursor that *demonstrates* the gesture (glide in → click
// pulse → fade → repeat). Reuses the main menu's ghost-cursor idiom (a ring
// + centre dot tinted to the faction). Pure presentation — the controller
// tells it what to show and feeds it the anchor's screen position each frame;
// the overlay owns only the animation clock.
//
// The layer is pointer-events:none so clicks pass straight through to the
// real HUD buttons / canvas underneath — except the optional GOT IT button,
// which re-enables pointer events on itself.

import * as THREE from 'three';
import type { Camera } from 'three';
import { tileFloatToWorld } from '../scene';
import { themeForFaction } from '../factions/theme';
import type { Faction } from '../../sim/types';
import type { CoachGesture } from './tutorial-steps';

// Right-click pulses read in amber so the gesture is unmistakably "the OTHER
// button" versus the faction-tinted left-click pulse.
const RIGHT_CLICK_COLOR = '#ffd166';

const LOOP_MS = 1800;

export interface CoachStepView {
  title: string;
  body: string;
  gesture: CoachGesture;
  // When true, an acknowledge ("GOT IT") button is shown; clicking it calls
  // onAck. Used for informational steps that aren't gated on a game action.
  ack: boolean;
  onAck?: () => void;
}

// Project a sim tile (fractional ok) to a viewport CSS-pixel coordinate.
// Shared by the controller + the first-action nudge. Mirrors the projection
// math in input-controller's findOwnedUnitsInScreenRect.
export function projectTileToScreen(
  tileX: number,
  tileY: number,
  camera: Camera,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const w = tileFloatToWorld(tileX, tileY);
  const v = new THREE.Vector3(w.x, 0, w.z);
  v.project(camera);
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((v.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - v.y) / 2) * rect.height,
  };
}

export class CoachOverlay {
  private readonly root: HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly ackBtn: HTMLButtonElement;
  private readonly ghost: HTMLDivElement;
  private readonly ghostRing: HTMLDivElement;
  private readonly pulse: HTMLDivElement;
  private readonly primary: string;

  private clockMs = 0;
  private gesture: CoachGesture = 'point';
  private anchor: { x: number; y: number } | null = null;
  private visible = false;

  constructor(faction: Faction, root: HTMLElement = document.body) {
    const theme = themeForFaction(faction);
    this.primary = theme.primary;

    this.root = document.createElement('div');
    this.root.className = 'vy-coach';
    this.root.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none',
      'z-index:35', 'display:none',
      'font-family:ui-monospace,Menlo,monospace',
    ].join(';');

    // Callout bubble.
    this.bubble = document.createElement('div');
    this.bubble.style.cssText = [
      'position:absolute', 'box-sizing:border-box',
      'max-width:300px', 'min-width:220px',
      'padding:14px 16px',
      'background:rgba(7,9,12,0.92)',
      `border:${theme.strokeW}px solid ${theme.primary}`,
      `border-radius:${theme.radius}px`,
      `box-shadow:0 0 18px ${theme.glow}, 0 6px 30px rgba(0,0,0,0.6)`,
      'color:#dfe8ee',
      'transform:translate(-50%,0)',
      'pointer-events:none',
    ].join(';');

    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = [
      'font-size:13px', 'font-weight:700', `letter-spacing:${theme.bodyTrack}`,
      `color:${theme.primary}`, `text-shadow:0 0 10px ${theme.glowSoft}`,
      'margin-bottom:6px',
    ].join(';');
    this.bubble.appendChild(this.titleEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText = 'font-size:11px;line-height:1.5;color:rgba(216,232,240,0.88)';
    this.bubble.appendChild(this.bodyEl);

    this.ackBtn = document.createElement('button');
    this.ackBtn.textContent = 'GOT IT  ▸';
    this.ackBtn.style.cssText = [
      'margin-top:12px', 'background:transparent',
      `border:1px solid ${theme.primary}`, `border-radius:${theme.radius}px`,
      `color:${theme.primary}`, 'padding:6px 16px',
      'font-family:inherit', 'font-size:10px', 'letter-spacing:0.2em',
      'cursor:pointer', 'pointer-events:auto', 'display:none',
    ].join(';');
    this.bubble.appendChild(this.ackBtn);

    this.root.appendChild(this.bubble);

    // Ghost cursor: ring + expanding click pulse.
    this.ghost = document.createElement('div');
    this.ghost.style.cssText = [
      'position:absolute', 'width:26px', 'height:26px',
      'transform:translate(-50%,-50%)', 'pointer-events:none', 'will-change:transform,opacity',
    ].join(';');

    this.ghostRing = document.createElement('div');
    this.ghostRing.style.cssText = [
      'position:absolute', 'inset:0', 'border-radius:50%',
      `border:2px solid ${theme.primary}`,
      `box-shadow:0 0 10px ${theme.primary}, inset 0 0 6px ${theme.glowSoft}`,
    ].join(';');
    this.ghost.appendChild(this.ghostRing);

    const dot = document.createElement('div');
    dot.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'width:5px', 'height:5px',
      'border-radius:50%', `background:${theme.primary}`,
      'transform:translate(-50%,-50%)',
    ].join(';');
    this.ghost.appendChild(dot);

    this.pulse = document.createElement('div');
    this.pulse.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'width:26px', 'height:26px',
      'border-radius:50%', `border:2px solid ${theme.primary}`,
      'transform:translate(-50%,-50%) scale(1)', 'opacity:0',
    ].join(';');
    this.ghost.appendChild(this.pulse);

    this.root.appendChild(this.ghost);
    root.appendChild(this.root);
  }

  setStep(view: CoachStepView): void {
    this.titleEl.textContent = view.title;
    this.bodyEl.textContent = view.body;
    this.gesture = view.gesture;
    const gestureColor = view.gesture === 'rightClick' ? RIGHT_CLICK_COLOR : this.primary;
    this.ghostRing.style.borderColor = gestureColor;
    this.ghostRing.style.boxShadow = `0 0 10px ${gestureColor}`;
    this.pulse.style.borderColor = gestureColor;
    if (view.ack) {
      this.ackBtn.style.display = 'inline-block';
      this.ackBtn.onclick = () => view.onAck?.();
    } else {
      this.ackBtn.style.display = 'none';
      this.ackBtn.onclick = null;
    }
    this.clockMs = 0;
    this.show();
  }

  // Feed the current screen-space anchor (target centre) each frame. null
  // hides the ghost cursor for this frame (anchor off-screen / unavailable),
  // but the bubble keeps its last on-screen position so text stays readable.
  setAnchor(pos: { x: number; y: number } | null): void {
    this.anchor = pos;
  }

  update(dtMs: number): void {
    if (!this.visible) return;
    this.clockMs = (this.clockMs + dtMs) % LOOP_MS;
    const a = this.anchor;
    if (a === null) {
      this.ghost.style.opacity = '0';
      return;
    }

    // Position the bubble near the anchor: above it by default, flipped below
    // if it would clip the top of the viewport. Clamp horizontally so it
    // never runs off the edges.
    const margin = 14;
    const bubbleW = this.bubble.offsetWidth || 260;
    const bubbleH = this.bubble.offsetHeight || 90;
    let bx = a.x;
    bx = Math.max(bubbleW / 2 + margin, Math.min(window.innerWidth - bubbleW / 2 - margin, bx));
    let by = a.y - bubbleH - 40; // above the anchor
    if (by < margin) by = a.y + 40; // not enough room above → drop below
    // Clamp vertically so a low anchor that drops below can't run off-screen.
    by = Math.max(margin, Math.min(window.innerHeight - bubbleH - margin, by));
    this.bubble.style.left = `${bx}px`;
    this.bubble.style.top = `${by}px`;

    // Ghost-cursor loop. Approach the anchor from a gesture-dependent offset,
    // fire a click pulse, fade, repeat.
    const p = this.clockMs / LOOP_MS;
    const startDX = this.gesture === 'rightClick' ? 46 : -46;
    const startDY = -42;
    let gx = a.x;
    let gy = a.y;
    let opacity = 1;
    if (p < 0.45) {
      // approach (ease-out)
      const t = p / 0.45;
      const e = 1 - Math.pow(1 - t, 2);
      gx = a.x + startDX * (1 - e);
      gy = a.y + startDY * (1 - e);
      opacity = Math.min(1, t * 3);
      this.firePulse(0);
    } else if (p < 0.7) {
      // click pulse at the anchor
      const t = (p - 0.45) / 0.25;
      this.firePulse(t);
    } else {
      // hold + fade out
      const t = (p - 0.7) / 0.3;
      opacity = 1 - t;
      this.firePulse(0);
    }
    this.ghost.style.left = `${gx}px`;
    this.ghost.style.top = `${gy}px`;
    this.ghost.style.opacity = String(opacity);
  }

  private firePulse(t: number): void {
    if (t <= 0) {
      this.pulse.style.opacity = '0';
      this.pulse.style.transform = 'translate(-50%,-50%) scale(1)';
      return;
    }
    this.pulse.style.opacity = String((1 - t) * 0.8);
    this.pulse.style.transform = `translate(-50%,-50%) scale(${1 + t * 1.8})`;
  }

  private show(): void {
    this.visible = true;
    this.root.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.remove();
  }
}
