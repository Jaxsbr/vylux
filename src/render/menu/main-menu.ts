// Phase 3.9.7 — Main menu scene.
// Phase 3.10.8 (2026-05-07 PvE pivot cleanup) — MULTIPLAYER + OPTIONS
// buttons removed; PLAY VS AI renamed to START RUN to signal the
// single-player PvE direction. The dormant `?lockstep=host|join|observe`
// URL paths still bypass the menu and work for the dev loop, but the
// menu surface no longer advertises them.
//
// Pure DOM (no Three.js) so the same code path covers menu in any
// run mode without standing up a sim/renderer just to display the
// button. The page loads → bootstrap shows the menu → START RUN
// click triggers a callback → bootstrap continues into the existing
// scene + match flow.
//
// Faction picker is a placeholder — locked to Pulse (cyan / faction 0)
// until sub-phase 3.11 lands enemy AI faction(s).

export interface MainMenuOptions {
  onPlayVsAi(): void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;

  constructor(opts: MainMenuOptions) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'inset:0',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'background:radial-gradient(ellipse at center, #0a1119 0%, #04070a 100%)',
      'font-family:ui-monospace,Menlo,monospace',
      'color:#9ad', 'z-index:50',
      'gap:32px',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'VYLUX';
    title.style.cssText = [
      'font-size:96px', 'letter-spacing:0.4em',
      'color:#00e5ff',
      'text-shadow:0 0 24px rgba(0,229,255,0.85), 0 0 48px rgba(0,229,255,0.45)',
      'font-weight:300',
    ].join(';');
    this.root.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'TRON-INSPIRED  REAL-TIME  STRATEGY';
    subtitle.style.cssText = [
      'font-size:11px', 'letter-spacing:0.5em',
      'color:#5fa3b8', 'opacity:0.8',
      'margin-top:-16px',
    ].join(';');
    this.root.appendChild(subtitle);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = [
      'display:flex', 'flex-direction:column',
      'gap:14px', 'margin-top:24px',
    ].join(';');

    const playBtn = makeMenuButton('START  RUN', { primary: true });
    playBtn.addEventListener('click', () => opts.onPlayVsAi());
    buttonRow.appendChild(playBtn);

    this.root.appendChild(buttonRow);

    const factionRow = document.createElement('div');
    factionRow.textContent = 'FACTION · PULSE  (cyan)';
    factionRow.style.cssText = [
      'font-size:11px', 'letter-spacing:0.3em',
      'color:#00e5ff', 'opacity:0.6',
      'margin-top:24px',
    ].join(';');
    this.root.appendChild(factionRow);

    const factionNote = document.createElement('div');
    factionNote.textContent = '(enemy AI faction(s) land in sub-phase 3.11)';
    factionNote.style.cssText = [
      'font-size:10px', 'letter-spacing:0.18em',
      'color:#5fa3b8', 'opacity:0.45',
    ].join(';');
    this.root.appendChild(factionNote);

    document.body.appendChild(this.root);
  }

  hide(): void {
    this.root.remove();
  }
}

function makeMenuButton(label: string, opts: { primary: boolean; disabled?: boolean }): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  const color = opts.primary ? '#00e5ff' : '#5fa3b8';
  const glow = opts.primary
    ? '0 0 12px rgba(0,229,255,0.55)'
    : '0 0 4px rgba(95,163,184,0.35)';
  btn.style.cssText = [
    'background:transparent',
    `border:1px solid ${color}`,
    `color:${color}`,
    'padding:14px 56px',
    'font-family:ui-monospace,Menlo,monospace',
    'font-size:14px', 'letter-spacing:0.42em',
    'cursor:' + (opts.disabled ? 'not-allowed' : 'pointer'),
    'transition:background 0.2s, box-shadow 0.2s',
    `box-shadow:${glow}`,
    'opacity:' + (opts.disabled ? '0.35' : '1'),
  ].join(';');
  if (opts.disabled) {
    btn.disabled = true;
  } else {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = opts.primary
        ? 'rgba(0,229,255,0.12)'
        : 'rgba(95,163,184,0.08)';
      btn.style.boxShadow = opts.primary
        ? '0 0 24px rgba(0,229,255,0.85)'
        : '0 0 12px rgba(95,163,184,0.6)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.boxShadow = glow;
    });
  }
  return btn;
}
