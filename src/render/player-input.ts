// Phase 2.3 desync overlay + Phase 2.4 match-end overlay.
//
// Phase 3.10 dropped the BuildablesPanel — the in-game action bar
// moved to src/render/action-bar.ts (selection-driven; see that file).
// Only the two terminal overlays live here now.
//
// Phase 3.11a — the match-end overlay re-skins per the player's faction:
// "{FACTION} — VICTORY" / "{FACTION} — DEFEATED" with faction-coloured
// glow on victory, desaturated on defeat, and the faction's voice
// tagline ("THE CURRENT HOLDS" / "THE ANVIL HOLDS" / etc) underneath.
// Sourced from the shared `factions/theme` module.

import type { Faction } from '../sim/types';
import { themeForFaction, VY_BG, VY_INK } from './factions/theme';

// Desync overlay. Shown when the lockstep hash gate fires onDesync —
// i.e. our `stateHash()` for some tick T differs from the peer's. By
// the Phase 2.3 contract, recovery = "show error and quit": we don't
// try to roll back or recompute, we surface the divergent tick + both
// hashes loudly, dump the input log so the bug is reportable, and end
// the match.
//
// Caller is expected to halt the driver before calling show() so the
// sim doesn't keep ticking on a known-corrupt state.
export class DesyncOverlay {
  private readonly el: HTMLDivElement;
  private shown = false;
  private readonly downloadReplay: () => void;

  constructor(root: HTMLElement, downloadReplay: () => void) {
    this.downloadReplay = downloadReplay;
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed', 'inset:0', 'display:none',
      'align-items:center', 'justify-content:center',
      'flex-direction:column', 'gap:18px',
      'background:rgba(20,4,8,0.92)', 'z-index:11',
      'font-family:ui-monospace,Menlo,monospace',
      'color:#cde', 'text-align:center', 'padding:32px',
    ].join(';');
    root.appendChild(this.el);
  }

  show(report: { tick: number; localHash: string; remoteHash: string }): void {
    if (this.shown) return;
    this.shown = true;
    this.el.innerHTML = '';

    const heading = document.createElement('div');
    heading.textContent = 'DESYNC DETECTED';
    heading.style.cssText = [
      'font-size:48px', 'letter-spacing:0.18em', 'font-weight:700',
      'color:#ff6a33', 'text-shadow:0 0 24px #ff6a33',
    ].join(';');
    this.el.appendChild(heading);

    const tickLine = document.createElement('div');
    tickLine.textContent = `divergent at tick ${report.tick}`;
    tickLine.style.cssText = 'font-size:14px;letter-spacing:0.16em;color:#ff9a66';
    this.el.appendChild(tickLine);

    const hashes = document.createElement('div');
    hashes.style.cssText = 'font-size:12px;line-height:1.7;color:#9ad;white-space:pre';
    hashes.textContent = [
      `local  ${report.localHash}`,
      `remote ${report.remoteHash}`,
    ].join('\n');
    this.el.appendChild(hashes);

    const note = document.createElement('div');
    note.textContent = 'this is a sim bug — please attach the replay to a report';
    note.style.cssText = 'font-size:11px;color:#7a8;letter-spacing:0.04em;max-width:520px';
    this.el.appendChild(note);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex;gap:12px;margin-top:6px';
    buttonRow.appendChild(this.button('DOWNLOAD REPLAY', () => this.downloadReplay()));
    buttonRow.appendChild(this.button('RELOAD', () => window.location.reload()));
    this.el.appendChild(buttonRow);

    this.el.style.display = 'flex';
  }

  // Test hook: surfaces visibility without exposing the DOM element directly.
  isShown(): boolean { return this.shown; }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      'padding:12px 24px', 'background:transparent', 'color:#cde',
      'border:1px solid #654', 'border-radius:4px',
      'font-family:inherit', 'font-size:12px', 'letter-spacing:0.2em',
      'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', onClick);
    return btn;
  }
}

// Match-end overlay. Shown when sim.state.winner !== null. The Play
// Again button reloads the page — the simplest correct reset given
// the small surface area. The Download Replay button (Phase 2.4) saves
// the input log as JSON, which round-trips through tools/replay.ts —
// the format `version: 1` was locked in Phase 1.3 and has been the same
// shape end-to-end since then.
export class MatchEndOverlay {
  private readonly el: HTMLDivElement;
  private readonly downloadReplay: () => void;
  private shown = false;

  constructor(root: HTMLElement, downloadReplay: () => void) {
    this.downloadReplay = downloadReplay;
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed', 'inset:0', 'display:none',
      'align-items:center', 'justify-content:center',
      'flex-direction:column', 'gap:28px',
      'overflow:hidden',
      `font-family:ui-monospace,Menlo,monospace`, `color:${VY_INK}`,
      'z-index:10',
    ].join(';');
    root.appendChild(this.el);
  }

  show(playerFaction: Faction, winner: Faction): void {
    if (this.shown) return;
    this.shown = true;
    this.el.innerHTML = '';

    const f = themeForFaction(playerFaction);
    const won = winner === playerFaction;
    const headColor = won ? f.primary : 'rgba(220,235,240,0.85)';
    const headGlow  = won ? `0 0 32px ${f.glowHard}, 0 0 80px ${f.glowSoft}` : 'none';
    const headline = `${f.name}  ·  ${won ? 'VICTORY' : 'DEFEATED'}`;
    const tag = won ? f.victory : f.defeat;

    // Backdrop — radial-gradient on victory; flat-charcoal on defeat.
    const bg = document.createElement('div');
    bg.style.cssText = [
      'position:absolute', 'inset:0',
      `background:${won
        ? `radial-gradient(ellipse at center, ${f.deep} 0%, ${VY_BG} 65%)`
        : `radial-gradient(ellipse at center, #0c0e12 0%, ${VY_BG} 70%)`}`,
    ].join(';');
    this.el.appendChild(bg);

    if (!won) {
      // Defeat: faded grid lines instead of particles.
      const grid = document.createElement('div');
      grid.style.cssText = [
        'position:absolute', 'inset:0', 'opacity:0.3',
        'background-image:repeating-linear-gradient(0deg, rgba(180,200,210,0.08) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, rgba(180,200,210,0.08) 0 1px, transparent 1px 24px)',
        'pointer-events:none',
      ].join(';');
      this.el.appendChild(grid);
    }

    // Content stack — sits above the bg layer.
    const content = document.createElement('div');
    content.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;gap:28px';
    this.el.appendChild(content);

    const heading = document.createElement('div');
    heading.textContent = headline;
    heading.style.cssText = [
      'font-size:80px',
      `letter-spacing:${f.titleTrack}`,
      `font-weight:${f.titleWeight}`,
      `color:${headColor}`,
      `text-shadow:${headGlow}`,
      'text-align:center',
    ].join(';');
    content.appendChild(heading);

    const tagline = document.createElement('div');
    tagline.textContent = `“${tag}”`;
    tagline.style.cssText = [
      'font-size:16px',
      `letter-spacing:${f.bodyTrack}`,
      `color:${won ? f.bright : 'rgba(220,235,240,0.55)'}`,
      `font-weight:${won ? f.cardWeight : 300}`,
      won ? `text-shadow:0 0 12px ${f.glowSoft}` : '',
    ].filter(Boolean).join(';');
    content.appendChild(tagline);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex;gap:14px;margin-top:18px';
    buttonRow.appendChild(this.button('NEW  RUN', () => window.location.reload(), { primary: true, theme: f, won }));
    buttonRow.appendChild(this.button('DOWNLOAD  REPLAY', () => this.downloadReplay(), { primary: false, theme: f, won }));
    content.appendChild(buttonRow);

    this.el.style.display = 'flex';
  }

  // Test hook to surface visibility without exposing the DOM element.
  isShown(): boolean { return this.shown; }

  private button(
    label: string,
    onClick: () => void,
    style: { primary: boolean; theme: ReturnType<typeof themeForFaction>; won: boolean },
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    const stroke = style.primary && style.won ? style.theme.primary : 'rgba(220,235,240,0.6)';
    btn.style.cssText = [
      'background:transparent',
      `border:${style.primary ? style.theme.strokeW : 1}px solid ${stroke}`,
      `border-radius:${style.theme.radius}px`,
      `color:${stroke}`,
      'padding:14px 32px',
      'font-family:inherit',
      'font-size:13px',
      `letter-spacing:${style.theme.cardTrack}`,
      `font-weight:${style.primary ? style.theme.cardWeight : 400}`,
      style.primary && style.won ? `box-shadow:0 0 16px ${style.theme.glow}` : '',
      'cursor:pointer',
    ].filter(Boolean).join(';');
    btn.addEventListener('click', onClick);
    return btn;
  }
}
