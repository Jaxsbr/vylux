// Phase 2.3 desync overlay + Phase 2.4 match-end overlay.
//
// Phase 3.10 dropped the BuildablesPanel — the in-game action bar
// moved to src/render/action-bar.ts (selection-driven; see that file).
// Only the two terminal overlays live here now.

import type { Faction } from '../sim/types';

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
      'flex-direction:column', 'gap:24px',
      'background:rgba(7,9,12,0.85)', 'z-index:10',
      'font-family:ui-monospace,Menlo,monospace',
    ].join(';');
    root.appendChild(this.el);
  }

  show(playerFaction: Faction, winner: Faction): void {
    if (this.shown) return;
    this.shown = true;
    const won = winner === playerFaction;
    const message = won ? 'VICTORY' : 'DEFEAT';
    const colour = won ? '#00e5ff' : '#ff6a33';
    this.el.innerHTML = '';
    const heading = document.createElement('div');
    heading.textContent = message;
    heading.style.cssText = [
      'font-size:64px', 'letter-spacing:0.18em', 'font-weight:700',
      `color:${colour}`, `text-shadow:0 0 24px ${colour}`,
    ].join(';');
    this.el.appendChild(heading);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex;gap:12px';
    buttonRow.appendChild(this.button('DOWNLOAD REPLAY', () => this.downloadReplay()));
    buttonRow.appendChild(this.button('PLAY AGAIN', () => window.location.reload()));
    this.el.appendChild(buttonRow);

    this.el.style.display = 'flex';
  }

  // Test hook to surface visibility without exposing the DOM element.
  isShown(): boolean { return this.shown; }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      'padding:12px 28px', 'background:transparent', 'color:#cde',
      'border:1px solid #456', 'border-radius:4px',
      'font-family:inherit', 'font-size:13px', 'letter-spacing:0.2em',
      'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', onClick);
    return btn;
  }
}
