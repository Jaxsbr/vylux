// DOM onboarding cue — "CLICK YOUR HQ TO BEGIN" prompt shown on match start.
// Positioned near (below-left of) the blue HQ at bottom-left of grid.
// Dismisses the first time the buildables panel opens; reappears on resetMatch.
// pointer-events: none — never eats canvas clicks.
// No imports from scene.ts, input.ts, or placement.ts.

const FONT_STACK = 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace';
const BLUE_TEXT = '#00e0ff';
const BG = 'rgba(10, 12, 16, 0.88)';
const BLUE_BORDER = '#00e0ff';
const BLUE_SHADOW = '0 0 8px rgba(0, 224, 255, 0.55), 0 0 20px rgba(0, 224, 255, 0.22)';

// ── Pure state ────────────────────────────────────────────────────────────────

export type OnboardingCueState = {
  visible: boolean;
  dismissed: boolean;
};

export const INITIAL_ONBOARDING_CUE_STATE: OnboardingCueState = {
  visible: true,
  dismissed: false,
};

/**
 * Called the first time the buildables panel opens.
 * Dismisses the cue permanently for this match.
 */
export function dismissCue(state: OnboardingCueState): OnboardingCueState {
  if (state.dismissed) return state;
  return { visible: false, dismissed: true };
}

/**
 * Called on resetMatch — cue reappears for the fresh match.
 */
export function resetCue(_state: OnboardingCueState): OnboardingCueState {
  return { visible: true, dismissed: false };
}

/**
 * Pure predicate — whether the cue should be rendered.
 */
export function shouldShowCue(state: OnboardingCueState): boolean {
  return state.visible && !state.dismissed;
}

// ── DOM element ───────────────────────────────────────────────────────────────

export type OnboardingCueHandles = {
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
};

export function createOnboardingCue(): OnboardingCueHandles {
  const el = document.createElement('div');
  el.id = 'vylux-onboarding-cue';

  Object.assign(el.style, {
    position: 'fixed',
    // Sit above the energy HUD (which is at bottom-left, ~120px from bottom).
    // The buildables panel lives at bottom:120px left:14px.
    // Place the cue a step lower — bottom:64px left:14px — so it's clearly
    // below (not over) the blue HQ mesh which sits in the lower-left canvas area.
    bottom: '64px',
    left: '14px',
    fontFamily: FONT_STACK,
    fontSize: '11px',
    letterSpacing: '0.16em',
    color: BLUE_TEXT,
    background: BG,
    border: `1px solid ${BLUE_BORDER}`,
    boxShadow: BLUE_SHADOW,
    borderRadius: '3px',
    padding: '7px 14px',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '150',
    textTransform: 'uppercase',
    animation: 'vylux-cue-pulse 2s ease-in-out infinite',
  });

  el.textContent = 'CLICK YOUR HQ TO BEGIN';

  // Inject the pulse keyframe once.
  if (!document.getElementById('vylux-cue-style')) {
    const style = document.createElement('style');
    style.id = 'vylux-cue-style';
    style.textContent = `
@keyframes vylux-cue-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}`;
    document.head.appendChild(style);
  }

  document.body.appendChild(el);

  let _visible = true;

  function show(): void {
    el.style.display = 'block';
    _visible = true;
  }

  function hide(): void {
    el.style.display = 'none';
    _visible = false;
  }

  function isVisible(): boolean {
    return _visible;
  }

  return { show, hide, isVisible };
}
