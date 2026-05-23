// Phase C.2 — tiny Tron-neon glyph set for the command HUD.
//
// Each icon is an inline SVG string drawn with `stroke: currentColor` (and
// fill: currentColor where a glyph reads better solid), so any host element
// tints it by setting CSS `color`. 24×24 viewBox; the caller passes a pixel
// size. Kept deliberately geometric + low-detail so the glyphs stay legible
// at command-card and portrait scales and match the grid aesthetic.
//
// Icon roles:
//   worker / pod / research — command-card action tiles
//   idle / move / harvest / charge / build — worker action-state readouts
//     (paired with the portrait status line)

export type HudIconName =
  | 'worker'
  | 'pod'
  | 'research'
  | 'idle'
  | 'move'
  | 'harvest'
  | 'charge'
  | 'build';

// Inner SVG per glyph. Strokes inherit `currentColor`; solid fills opt in
// explicitly with fill="currentColor" stroke="none".
const GLYPHS: Record<HudIconName, string> = {
  // Worker — a rhombus "data courier" silhouette with a lit core.
  worker:
    '<path d="M12 2.5 L21 12 L12 21.5 L3 12 Z"/>'
    + '<circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/>',
  // Work pod — a low, wide trapezoid (distinct from the taller HQ) with an
  // antenna node on top.
  pod:
    '<path d="M4 18.5 L7 9 L17 9 L20 18.5 Z"/>'
    + '<path d="M12 9 L12 5.2"/>'
    + '<circle cx="12" cy="4" r="1.4" fill="currentColor" stroke="none"/>',
  // Research — a hex node with an upgrade chevron (reads as "advance").
  research:
    '<path d="M12 2.5 L20 7 L20 17 L12 21.5 L4 17 L4 7 Z"/>'
    + '<path d="M8 14 L12 9.5 L16 14"/>',
  // Idle — a hollow ring with a lit centre (parked / waiting).
  idle:
    '<circle cx="12" cy="12" r="7.5"/>'
    + '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  // Move — a directional arrow.
  move:
    '<path d="M3 12 H17"/>'
    + '<path d="M12 6.5 L18.5 12 L12 17.5"/>',
  // Harvest — flow down into a collector (gather → deposit).
  harvest:
    '<path d="M12 3 L12 11"/>'
    + '<path d="M7.8 7.2 L12 11.4 L16.2 7.2"/>'
    + '<path d="M4.5 14 H19.5 V20 H4.5 Z"/>',
  // Charge — a lightning bolt (energy / recharge).
  charge:
    '<path d="M13 2 L5 13 H10.5 L9 22 L19 9.5 H12.5 Z" fill="currentColor" stroke="none"/>',
  // Build — the pod outline with a rising frame inside (under construction).
  build:
    '<path d="M4 18.5 L7 9 L17 9 L20 18.5 Z"/>'
    + '<path d="M9.5 18.5 V12 H14.5 V18.5"/>',
};

export function hudIconSvg(name: HudIconName, sizePx: number): string {
  return (
    `<svg width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24" fill="none" `
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + `stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`
  );
}

// Worker phase → action-state icon. Mirrors the portrait status line so the
// glyph and the label always agree. `movingTo*` / `walkingToCharge` all read
// as plain movement; `returning` reuses the move glyph (worker in transit).
export function workerPhaseIcon(phase: string): HudIconName {
  switch (phase) {
    case 'harvesting': return 'harvest';
    case 'charging': return 'charge';
    case 'building': return 'build';
    case 'movingToNode':
    case 'movingToBuildSite':
    case 'walkingToCharge':
    case 'returning': return 'move';
    default: return 'idle';
  }
}
