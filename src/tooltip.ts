// Shared tooltip chrome — matches hud.ts / buildables-panel.ts visual language.
// Mono font, cyan outline, dark background, pointer-events: none on the tip itself.
// No imports from scene.ts, input.ts, or placement.ts.

const FONT_STACK = 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace';
const BG = 'rgba(10, 12, 16, 0.92)';
const BORDER = '#00e0ff';
const SHADOW = '0 0 8px rgba(0, 224, 255, 0.4), 0 0 18px rgba(0, 224, 255, 0.15)';

export type TooltipEl = {
  el: HTMLDivElement;
  show: (x: number, y: number) => void;
  hide: () => void;
  isVisible: () => boolean;
};

/**
 * Pure: clamp a tooltip rect so it stays inside the viewport.
 * Returns the adjusted {left, top} for the tooltip's top-left corner.
 *
 * @param anchorX  - preferred left edge (e.g. cursor X + offset)
 * @param anchorY  - preferred top edge  (e.g. cursor Y + offset)
 * @param tipW     - tooltip width in px
 * @param tipH     - tooltip height in px
 * @param vpW      - viewport width in px
 * @param vpH      - viewport height in px
 * @param margin   - minimum distance from each viewport edge (default 8)
 */
export function clampTooltipPosition(
  anchorX: number,
  anchorY: number,
  tipW: number,
  tipH: number,
  vpW: number,
  vpH: number,
  margin = 8,
): { left: number; top: number } {
  let left = anchorX;
  let top = anchorY;

  // Flip right-to-left if it would clip the right edge.
  if (left + tipW + margin > vpW) {
    left = anchorX - tipW;
  }
  // Hard clamp left edge.
  if (left < margin) {
    left = margin;
  }

  // Flip bottom-to-top if it would clip the bottom edge.
  if (top + tipH + margin > vpH) {
    top = anchorY - tipH;
  }
  // Hard clamp top edge.
  if (top < margin) {
    top = margin;
  }

  return { left, top };
}

/**
 * Create a DOM tooltip element and append it to document.body.
 * The tooltip renders above all HUD chrome (z-index 400).
 * pointer-events: none — does not intercept clicks.
 */
export function createTooltip(content: HTMLElement | string): TooltipEl {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '400',
    fontFamily: FONT_STACK,
    background: BG,
    border: `1px solid ${BORDER}`,
    boxShadow: SHADOW,
    borderRadius: '4px',
    padding: '7px 10px',
    pointerEvents: 'none',
    userSelect: 'none',
    display: 'none',
    maxWidth: '220px',
    whiteSpace: 'normal',
    lineHeight: '1.4',
  });

  if (typeof content === 'string') {
    el.textContent = content;
  } else {
    el.appendChild(content);
  }

  document.body.appendChild(el);

  let _visible = false;

  function show(x: number, y: number): void {
    // Position first (display:block so offsetWidth/Height are real).
    el.style.display = 'block';
    _visible = true;

    const tipW = el.offsetWidth;
    const tipH = el.offsetHeight;
    const OFFSET = 14;
    const { left, top } = clampTooltipPosition(
      x + OFFSET,
      y + OFFSET,
      tipW,
      tipH,
      window.innerWidth,
      window.innerHeight,
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function hide(): void {
    el.style.display = 'none';
    _visible = false;
  }

  function isVisible(): boolean {
    return _visible;
  }

  return { el, show, hide, isVisible };
}
