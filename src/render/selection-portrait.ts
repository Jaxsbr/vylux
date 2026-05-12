// Bottom-left selection HUD: portrait + name for the currently selected
// entity. Pairs with ActionBar (bottom-right) — same refresh signature,
// same selection inputs. The portrait is a stylised faction-tinted box
// with the entity's initial; we don't have real portrait art yet and a
// painted glyph reads cleaner against the Tron grid than an empty box.

import type { Faction } from '../sim/types';
import type { Sim } from '../sim/sim';
import { findStructure, findUnit } from '../sim/state';
import { themeForFaction } from './factions/theme';

interface PortraitView {
  name: string;
  glyph: string;
  faction: Faction;
}

export class SelectionPortrait {
  private readonly playerFaction: Faction;
  private readonly root: HTMLDivElement;
  private readonly portrait: HTMLDivElement;
  private readonly glyphEl: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private currentKey = '';

  constructor(playerFaction: Faction, parent: HTMLElement) {
    this.playerFaction = playerFaction;

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:18px', 'bottom:18px', 'z-index:8',
      'display:none',
      'flex-direction:row', 'align-items:center', 'gap:12px',
      'background:rgba(7,9,12,0.78)',
      'padding:10px 14px',
      'border:1px solid rgba(0,229,255,0.18)',
      'border-radius:6px',
      'box-shadow:0 0 12px rgba(0,229,255,0.12)',
      'min-height:74px',
      'font-family:ui-monospace,Menlo,monospace',
      'pointer-events:none',
    ].join(';');

    this.portrait = document.createElement('div');
    this.portrait.style.cssText = [
      'width:54px', 'height:54px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'border:1px solid rgba(0,229,255,0.3)',
      'border-radius:4px',
      'background:rgba(13,17,22,0.92)',
    ].join(';');
    this.root.appendChild(this.portrait);

    this.glyphEl = document.createElement('div');
    this.glyphEl.style.cssText = [
      'font-size:28px', 'font-weight:700',
      'letter-spacing:0.06em',
    ].join(';');
    this.portrait.appendChild(this.glyphEl);

    this.nameEl = document.createElement('div');
    this.nameEl.style.cssText = [
      'font-size:13px', 'letter-spacing:0.32em', 'font-weight:600',
      'color:rgba(216,232,240,0.92)',
      'min-width:90px',
    ].join(';');
    this.root.appendChild(this.nameEl);

    parent.appendChild(this.root);
  }

  detach(): void {
    this.root.remove();
  }

  refresh(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
  ): void {
    const view = this.computeView(sim, selectedUnitIds, selectedStructureId, selectedHqFaction);
    const key = view === null
      ? ''
      : `${view.faction}|${view.name}|${view.glyph}`;
    if (key === this.currentKey) return;
    this.currentKey = key;

    if (view === null) {
      this.root.style.display = 'none';
      return;
    }
    const theme = themeForFaction(view.faction);
    this.root.style.display = 'flex';
    this.root.style.border = `1px solid ${theme.glow}`;
    this.portrait.style.border = `1px solid ${theme.glow}`;
    this.glyphEl.textContent = view.glyph;
    this.glyphEl.style.color = theme.primary;
    this.nameEl.textContent = view.name;
  }

  private computeView(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
  ): PortraitView | null {
    // HQ selection (own or enemy — both are valid click targets).
    if (selectedHqFaction !== null) {
      return { name: 'HQ', glyph: 'H', faction: selectedHqFaction };
    }
    // Structure selection — work pods are the only live structure today.
    if (selectedStructureId !== null) {
      const s = findStructure(sim.state, selectedStructureId);
      if (s) {
        return { name: 'WORK  POD', glyph: 'P', faction: s.faction };
      }
    }
    // Unit selection. When multiple units are selected we show the first
    // one's portrait plus a count — keeps the HUD information-dense
    // without needing a separate "multi-select" UI in this basic pass.
    if (selectedUnitIds.size > 0) {
      const first = selectedUnitIds.values().next().value as number;
      const u = findUnit(sim.state, first);
      if (u) {
        const base = 'WORKER';
        const name = selectedUnitIds.size > 1
          ? `${base}  ×${selectedUnitIds.size}`
          : base;
        return { name, glyph: 'W', faction: u.faction };
      }
    }
    // No selection — but only hide the HUD if the player hasn't selected
    // anything; if they're inspecting an enemy unit the portrait should
    // still appear. The current input controller only retains friendly
    // selections, so a falsy result here genuinely means "nothing".
    void this.playerFaction;
    return null;
  }
}
