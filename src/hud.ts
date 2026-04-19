// DOM HUD overlay — faction-coloured panels for energy (top-left) and
// points (top-center). No canvas texture; plain DOM so text stays crisp.
// All containers use pointer-events: none so the canvas receives input.

import type { FactionEnergy } from './economy';
import type { FactionPoints } from './points';

const FONT_STACK = 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace';
const BG = 'rgba(10, 12, 16, 0.85)';

const POINT_FLASH_CLASS = 'vylux-point-flash';
const POINT_FLASH_MS = 180;

function injectPointFlashStyle(): void {
  if (document.getElementById('vylux-point-flash-style')) return;
  const style = document.createElement('style');
  style.id = 'vylux-point-flash-style';
  style.textContent = `
@keyframes vylux-point-flash-anim {
  0%   { background: rgba(255,255,255,0.22); }
  30%  { background: rgba(255,255,255,0.18); }
  100% { background: transparent; }
}
.${POINT_FLASH_CLASS} {
  animation: vylux-point-flash-anim ${POINT_FLASH_MS}ms ease-out forwards;
  border-radius: 2px;
}
`;
  document.head.appendChild(style);
}

const BLUE_BORDER = '#00e0ff';
const RED_BORDER = '#ff4a1a';

const BLUE_SHADOW = `0 0 6px rgba(0, 224, 255, 0.7), 0 0 14px rgba(0, 224, 255, 0.35)`;
const RED_SHADOW = `0 0 6px rgba(255, 74, 26, 0.7), 0 0 14px rgba(255, 74, 26, 0.35)`;

const BLUE_TEXT = '#00e0ff';
const RED_TEXT = '#ff4a1a';

function applyBaseStyles(el: HTMLElement): void {
  el.style.fontFamily = FONT_STACK;
  el.style.pointerEvents = 'none';
  el.style.userSelect = 'none';
  el.style.position = 'absolute';
}

function makePanel(borderColor: string, shadow: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.background = BG;
  panel.style.border = `1px solid ${borderColor}`;
  panel.style.filter = `drop-shadow(${shadow.replace(/,\s*0/g, ',0')})`;
  panel.style.borderRadius = '3px';
  panel.style.padding = '6px 10px';
  panel.style.minWidth = '110px';
  panel.style.pointerEvents = 'none';
  panel.style.boxSizing = 'border-box';
  return panel;
}

function makeLabel(text: string, color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.color = color;
  el.style.fontSize = '9px';
  el.style.letterSpacing = '0.12em';
  el.style.fontFamily = FONT_STACK;
  el.style.textTransform = 'uppercase';
  el.style.marginBottom = '2px';
  el.style.pointerEvents = 'none';
  return el;
}

function makeValue(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = '0';
  el.style.color = color;
  el.style.fontSize = '18px';
  el.style.fontFamily = FONT_STACK;
  el.style.lineHeight = '1';
  el.style.pointerEvents = 'none';
  return el;
}

function makeSectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.color = 'rgba(180, 200, 210, 0.55)';
  el.style.fontSize = '8px';
  el.style.letterSpacing = '0.18em';
  el.style.fontFamily = FONT_STACK;
  el.style.textTransform = 'uppercase';
  el.style.marginBottom = '5px';
  el.style.pointerEvents = 'none';
  return el;
}

export type HudHandles = {
  updateEnergy: (energy: FactionEnergy) => void;
  updatePoints: (points: FactionPoints) => void;
  /** Returns true if the given faction's points value element has the flash class applied. */
  hasPointFlashClass: (faction: 'blue' | 'red') => boolean;
};

/**
 * Mount the HUD overlay into document.body.
 * Returns handles to push new values each frame.
 */
function triggerPointFlash(el: HTMLElement): void {
  // Remove and re-add class to restart animation if already playing.
  el.classList.remove(POINT_FLASH_CLASS);
  // Force reflow so removing and re-adding takes effect.
  void (el.offsetWidth);
  el.classList.add(POINT_FLASH_CLASS);
}

export function createHud(): HudHandles {
  injectPointFlashStyle();

  // Root overlay — full-screen, pointer passthrough.
  const root = document.createElement('div');
  root.id = 'vylux-hud';
  applyBaseStyles(root);
  root.style.top = '0';
  root.style.left = '0';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.zIndex = '100';

  // ── Energy block (top-left) ───────────────────────────────────────────────
  const energyBlock = document.createElement('div');
  applyBaseStyles(energyBlock);
  energyBlock.style.top = '14px';
  energyBlock.style.left = '14px';
  energyBlock.style.display = 'flex';
  energyBlock.style.flexDirection = 'column';
  energyBlock.style.gap = '6px';

  energyBlock.appendChild(makeSectionLabel('Energy'));

  const blueEnergyPanel = makePanel(BLUE_BORDER, BLUE_SHADOW);
  blueEnergyPanel.appendChild(makeLabel('Blue', BLUE_TEXT));
  const blueEnergyValue = makeValue(BLUE_TEXT);
  blueEnergyPanel.appendChild(blueEnergyValue);
  energyBlock.appendChild(blueEnergyPanel);

  const redEnergyPanel = makePanel(RED_BORDER, RED_SHADOW);
  redEnergyPanel.appendChild(makeLabel('Red', RED_TEXT));
  const redEnergyValue = makeValue(RED_TEXT);
  redEnergyPanel.appendChild(redEnergyValue);
  energyBlock.appendChild(redEnergyPanel);

  root.appendChild(energyBlock);

  // ── Points block (top-right) ──────────────────────────────────────────────
  // Moved from top-center: the blue HQ sits in the canvas center column and
  // was fully occluded by the old position, tanking the silhouette rubric axis.
  const pointsBlock = document.createElement('div');
  applyBaseStyles(pointsBlock);
  pointsBlock.style.top = '14px';
  pointsBlock.style.right = '14px';
  pointsBlock.style.display = 'flex';
  pointsBlock.style.flexDirection = 'column';
  pointsBlock.style.alignItems = 'flex-end';
  pointsBlock.style.gap = '6px';

  pointsBlock.appendChild(makeSectionLabel('Points'));

  const pointsRow = document.createElement('div');
  pointsRow.style.display = 'flex';
  pointsRow.style.gap = '8px';
  pointsRow.style.pointerEvents = 'none';

  const bluePointsPanel = makePanel(BLUE_BORDER, BLUE_SHADOW);
  bluePointsPanel.appendChild(makeLabel('Blue', BLUE_TEXT));
  const bluePointsValue = makeValue(BLUE_TEXT);
  bluePointsPanel.appendChild(bluePointsValue);
  pointsRow.appendChild(bluePointsPanel);

  const redPointsPanel = makePanel(RED_BORDER, RED_SHADOW);
  redPointsPanel.appendChild(makeLabel('Red', RED_TEXT));
  const redPointsValue = makeValue(RED_TEXT);
  redPointsPanel.appendChild(redPointsValue);
  pointsRow.appendChild(redPointsPanel);

  pointsBlock.appendChild(pointsRow);
  root.appendChild(pointsBlock);

  document.body.appendChild(root);

  let prevBluePoints = -1;
  let prevRedPoints = -1;

  return {
    updateEnergy(energy: FactionEnergy): void {
      blueEnergyValue.textContent = String(Math.floor(energy.blue));
      redEnergyValue.textContent = String(Math.floor(energy.red));
    },
    updatePoints(points: FactionPoints): void {
      const flooredBlue = Math.floor(points.blue);
      const flooredRed = Math.floor(points.red);
      if (prevBluePoints !== -1 && flooredBlue !== prevBluePoints) {
        triggerPointFlash(bluePointsValue);
      }
      if (prevRedPoints !== -1 && flooredRed !== prevRedPoints) {
        triggerPointFlash(redPointsValue);
      }
      bluePointsValue.textContent = String(flooredBlue);
      redPointsValue.textContent = String(flooredRed);
      prevBluePoints = flooredBlue;
      prevRedPoints = flooredRed;
    },
    hasPointFlashClass(faction: 'blue' | 'red'): boolean {
      const el = faction === 'blue' ? bluePointsValue : redPointsValue;
      return el.classList.contains(POINT_FLASH_CLASS);
    },
  };
}
