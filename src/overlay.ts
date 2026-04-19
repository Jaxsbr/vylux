// DOM match overlay — VICTORY / DEFEAT screen with PLAY AGAIN button.
// Overlay is DOM-only (not canvas). Backdrop is pointer-events:none; panel is auto.

import type { MatchOutcome } from './match';

const FONT_STACK = 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace';
const BLUE_TEXT = '#00e0ff';
const RED_TEXT = '#ff4a1a';

let overlayEl: HTMLDivElement | null = null;
let playAgainCallback: (() => void) | null = null;

export function showMatchOverlay(
  outcome: MatchOutcome,
  score: { blue: number; red: number },
  onPlayAgain: () => void,
): void {
  if (overlayEl !== null) return; // already shown

  playAgainCallback = onPlayAgain;

  const backdrop = document.createElement('div');
  backdrop.id = 'vylux-match-overlay';
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.55)',
    zIndex: '500',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    fontFamily: FONT_STACK,
    background: 'rgba(10,12,16,0.92)',
    border: `2px solid ${outcome === 'blue-wins' ? BLUE_TEXT : RED_TEXT}`,
    boxShadow: outcome === 'blue-wins'
      ? '0 0 24px rgba(0,224,255,0.5), 0 0 48px rgba(0,224,255,0.2)'
      : '0 0 24px rgba(255,74,26,0.5), 0 0 48px rgba(255,74,26,0.2)',
    borderRadius: '6px',
    padding: '40px 60px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    pointerEvents: 'auto',
    userSelect: 'none',
  });

  const heading = document.createElement('div');
  heading.id = 'vylux-overlay-heading';
  heading.textContent = outcome === 'blue-wins' ? 'VICTORY' : 'DEFEAT';
  Object.assign(heading.style, {
    fontSize: '48px',
    letterSpacing: '0.15em',
    color: outcome === 'blue-wins' ? BLUE_TEXT : RED_TEXT,
    textShadow: outcome === 'blue-wins'
      ? '0 0 16px rgba(0,224,255,0.8)'
      : '0 0 16px rgba(255,74,26,0.8)',
    fontFamily: FONT_STACK,
  });

  const subtitle = document.createElement('div');
  subtitle.id = 'vylux-overlay-score';
  subtitle.textContent = `BLUE ${Math.floor(score.blue)}  RED ${Math.floor(score.red)}`;
  Object.assign(subtitle.style, {
    fontSize: '16px',
    letterSpacing: '0.12em',
    color: 'rgba(180,200,210,0.85)',
    fontFamily: FONT_STACK,
  });

  const btn = document.createElement('button');
  btn.id = 'vylux-play-again';
  btn.textContent = 'PLAY AGAIN';
  Object.assign(btn.style, {
    marginTop: '12px',
    padding: '10px 28px',
    fontFamily: FONT_STACK,
    fontSize: '14px',
    letterSpacing: '0.14em',
    background: 'transparent',
    color: outcome === 'blue-wins' ? BLUE_TEXT : RED_TEXT,
    border: `1px solid ${outcome === 'blue-wins' ? BLUE_TEXT : RED_TEXT}`,
    borderRadius: '3px',
    cursor: 'pointer',
    pointerEvents: 'auto',
  });
  btn.addEventListener('click', () => {
    if (playAgainCallback !== null) playAgainCallback();
  });

  panel.appendChild(heading);
  panel.appendChild(subtitle);
  panel.appendChild(btn);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  overlayEl = backdrop;
}

export function hideMatchOverlay(): void {
  if (overlayEl !== null) {
    overlayEl.remove();
    overlayEl = null;
  }
  playAgainCallback = null;
}

export function isOverlayVisible(): boolean {
  return overlayEl !== null;
}
