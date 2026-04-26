// Mouse input layer for Phase 1.5.
//
// Builds a buildables panel + match-end overlay. The panel is the
// player's only required mouse interaction in Phase 1: click a unit
// kind, that faction's energy is debited next tick, and the unit
// spawns at the HQ. Worker assignment to nodes is auto-handled by
// autoAssignIdleWorkers (matching AI behaviour) — the player just
// trains.
//
// Phase 3+ likely splits this into "always-visible HUD" and "popup
// panel triggered by clicking the HQ", and adds click-to-place for
// units. Keeping it as a single static panel here so the load-bearing
// work for 1.5 stays "wiring sim commands to a clickable surface."

import { CommandKind, type Command } from '../sim/commands';
import type { Faction, UnitKind } from '../sim/types';
import { UNIT_STATS } from '../sim/units-config';
import type { Sim } from '../sim/sim';

export class PlayerInput {
  private readonly faction: Faction;
  private readonly queue: Command[] = [];
  private readonly panel: HTMLDivElement;
  private readonly buttons = new Map<UnitKind, HTMLButtonElement>();

  constructor(faction: Faction, root: HTMLElement) {
    this.faction = faction;
    this.panel = this.buildPanel();
    root.appendChild(this.panel);
  }

  // Pull queued commands. Called by the driver each tick — clears the
  // queue so each command runs exactly once.
  takeQueued(): Command[] {
    if (this.queue.length === 0) return [];
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  // Reflect current affordability on the buttons (greys out unaffordable
  // options). Called from the render loop, cheap enough to run every
  // frame.
  refresh(sim: Sim): void {
    const energy = sim.state.factions[this.faction].energy;
    for (const [kind, btn] of this.buttons) {
      const cost = UNIT_STATS[kind].trainCost;
      const affordable = energy >= cost;
      btn.disabled = !affordable;
      btn.style.opacity = affordable ? '1' : '0.45';
      btn.style.cursor = affordable ? 'pointer' : 'not-allowed';
    }
  }

  destroy(): void {
    this.panel.remove();
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:18px', 'transform:translateX(-50%)',
      'display:flex', 'gap:8px',
      'background:rgba(7,9,12,0.85)', 'border:1px solid #234',
      'padding:8px', 'border-radius:6px',
      'font-family:ui-monospace,Menlo,monospace', 'color:#9ad', 'font-size:12px',
      'user-select:none',
    ].join(';');

    const kinds: UnitKind[] = ['worker', 'defender', 'raider'];
    for (const kind of kinds) {
      const btn = this.buildButton(kind);
      panel.appendChild(btn);
      this.buttons.set(kind, btn);
    }
    return panel;
  }

  private buildButton(kind: UnitKind): HTMLButtonElement {
    const btn = document.createElement('button');
    const cost = UNIT_STATS[kind].trainCost / 65536;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #345', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:90px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">${kind}</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${cost.toFixed(0)} energy</div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.queue.push({
        kind: CommandKind.TrainUnit,
        faction: this.faction,
        unitKind: kind,
      });
    });
    return btn;
  }
}

function factionColorCss(faction: Faction): string {
  return faction === 0 ? '#00e5ff' : '#ff6a33';
}

// Match-end overlay. Shown when sim.state.winner !== null. The Play
// Again button reloads the page — the simplest correct reset given
// the small surface area.
export class MatchEndOverlay {
  private readonly el: HTMLDivElement;
  private shown = false;

  constructor(root: HTMLElement) {
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

    const btn = document.createElement('button');
    btn.textContent = 'PLAY AGAIN';
    btn.style.cssText = [
      'padding:12px 28px', 'background:transparent', 'color:#cde',
      'border:1px solid #456', 'border-radius:4px',
      'font-family:inherit', 'font-size:13px', 'letter-spacing:0.2em',
      'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', () => window.location.reload());
    this.el.appendChild(btn);

    this.el.style.display = 'flex';
  }
}
