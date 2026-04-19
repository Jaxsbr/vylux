// Energy-node hover tooltip — DOM overlay, no Three.js.
// Shows when the player hovers a tile that hosts an energy node.
// Chrome matches hud.ts / buildables-panel.ts: mono font, cyan outline, dark panel.
// No imports from scene.ts, input.ts, or placement.ts.

import { NODE_INCOME } from './economy';
import { createTooltip, type TooltipEl } from './tooltip';

const FONT_STACK = 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace';
const BLUE_TEXT = '#00e0ff';

function buildNodeTooltipContent(): HTMLElement {
  const wrap = document.createElement('div');

  const titleEl = document.createElement('div');
  titleEl.textContent = 'ENERGY NODE';
  Object.assign(titleEl.style, {
    color: BLUE_TEXT,
    fontSize: '11px',
    letterSpacing: '0.14em',
    fontFamily: FONT_STACK,
    marginBottom: '4px',
    fontWeight: 'bold',
  });

  const descEl = document.createElement('div');
  descEl.id = 'vylux-node-tooltip-desc';
  descEl.textContent = `Park a worker here to boost income (+${NODE_INCOME}/s).`;
  Object.assign(descEl.style, {
    color: 'rgba(180, 220, 230, 0.85)',
    fontSize: '10px',
    fontFamily: FONT_STACK,
    lineHeight: '1.4',
  });

  wrap.appendChild(titleEl);
  wrap.appendChild(descEl);
  return wrap;
}

export type NodeTooltipHandle = {
  tooltip: TooltipEl;
  show: (x: number, y: number) => void;
  hide: () => void;
  isVisible: () => boolean;
};

export function createNodeTooltip(): NodeTooltipHandle {
  const content = buildNodeTooltipContent();
  const tooltip = createTooltip(content);
  tooltip.el.id = 'vylux-node-tooltip';

  return {
    tooltip,
    show: (x: number, y: number) => tooltip.show(x, y),
    hide: () => tooltip.hide(),
    isVisible: () => tooltip.isVisible(),
  };
}
