// Phase 3.11a — Main menu with faction selector.
// Phase 3.11b (2026-05-08 rename) — `'pulse' | 'forge'` faction ids
// retired in favour of `'swarm' | 'siege'` so the identifiers match
// the display names. The Forge production-structure kind in the sim
// is unrelated and untouched.
//
// Dual-tile faction picker: SWARM on the left, SIEGE on the right.
// The selected tile dominates (scale, glow, particles, voice line,
// START RUN button); the unselected tile dims. Hotkeys A/D + ←/→
// toggle; click selects; Space / Enter / clicking START RUN commits.
//
// Switching plays the dramatic transition from the design handover —
// a left→right colour-wash sweep with screen-blend tint, plus a
// particle burst and an audio cue. Per the handover timeline:
//   0ms     TRIGGER     key down + low thump
//   120ms   WASH PEAK   white bar crosses centre
//   350ms   BURST       40-particle spawn
//   600ms   SETTLE      new faction idle
//
// Pure DOM (no Three.js) — same posture as the prior placeholder. The
// page boots → bootstrap awaits the menu → onCommit fires with the
// chosen FactionId → bootstrap proceeds into the existing scene flow
// with playerFaction wired from the pick. localStorage persists the
// last pick across visits; default Swarm on first visit.
//
// `?menu=skip` URL flag still bypasses the menu for e2e tests + any
// future deep-link path; the persisted pick is used in that case.

import type { AudioManager } from '../../audio/audio-manager';
import { loadFactionId, saveFactionId } from '../factions/persistence';
import {
  FACTION_THEMES,
  themeForId,
  VY_BG,
  VY_INK,
  type FactionId,
  type FactionTheme,
} from '../factions/theme';

export interface MainMenuOptions {
  audio: AudioManager;
  onCommit(picked: FactionId): void;
}

interface TileRefs {
  root: HTMLDivElement;
  emblemHolder: HTMLDivElement;
  title: HTMLDivElement;
  underline: HTMLDivElement;
  voice: HTMLDivElement;
  startBtn: HTMLButtonElement;
  particles: HTMLDivElement;
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly tiles: Record<FactionId, TileRefs>;
  private readonly bgRadial: HTMLDivElement;
  // Two parallax layers — far drifts a little, near drifts more, giving
  // depth as the cursor moves across the screen.
  private readonly ambientFar: HTMLDivElement;
  private readonly ambientNear: HTMLDivElement;
  private readonly wordmark: HTMLDivElement;
  private readonly footer: HTMLDivElement;
  private readonly washLayer: HTMLDivElement;
  private washGradient!: HTMLDivElement;
  private washBar!: HTMLDivElement;
  // Custom faction-tinted cursor + trail. Native cursor is hidden inside
  // the menu surface only — restored when the menu is removed.
  private readonly cursorLayer: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private readonly cursorRing: HTMLDivElement;
  private readonly cursorDot: HTMLDivElement;
  private readonly trailLayer: HTMLDivElement;
  private readonly pointerHandler: (ev: PointerEvent) => void;
  private lastTrailX = -1000;
  private lastTrailY = -1000;
  private readonly opts: MainMenuOptions;
  private readonly keyHandler: (ev: KeyboardEvent) => void;
  private selected: FactionId;
  private animating = false;
  private committed = false;

  constructor(opts: MainMenuOptions) {
    this.opts = opts;
    this.selected = loadFactionId();

    ensureTwinkleKeyframes();

    this.root = document.createElement('div');
    this.root.className = 'vy-menu';
    this.root.style.cssText = [
      'position:fixed', 'inset:0',
      `background:${VY_BG}`,
      'overflow:hidden',
      `font-family:ui-monospace,Menlo,monospace`, `color:${VY_INK}`,
      'z-index:50',
    ].join(';');

    // Radial backdrop tinted to the selected faction. Updated on switch.
    this.bgRadial = document.createElement('div');
    this.bgRadial.style.cssText = 'position:absolute;inset:0;pointer-events:none;transition:background 380ms ease';
    this.root.appendChild(this.bgRadial);

    // Ambient particle layers — split into far + near for parallax depth
    // on pointer movement. Far drifts a little, near drifts more, both
    // tinted to the selected faction. Transitioned (not RAF-driven) so
    // movement reads smooth without per-frame work.
    this.ambientFar = document.createElement('div');
    this.ambientFar.style.cssText = [
      'position:absolute', 'inset:-30px', 'pointer-events:none',
      'will-change:transform', 'transition:transform 320ms ease-out',
    ].join(';');
    this.root.appendChild(this.ambientFar);

    this.ambientNear = document.createElement('div');
    this.ambientNear.style.cssText = [
      'position:absolute', 'inset:-50px', 'pointer-events:none',
      'will-change:transform', 'transition:transform 220ms ease-out',
    ].join(';');
    this.root.appendChild(this.ambientNear);

    appendCornerChrome(this.root, themeForId(this.selected));

    // Build label (top-right).
    const buildLabel = document.createElement('div');
    buildLabel.textContent = 'BUILD 3.11.0  ·  PVAI';
    buildLabel.style.cssText = [
      'position:absolute', 'right:22px', 'top:16px',
      'font-size:10px', 'letter-spacing:0.3em',
      'color:rgba(180,200,210,0.4)', 'pointer-events:none',
    ].join(';');
    this.root.appendChild(buildLabel);

    // Wordmark + subtitle.
    this.wordmark = document.createElement('div');
    this.wordmark.style.cssText = 'position:absolute;left:0;right:0;top:78px;text-align:center;pointer-events:none';
    const word = document.createElement('div');
    word.textContent = 'VYLUX';
    word.className = 'vy-word';
    word.style.cssText = 'font-size:96px;font-family:inherit;transition:color 320ms ease, text-shadow 320ms ease, font-weight 320ms ease, letter-spacing 320ms ease';
    const sub = document.createElement('div');
    sub.textContent = 'TRON-INSPIRED  REAL-TIME  STRATEGY';
    sub.className = 'vy-sub';
    sub.style.cssText = 'font-size:11px;letter-spacing:0.5em;margin-top:-6px;opacity:0.55;transition:color 320ms ease';
    this.wordmark.appendChild(word);
    this.wordmark.appendChild(sub);
    this.root.appendChild(this.wordmark);

    // Faction selector — two tiles centred + spaced.
    const selectorRow = document.createElement('div');
    selectorRow.style.cssText = [
      'position:absolute', 'left:80px', 'right:80px', 'top:218px',
      'display:flex', 'gap:32px', 'align-items:stretch', 'height:500px',
    ].join(';');
    this.root.appendChild(selectorRow);
    this.tiles = {
      swarm: this.buildTile('swarm', 'left'),
      siege: this.buildTile('siege', 'right'),
    };
    selectorRow.appendChild(this.tiles.swarm.root);
    selectorRow.appendChild(this.tiles.siege.root);

    // Footer hint.
    this.footer = document.createElement('div');
    this.footer.style.cssText = [
      'position:absolute', 'left:0', 'right:0', 'bottom:30px',
      'text-align:center',
      'font-size:10px', 'letter-spacing:0.4em',
      'color:rgba(180,200,210,0.35)', 'pointer-events:none',
    ].join(';');
    this.root.appendChild(this.footer);

    // Wash overlay — only visible during a transition. The handover's
    // wash is a vertical 6px white neon bar that *translates* across
    // the screen (not a static gradient that fades): direction depends
    // on which faction is being picked. Behind the bar a soft horizontal
    // gradient blends the leaving + arriving faction glow.
    //   switching to FORGE (right tile) → bar sweeps L → R
    //   switching to PULSE (left  tile) → bar sweeps R → L
    this.washLayer = document.createElement('div');
    this.washLayer.style.cssText = [
      'position:absolute', 'inset:0', 'pointer-events:none', 'overflow:hidden',
    ].join(';');
    this.washGradient = document.createElement('div');
    this.washGradient.style.cssText = [
      'position:absolute', 'inset:0',
      'opacity:0', 'mix-blend-mode:screen',
      'transition:opacity 600ms ease',
    ].join(';');
    this.washBar = document.createElement('div');
    this.washBar.style.cssText = [
      'position:absolute', 'top:0', 'bottom:0', 'width:6px',
      'background:#ffffff',
      'left:-12px',
      'opacity:0',
    ].join(';');
    this.washLayer.appendChild(this.washGradient);
    this.washLayer.appendChild(this.washBar);
    this.root.appendChild(this.washLayer);

    // Native cursor is hidden only inside the menu surface; the rest of
    // the page (debug HUD, browser chrome) keeps the system cursor.
    this.root.style.cursor = 'none';

    // Cursor + trail layer sits above everything else inside the menu,
    // including the wash overlay, so it stays visible during transitions.
    this.cursorLayer = document.createElement('div');
    this.cursorLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:60';
    this.root.appendChild(this.cursorLayer);

    this.trailLayer = document.createElement('div');
    this.trailLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    this.cursorLayer.appendChild(this.trailLayer);

    // Cursor: ring + centre dot, both inheriting `currentColor` so a
    // single colour update on the wrapper retints both. Swarm ring is
    // rotated 45° (matches the diamond emblem); Siege stays square.
    this.cursor = document.createElement('div');
    this.cursor.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'width:24px', 'height:24px',
      'transform:translate3d(-100px,-100px,0)',
      'will-change:transform', 'pointer-events:none',
    ].join(';');
    this.cursorLayer.appendChild(this.cursor);

    this.cursorRing = document.createElement('div');
    this.cursorRing.style.cssText = [
      'position:absolute', 'inset:0',
      'border:1.5px solid currentColor',
      'transition:transform 220ms ease, box-shadow 220ms ease',
    ].join(';');
    this.cursor.appendChild(this.cursorRing);

    this.cursorDot = document.createElement('div');
    this.cursorDot.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%',
      'width:4px', 'height:4px',
      'transform:translate(-50%,-50%)',
      'background:currentColor',
    ].join(';');
    this.cursor.appendChild(this.cursorDot);

    document.body.appendChild(this.root);

    this.keyHandler = (ev) => this.onKey(ev);
    window.addEventListener('keydown', this.keyHandler);

    this.pointerHandler = (ev) => this.onPointerMove(ev);
    window.addEventListener('pointermove', this.pointerHandler);

    this.applyTheme(this.selected);
  }

  hide(): void {
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('pointermove', this.pointerHandler);
    this.root.remove();
  }

  // --- tile construction --------------------------------------------------

  private buildTile(id: FactionId, side: 'left' | 'right'): TileRefs {
    const root = document.createElement('div');
    root.style.cssText = [
      'flex:1', 'position:relative',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:flex-start', 'gap:14px',
      'padding:28px 22px 30px',
      'transform-origin:top center',
      'cursor:pointer',
      'transition:transform 250ms ease, opacity 250ms ease, border-color 250ms ease, box-shadow 250ms ease, background 250ms ease',
    ].join(';');
    root.addEventListener('click', () => {
      if (this.animating || this.committed) return;
      if (this.selected === id) {
        this.commit();
      } else {
        this.switchTo(id);
      }
    });

    const particles = document.createElement('div');
    particles.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    root.appendChild(particles);

    const sideLabel = document.createElement('div');
    sideLabel.textContent = side === 'left' ? '◂  KEY [A]' : 'KEY [D]  ▸';
    sideLabel.style.cssText = 'font-size:11px;letter-spacing:0.5em;opacity:0.7';
    root.appendChild(sideLabel);

    const emblemHolder = document.createElement('div');
    emblemHolder.style.cssText = 'height:110px;display:flex;align-items:center;justify-content:center';
    root.appendChild(emblemHolder);

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:6px';
    const title = document.createElement('div');
    title.textContent = themeForId(id).name;
    title.style.cssText = 'transition:font-size 250ms ease, color 250ms ease, text-shadow 250ms ease';
    const underline = document.createElement('div');
    underline.style.cssText = 'height:2px;transition:opacity 250ms ease, background 250ms ease, box-shadow 250ms ease, width 250ms ease';
    titleWrap.appendChild(title);
    titleWrap.appendChild(underline);
    root.appendChild(titleWrap);

    const stats = document.createElement('div');
    stats.style.cssText = 'display:flex;gap:18px;font-size:10px;letter-spacing:0.3em;opacity:0.6';
    appendStat(stats, 'MASS',  id === 'swarm' ? 1 : 5);
    appendStat(stats, 'SPEED', id === 'swarm' ? 5 : 1);
    appendStat(stats, 'COUNT', id === 'swarm' ? 5 : 2);
    root.appendChild(stats);

    const voice = document.createElement('div');
    voice.style.cssText = 'font-size:13px;text-align:center;margin-top:4px;opacity:0;transition:opacity 250ms ease, color 250ms ease, text-shadow 250ms ease';
    voice.textContent = id === 'swarm'
      ? '“WE ARE MANY · FLOW FORWARD”'
      : '“STRENGTH HOLDS · WE DO NOT MOVE”';
    root.appendChild(voice);

    const startBtn = document.createElement('button');
    startBtn.textContent = 'START  RUN';
    startBtn.style.cssText = [
      'margin-top:auto',
      'background:transparent',
      'padding:14px 56px',
      'font-family:inherit',
      'font-size:15px',
      'cursor:pointer',
      'opacity:0', 'pointer-events:none',
      'transition:opacity 250ms ease, color 250ms ease, border-color 250ms ease, box-shadow 250ms ease',
    ].join(';');
    startBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this.animating || this.committed) return;
      this.commit();
    });
    root.appendChild(startBtn);

    appendEmblem(emblemHolder, id, /*selected=*/ id === this.selected);

    return { root, emblemHolder, title, underline, voice, startBtn, particles };
  }

  // --- theme application --------------------------------------------------

  private applyTheme(id: FactionId): void {
    const f = themeForId(id);
    const enemy = themeForId(opposing(id));

    // Backdrop.
    this.bgRadial.style.background = `radial-gradient(ellipse at center, ${f.deep} 0%, ${VY_BG} 70%)`;

    // Wordmark colour + weight + tracking.
    const word = this.wordmark.querySelector<HTMLDivElement>('.vy-word');
    if (word) {
      word.style.color = f.primary;
      word.style.fontWeight = String(f.titleWeight);
      word.style.letterSpacing = f.titleTrack;
      word.style.textShadow = `0 0 24px ${f.glow}, 0 0 60px ${f.glowSoft}`;
    }
    const sub = this.wordmark.querySelector<HTMLDivElement>('.vy-sub');
    if (sub) sub.style.color = f.bright;

    // Footer copy.
    this.footer.textContent =
      `ENEMY  AI  =  ${enemy.name}  ·  [SPACE] START  ·  [A/D] SWITCH FACTION`;

    // Corner chrome — re-paint inline by querying the existing nodes.
    this.root.querySelectorAll<HTMLDivElement>('.vy-corner').forEach((node) => {
      node.style.background = f.primary;
      node.style.boxShadow = `0 0 6px ${f.primary}`;
    });

    // Tiles — selected vs unselected styling.
    (Object.keys(this.tiles) as FactionId[]).forEach((tid) => {
      this.styleTile(tid, /*selected=*/ tid === id);
    });

    // Ambient particles re-tint to new faction (both parallax layers).
    this.populateAmbientParticles(f);

    // Cursor re-tint. Swarm rotates the ring 45° (matches the diamond
    // emblem); Siege keeps it square.
    this.cursor.style.color = f.primary;
    this.cursorRing.style.boxShadow = `0 0 10px ${f.primary}, inset 0 0 6px ${f.glowSoft}`;
    this.cursorRing.style.transform = id === 'swarm' ? 'rotate(45deg)' : 'rotate(0deg)';
  }

  // Vertical white neon bar sweeps from one edge of the screen to the
  // other; direction = which faction is being picked. A soft horizontal
  // gradient underneath blends the leaving + arriving faction glow.
  // Per the handover timeline: bar centred at ~120ms, settle by 600ms.
  private triggerWash(toId: FactionId): void {
    const arriving = themeForId(toId);
    const leaving = themeForId(opposing(toId));
    const sweepRight = toId === 'siege'; // right tile is Siege — bar moves L → R
    const startLeft = sweepRight ? '-12px' : 'calc(100% + 12px)';
    const endLeft   = sweepRight ? 'calc(100% + 12px)' : '-12px';

    // Soft glow gradient — directional: leaving colour fades behind the
    // bar's leading edge, arriving colour leads.
    const gradient = sweepRight
      ? `linear-gradient(90deg, transparent 0%, ${leaving.glowSoft} 30%, ${arriving.glowSoft} 70%, transparent 100%)`
      : `linear-gradient(90deg, transparent 0%, ${arriving.glowSoft} 30%, ${leaving.glowSoft} 70%, transparent 100%)`;
    this.washGradient.style.background = gradient;

    // Bar carries the arriving faction's glow on its leading edge and
    // the leaving faction's glow trailing — a wedge of light passing
    // through.
    const leadGlow = arriving.glowHard;
    const trailGlow = leaving.glowHard;
    this.washBar.style.boxShadow = sweepRight
      ? `40px 0 60px 18px ${leadGlow}, -40px 0 60px 18px ${trailGlow}`
      : `-40px 0 60px 18px ${leadGlow}, 40px 0 60px 18px ${trailGlow}`;

    // Reset to start state with no transition so the next paint puts
    // the bar at the starting edge instantly. Then on the next frame
    // attach transitions and animate to end state.
    this.washBar.style.transition = 'none';
    this.washBar.style.left = startLeft;
    this.washBar.style.opacity = '1';
    this.washGradient.style.opacity = '0';

    // Force a layout flush before applying the transition so the
    // browser commits the start state before measuring the end.
    void this.washBar.offsetWidth;

    requestAnimationFrame(() => {
      this.washBar.style.transition = 'left 360ms cubic-bezier(0.25, 0.7, 0.4, 1), opacity 200ms ease 280ms';
      this.washBar.style.left = endLeft;
      this.washBar.style.opacity = '0';
      this.washGradient.style.opacity = '1';
      // Settle the gradient back down toward the end of the wash.
      window.setTimeout(() => { this.washGradient.style.opacity = '0'; }, 380);
    });
  }

  private styleTile(id: FactionId, selected: boolean): void {
    const t = this.tiles[id];
    const f = themeForId(id);
    const fadeColor = selected ? f.primary : 'rgba(160,180,190,0.45)';
    t.root.style.transform = `scale(${selected ? 1.0 : 0.78})`;
    t.root.style.opacity = selected ? '1' : '0.42';
    t.root.style.border = `${selected ? f.strokeW : 1}px solid ${fadeColor}`;
    t.root.style.borderRadius = `${f.radius}px`;
    t.root.style.background = selected
      ? `linear-gradient(180deg, ${f.deep}40 0%, transparent 70%)`
      : 'transparent';
    t.root.style.boxShadow = selected
      ? `0 0 32px ${f.glow}, inset 0 0 18px ${f.glowSoft}`
      : 'none';

    // Side label
    const sideLabel = t.root.firstElementChild as HTMLElement | null;
    // (the first child that's not particles is the side label; recompute via class fallback)
    t.root.querySelectorAll<HTMLDivElement>('div').forEach((d) => {
      // No-op — we use direct refs below.
      void d;
    });
    void sideLabel;

    // Title — near-white ink when selected (keeps glyphs legible against
    // same-hue particle wash); faded grey when unselected. Faction colour
    // comes through glow + underline rather than the glyphs themselves.
    t.title.style.fontSize = `${selected ? 56 : 42}px`;
    t.title.style.letterSpacing = f.titleTrack;
    t.title.style.fontWeight = String(f.titleWeight);
    t.title.style.color = selected ? '#f4fbff' : 'rgba(220,235,240,0.55)';
    t.title.style.textShadow = selected
      ? `0 0 18px ${f.glowHard}, 0 0 42px ${f.glow}, 0 1px 0 rgba(0,0,0,0.6)`
      : 'none';

    t.underline.style.width = selected ? `${id === 'swarm' ? 110 : 90}px` : '0';
    t.underline.style.opacity = selected ? '1' : '0';
    t.underline.style.background = f.primary;
    t.underline.style.boxShadow = `0 0 10px ${f.glowHard}`;

    t.voice.style.color = f.primary;
    t.voice.style.opacity = selected ? '0.95' : '0';
    t.voice.style.letterSpacing = f.bodyTrack;
    t.voice.style.fontWeight = String(f.cardWeight);
    t.voice.style.textShadow = `0 0 12px ${f.glow}`;

    t.startBtn.style.opacity = selected ? '1' : '0';
    t.startBtn.style.pointerEvents = selected ? 'auto' : 'none';
    t.startBtn.style.color = f.primary;
    t.startBtn.style.border = `${f.strokeW}px solid ${f.primary}`;
    t.startBtn.style.borderRadius = `${f.radius}px`;
    t.startBtn.style.letterSpacing = f.titleTrack;
    t.startBtn.style.fontWeight = String(f.titleWeight === 200 ? 300 : 700);
    t.startBtn.style.boxShadow = `0 0 20px ${f.glow}, inset 0 0 10px ${f.glowSoft}`;

    // Re-render emblem with selection highlight.
    t.emblemHolder.innerHTML = '';
    appendEmblem(t.emblemHolder, id, selected);

    // Selected tile gets dense particle layer. These twinkle so they
    // don't read as static against the parallaxing ambient layers.
    t.particles.innerHTML = '';
    if (selected) {
      populateParticles(
        t.particles, f,
        id === 'swarm' ? 40 : 14,
        /*sizeScale=*/1, /*opacityScale=*/1, /*seedOffset=*/id === 'swarm' ? 113 : 211,
        /*twinkle=*/true,
      );
    }
  }

  // --- ambient + transition particles -------------------------------------

  private populateAmbientParticles(f: FactionTheme): void {
    this.ambientFar.innerHTML = '';
    this.ambientNear.innerHTML = '';
    // Far: more dots, smaller, dimmer — sits in the back of the parallax stack.
    populateParticles(this.ambientFar,  f, 60, 0.75, 0.55, /*seedOffset=*/0);
    // Near: fewer dots, larger, brighter — leads the parallax.
    populateParticles(this.ambientNear, f, 26, 1.55, 1.05, /*seedOffset=*/47);
  }

  private spawnBurst(f: FactionTheme): void {
    const burst = document.createElement('div');
    burst.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:1;transition:opacity 700ms ease';
    populateParticles(burst, f, 40);
    this.root.appendChild(burst);
    // Schedule fade + cleanup.
    window.setTimeout(() => { burst.style.opacity = '0'; }, 30);
    window.setTimeout(() => { burst.remove(); }, 760);
  }

  // --- input + transition -------------------------------------------------

  // Pointer-driven parallax + custom-cursor + trail bits. Layered so:
  //   - far/near ambient dots translate against the cursor for depth;
  //   - the faction-tinted cursor element follows the pointer 1:1;
  //   - every ~14px of travel emits a faction-coloured bit that drifts
  //     and fades over ~700ms.
  private onPointerMove(ev: PointerEvent): void {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const fx = (ev.clientX / w) - 0.5;
    const fy = (ev.clientY / h) - 0.5;
    // Translate against the cursor — pointer moves right → particles
    // drift left, sells the parallax illusion.
    this.ambientFar.style.transform =
      `translate3d(${(-fx * 14).toFixed(2)}px, ${(-fy * 10).toFixed(2)}px, 0)`;
    this.ambientNear.style.transform =
      `translate3d(${(-fx * 36).toFixed(2)}px, ${(-fy * 24).toFixed(2)}px, 0)`;

    // Cursor follows pointer with no transition — needs to track 1:1.
    this.cursor.style.transform = `translate3d(${ev.clientX - 12}px, ${ev.clientY - 12}px, 0)`;

    // Trail emission gated on travel distance so a slow cursor doesn't
    // spew bits while a fast cursor still leaves a continuous trail.
    const dx = ev.clientX - this.lastTrailX;
    const dy = ev.clientY - this.lastTrailY;
    if (dx * dx + dy * dy >= 14 * 14) {
      this.lastTrailX = ev.clientX;
      this.lastTrailY = ev.clientY;
      this.spawnTrailBit(ev.clientX, ev.clientY);
    }
  }

  private spawnTrailBit(x: number, y: number): void {
    const f = themeForId(this.selected);
    const bit = document.createElement('div');
    const size = 3 + Math.floor(Math.random() * 3); // 3..5px
    const driftX = (Math.random() - 0.5) * 14;
    const driftY = 4 + Math.random() * 12;
    const rot = this.selected === 'swarm' ? 45 : 0;
    bit.style.cssText = [
      'position:absolute',
      `left:${x}px`, `top:${y}px`,
      `width:${size}px`, `height:${size}px`,
      `background:${f.primary}`,
      `box-shadow:0 0 6px ${f.primary}`,
      `transform:translate(-50%,-50%) rotate(${rot}deg) scale(1)`,
      'opacity:0.85', 'pointer-events:none',
      'transition:opacity 700ms ease, transform 700ms ease',
    ].join(';');
    this.trailLayer.appendChild(bit);
    requestAnimationFrame(() => {
      bit.style.opacity = '0';
      bit.style.transform =
        `translate(calc(-50% + ${driftX.toFixed(1)}px), calc(-50% + ${driftY.toFixed(1)}px)) rotate(${rot}deg) scale(0.4)`;
    });
    window.setTimeout(() => bit.remove(), 740);
  }

  private onKey(ev: KeyboardEvent): void {
    if (this.committed) return;
    if (this.animating) return;
    const k = ev.key;
    if (k === 'a' || k === 'A' || k === 'ArrowLeft') {
      ev.preventDefault();
      if (this.selected !== 'swarm') this.switchTo('swarm');
    } else if (k === 'd' || k === 'D' || k === 'ArrowRight') {
      ev.preventDefault();
      if (this.selected !== 'siege') this.switchTo('siege');
    } else if (k === ' ' || k === 'Enter') {
      ev.preventDefault();
      this.commit();
    }
  }

  private switchTo(id: FactionId): void {
    if (this.selected === id) return;
    this.animating = true;
    this.selected = id;
    saveFactionId(id);
    this.opts.audio.factionSwitch(id);
    this.triggerWash(id);
    this.applyTheme(id);
    // Burst at BURST timing (handover: 350ms spawn).
    window.setTimeout(() => { this.spawnBurst(themeForId(id)); }, 350);
    // Settle gate — release the animating lock so rapid A/D toggling is bounded
    // but doesn't deadlock if the player hammers keys.
    window.setTimeout(() => { this.animating = false; }, 420);
  }

  private commit(): void {
    if (this.committed) return;
    this.committed = true;
    saveFactionId(this.selected);
    this.opts.audio.click();
    this.opts.onCommit(this.selected);
  }
}

// --- helpers ---------------------------------------------------------------

function opposing(id: FactionId): FactionId {
  return id === 'swarm' ? 'siege' : 'swarm';
}

function appendCornerChrome(root: HTMLElement, _f: FactionTheme): void {
  const arm = 28;
  const t = 1;
  const slots: { l?: number; r?: number; t?: number; b?: number; w: number; h: number }[] = [
    { l: 18, t: 18, w: t, h: arm }, { l: 18, t: 18, w: arm, h: t },
    { r: 18, t: 18, w: t, h: arm }, { r: 18, t: 18, w: arm, h: t },
    { l: 18, b: 18, w: t, h: arm }, { l: 18, b: 18, w: arm, h: t },
    { r: 18, b: 18, w: t, h: arm }, { r: 18, b: 18, w: arm, h: t },
  ];
  for (const s of slots) {
    const div = document.createElement('div');
    div.className = 'vy-corner';
    div.style.cssText = [
      'position:absolute',
      `width:${s.w}px`, `height:${s.h}px`,
      s.l !== undefined ? `left:${s.l}px` : `right:${s.r}px`,
      s.t !== undefined ? `top:${s.t}px`  : `bottom:${s.b}px`,
      'opacity:0.7',
      'pointer-events:none',
      'transition:background 250ms ease, box-shadow 250ms ease',
    ].join(';');
    root.appendChild(div);
  }
}

function appendStat(parent: HTMLElement, label: string, bars: number): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px';
  const lbl = document.createElement('div');
  lbl.textContent = label;
  wrap.appendChild(lbl);
  const barsRow = document.createElement('div');
  barsRow.style.cssText = 'display:flex;gap:2px';
  for (let i = 1; i <= 5; i++) {
    const cell = document.createElement('div');
    cell.style.cssText = [
      'width:8px', 'height:3px',
      `background:${i <= bars ? 'currentColor' : 'transparent'}`,
      'border:1px solid currentColor',
      `opacity:${i <= bars ? '1' : '0.45'}`,
    ].join(';');
    barsRow.appendChild(cell);
  }
  wrap.appendChild(barsRow);
  parent.appendChild(wrap);
}

function appendEmblem(parent: HTMLElement, id: FactionId, selected: boolean): void {
  const f = FACTION_THEMES[id];
  const color = selected ? f.primary : 'rgba(160,180,190,0.45)';
  const grid = document.createElement('div');
  grid.style.cssText = `width:110px;height:110px;position:relative;${
    id === 'swarm' ? 'transform:rotateZ(45deg);' : ''
  }`;
  // 5×5 grid; live-cell pattern matches the handover (Pulse = dispersed
  // diamonds in a swarm cluster; Forge = stronghold with crenellations).
  const live = id === 'swarm'
    ? new Set([2, 5, 6, 7, 10, 12, 14, 17, 18, 19, 22])
    : new Set([0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  const cell = 14;
  const step = 22;
  for (let i = 0; i < 25; i++) {
    const r = Math.floor(i / 5);
    const c = i % 5;
    const on = live.has(i);
    const node = document.createElement('div');
    node.style.cssText = [
      'position:absolute',
      `left:${c * step}px`, `top:${r * step}px`,
      `width:${cell}px`, `height:${cell}px`,
      `background:${on ? color : 'transparent'}`,
      `border:1px solid ${color}`,
      `opacity:${on ? (selected ? (id === 'swarm' ? 1 : 0.95) : 0.7) : (id === 'swarm' ? 0.25 : 0.22)}`,
      on && selected ? `box-shadow:0 0 ${id === 'swarm' ? 8 : 6}px ${color}` : '',
    ].filter(Boolean).join(';');
    grid.appendChild(node);
  }
  parent.appendChild(grid);
}

// Deterministic-ish particle scatter — same seed mix as the handover so
// the visual reads identically. Not seeded against `sim.rng`; this is
// pure presentation, no determinism contract.
//
// `sizeScale` and `opacityScale` let the parallax far + near layers
// share the helper while reading visually distinct (far = smaller +
// dimmer, near = larger + brighter). `seedOffset` shifts the seed mix
// so the two layers don't colocate dots in the same pixels.
function populateParticles(
  parent: HTMLElement,
  f: FactionTheme,
  count: number,
  sizeScale = 1,
  opacityScale = 1,
  seedOffset = 0,
  twinkle = false,
): void {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const j = i + seedOffset;
    const seed1 = Math.sin(j * 9301 + 49297) * 0.5 + 0.5;
    const seed2 = Math.sin(j * 4127 + 13) * 0.5 + 0.5;
    const seed3 = Math.sin(j * 7919 + 91) * 0.5 + 0.5;
    const seed4 = Math.sin(j * 3253 + 271) * 0.5 + 0.5;
    const size = Math.max(1, Math.round((1 + seed3 * 3) * sizeScale));
    const opacity = Math.min(1, (0.25 + seed3 * 0.65) * opacityScale);
    const dot = document.createElement('div');
    const baseStyle = [
      'position:absolute',
      `left:${(seed1 * 100).toFixed(2)}%`,
      `top:${(seed2 * 100).toFixed(2)}%`,
      `width:${size}px`, `height:${size}px`,
      `background:${f.primary}`,
      `box-shadow:0 0 ${4 + size * 2}px ${f.primary}`,
      `opacity:${opacity.toFixed(3)}`,
    ];
    if (twinkle) {
      // Random duration 2.4–4.4s, random negative delay so dots are
      // already mid-animation on mount (no synchronised first beat).
      const dur = (2.4 + seed4 * 2.0).toFixed(2);
      const delay = (-seed3 * 4.5).toFixed(2);
      baseStyle.push(`animation:vy-twinkle ${dur}s ${delay}s ease-in-out infinite alternate`);
    }
    dot.style.cssText = baseStyle.join(';');
    frag.appendChild(dot);
  }
  parent.appendChild(frag);
}

// Injected once per page — drives the tile-particle twinkle so dots
// inside the selected tile keep breathing instead of reading as static
// against the parallaxing ambient layers behind them.
function ensureTwinkleKeyframes(): void {
  if (document.getElementById('vy-twinkle-kf') !== null) return;
  const style = document.createElement('style');
  style.id = 'vy-twinkle-kf';
  style.textContent = `
    @keyframes vy-twinkle {
      0%   { opacity: 1;    transform: translate(0px, 0px); }
      40%  { opacity: 0.18; transform: translate(2px, -2px); }
      70%  { opacity: 0.85; transform: translate(-2px, 1px); }
      100% { opacity: 0.30; transform: translate(1px, 2px); }
    }
  `;
  document.head.appendChild(style);
}
