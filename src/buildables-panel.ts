// DOM buildables panel — shown when the player clicks the blue HQ.
// Chrome matches hud.ts: mono font, cyan outline, dark background.
// pointer-events: auto on panel, none on root wrapper (so canvas still receives input).
// No imports from scene.ts, input.ts, or placement.ts.

import { UNIT_COSTS, type UnitKind } from './units-config';
import { createTooltip } from './tooltip';

const FONT_STACK = 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace';
const BG = 'rgba(10, 12, 16, 0.90)';
const BLUE_BORDER = '#00e0ff';
const BLUE_TEXT = '#00e0ff';
const DIM_TEXT = 'rgba(80, 120, 130, 0.7)';
const BLUE_SHADOW = '0 0 8px rgba(0, 224, 255, 0.5), 0 0 20px rgba(0, 224, 255, 0.2)';

type BuildableDef = {
  kind: UnitKind;
  label: string;
  role: string;
};

const BUILDABLE_DEFS: BuildableDef[] = [
  { kind: 'worker', label: 'WORKER', role: 'Harvests energy on a node. No combat.' },
  { kind: 'defender', label: 'DEFENDER', role: 'Stationary. Attacks adjacent enemies. High HP.' },
  { kind: 'raider', label: 'RAIDER', role: 'Advances toward enemy. Fast, low HP.' },
];

export type BuildablesPanelHandles = {
  show: () => void;
  hide: () => void;
  /** Update affordability state. Pass the player's current blue energy. */
  updateAffordability: (blueEnergy: number) => void;
  /** Mark one button as armed (highlighted), or pass null to clear. */
  setArmed: (kind: UnitKind | null) => void;
  /** Show a brief feedback message (invalid placement). Auto-clears after 1.5s. */
  showFeedback: (msg: string) => void;
  isVisible: () => boolean;
};

export function createBuildablesPanel(
  onBuildableClick: (kind: UnitKind) => void,
): BuildablesPanelHandles {
  // Root — full-screen pointer passthrough wrapper.
  const root = document.createElement('div');
  root.id = 'vylux-buildables-panel';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '200',
    pointerEvents: 'none',
    display: 'none',
  });

  // Panel — anchored bottom-left above the energy HUD.
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute',
    bottom: '120px',
    left: '14px',
    fontFamily: FONT_STACK,
    background: BG,
    border: `1px solid ${BLUE_BORDER}`,
    boxShadow: BLUE_SHADOW,
    borderRadius: '4px',
    padding: '10px 14px',
    minWidth: '160px',
    pointerEvents: 'auto',
    userSelect: 'none',
  });

  // Panel heading
  const heading = document.createElement('div');
  heading.id = 'vylux-buildables-heading';
  heading.textContent = 'TRAIN UNIT';
  Object.assign(heading.style, {
    color: BLUE_TEXT,
    fontSize: '9px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginBottom: '8px',
    fontFamily: FONT_STACK,
  });
  panel.appendChild(heading);

  // Feedback line
  const feedbackEl = document.createElement('div');
  feedbackEl.id = 'vylux-buildables-feedback';
  Object.assign(feedbackEl.style, {
    color: '#ff9944',
    fontSize: '9px',
    letterSpacing: '0.1em',
    fontFamily: FONT_STACK,
    minHeight: '12px',
    marginBottom: '6px',
    display: 'block',
  });
  panel.appendChild(feedbackEl);

  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  // Buttons
  const buttons: Map<UnitKind, HTMLButtonElement> = new Map();

  for (const { kind, label, role } of BUILDABLE_DEFS) {
    const cost = UNIT_COSTS[kind];

    const btn = document.createElement('button');
    btn.id = `vylux-buildable-${kind}`;
    btn.setAttribute('data-kind', kind);
    Object.assign(btn.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      marginBottom: '6px',
      padding: '6px 10px',
      fontFamily: FONT_STACK,
      fontSize: '12px',
      letterSpacing: '0.1em',
      background: 'transparent',
      color: BLUE_TEXT,
      border: `1px solid ${BLUE_BORDER}`,
      borderRadius: '3px',
      cursor: 'pointer',
      pointerEvents: 'auto',
      boxSizing: 'border-box',
    });

    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;

    const costSpan = document.createElement('span');
    costSpan.textContent = `${cost}`;
    Object.assign(costSpan.style, {
      fontSize: '10px',
      opacity: '0.75',
      marginLeft: '8px',
    });

    btn.appendChild(nameSpan);
    btn.appendChild(costSpan);

    btn.addEventListener('click', () => {
      onBuildableClick(kind);
    });

    // Tooltip — shown on hover, pointer-events: none so clicks still land on button.
    const tipContent = document.createElement('div');
    const tipName = document.createElement('div');
    tipName.textContent = label;
    Object.assign(tipName.style, {
      color: BLUE_TEXT,
      fontSize: '11px',
      letterSpacing: '0.12em',
      fontFamily: FONT_STACK,
      marginBottom: '3px',
      fontWeight: 'bold',
    });
    const tipCost = document.createElement('div');
    tipCost.textContent = `${cost} energy`;
    Object.assign(tipCost.style, {
      color: 'rgba(0, 224, 255, 0.65)',
      fontSize: '10px',
      fontFamily: FONT_STACK,
      marginBottom: '4px',
    });
    const tipRole = document.createElement('div');
    tipRole.id = `vylux-tooltip-role-${kind}`;
    tipRole.textContent = role;
    Object.assign(tipRole.style, {
      color: 'rgba(180, 220, 230, 0.85)',
      fontSize: '10px',
      fontFamily: FONT_STACK,
    });
    tipContent.appendChild(tipName);
    tipContent.appendChild(tipCost);
    tipContent.appendChild(tipRole);

    const tip = createTooltip(tipContent);
    tip.el.id = `vylux-buildable-tooltip-${kind}`;

    btn.addEventListener('mouseenter', (e: MouseEvent) => {
      tip.show(e.clientX, e.clientY);
    });
    btn.addEventListener('mousemove', (e: MouseEvent) => {
      tip.show(e.clientX, e.clientY);
    });
    btn.addEventListener('mouseleave', () => {
      tip.hide();
    });

    panel.appendChild(btn);
    buttons.set(kind, btn);
  }

  root.appendChild(panel);
  document.body.appendChild(root);

  let _visible = false;

  function show(): void {
    root.style.display = 'block';
    _visible = true;
  }

  function hide(): void {
    root.style.display = 'none';
    _visible = false;
  }

  function updateAffordability(blueEnergy: number): void {
    for (const { kind } of BUILDABLE_DEFS) {
      const cost = UNIT_COSTS[kind];
      const btn = buttons.get(kind);
      if (btn === undefined) continue;
      const affordable = blueEnergy >= cost;
      btn.disabled = !affordable;
      btn.style.opacity = affordable ? '1' : '0.38';
      btn.style.cursor = affordable ? 'pointer' : 'not-allowed';
      btn.style.color = affordable ? BLUE_TEXT : DIM_TEXT;
      btn.style.borderColor = affordable ? BLUE_BORDER : 'rgba(0, 180, 200, 0.3)';
    }
  }

  function setArmed(kind: UnitKind | null): void {
    for (const { kind: k } of BUILDABLE_DEFS) {
      const btn = buttons.get(k);
      if (btn === undefined) continue;
      const armed = k === kind;
      btn.style.background = armed ? 'rgba(0, 224, 255, 0.15)' : 'transparent';
      btn.style.boxShadow = armed
        ? '0 0 6px rgba(0, 224, 255, 0.4) inset'
        : 'none';
    }
  }

  function showFeedback(msg: string): void {
    feedbackEl.textContent = msg;
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer);
    }
    feedbackTimer = setTimeout(() => {
      feedbackEl.textContent = '';
      feedbackTimer = null;
    }, 1500);
  }

  function isVisible(): boolean {
    return _visible;
  }

  return { show, hide, updateAffordability, setArmed, showFeedback, isVisible };
}
