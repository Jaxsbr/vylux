// Bottom-left selection HUD: portrait + name for the currently selected
// entity. Pairs with ActionBar (bottom-right) — same refresh signature,
// same selection inputs. The portrait box hosts a tiny WebGL scene that
// renders the actual in-game mesh for the selected entity (via
// PortraitRenderer), so the player sees a 3D snapshot of what they
// clicked rather than an abstract letter glyph.

import type { Faction } from '../sim/types';
import type { Sim } from '../sim/sim';
import { findNode, findStructure, findUnit } from '../sim/state';
import { toFloat } from '../sim/fixed';
import { factionConfigFor, STRUCTURE_STATS } from '../sim/units-config';
import type { Worker } from '../sim/types';
import { themeForFaction } from './factions/theme';
import { PortraitRenderer, type PortraitEntity } from './portrait-renderer';

interface PortraitView {
  name: string;
  entity: PortraitEntity;
  faction: Faction | null; // null → neutral (nodes have no owning faction)
  subText: string;         // empty string → no sub-text row
}

const PORTRAIT_PX = 128;

// Neutral glow tint for unowned things (energy nodes) — used on the
// portrait box border so it visually mirrors the gold node colour.
const NEUTRAL_GLOW = 'rgba(255,209,102,0.55)';

export class SelectionPortrait {
  private readonly playerFaction: Faction;
  private readonly root: HTMLDivElement;
  private readonly portrait: HTMLDivElement;
  private readonly portraitCanvas: HTMLCanvasElement;
  private readonly portraitRenderer: PortraitRenderer;
  private readonly textColumn: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly subTextEl: HTMLDivElement;
  private currentKey = '';

  constructor(playerFaction: Faction, parent: HTMLElement) {
    this.playerFaction = playerFaction;

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:18px', 'bottom:18px', 'z-index:8',
      'display:none',
      'flex-direction:row', 'align-items:center', 'gap:14px',
      'background:rgba(7,9,12,0.78)',
      'padding:14px 18px',
      'border:1px solid rgba(0,229,255,0.18)',
      'border-radius:6px',
      'box-shadow:0 0 12px rgba(0,229,255,0.12)',
      `min-height:${PORTRAIT_PX + 20}px`,
      'font-family:ui-monospace,Menlo,monospace',
      'pointer-events:none',
    ].join(';');

    this.portrait = document.createElement('div');
    this.portrait.style.cssText = [
      `width:${PORTRAIT_PX}px`, `height:${PORTRAIT_PX}px`,
      'display:flex', 'align-items:center', 'justify-content:center',
      'border:1px solid rgba(0,229,255,0.3)',
      'border-radius:4px',
      'background:rgba(13,17,22,0.92)',
      'overflow:hidden',
    ].join(';');
    this.root.appendChild(this.portrait);

    this.portraitCanvas = document.createElement('canvas');
    this.portraitCanvas.style.cssText = 'display:block;';
    this.portrait.appendChild(this.portraitCanvas);
    this.portraitRenderer = new PortraitRenderer(this.portraitCanvas, PORTRAIT_PX);

    this.textColumn = document.createElement('div');
    this.textColumn.style.cssText = [
      'display:flex', 'flex-direction:column', 'gap:4px',
      'min-width:110px',
    ].join(';');
    this.root.appendChild(this.textColumn);

    this.nameEl = document.createElement('div');
    this.nameEl.style.cssText = [
      'font-size:16px', 'letter-spacing:0.32em', 'font-weight:600',
      'color:rgba(216,232,240,0.92)',
    ].join(';');
    this.textColumn.appendChild(this.nameEl);

    this.subTextEl = document.createElement('div');
    this.subTextEl.style.cssText = [
      'font-size:12px', 'letter-spacing:0.18em',
      'color:rgba(154,170,180,0.85)',
      'display:none',
    ].join(';');
    this.textColumn.appendChild(this.subTextEl);

    parent.appendChild(this.root);
  }

  detach(): void {
    this.portraitRenderer.dispose();
    this.root.remove();
  }

  refresh(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
    selectedNodeId: number | null = null,
  ): void {
    const view = this.computeView(sim, selectedUnitIds, selectedStructureId, selectedHqFaction, selectedNodeId);
    const key = view === null
      ? ''
      : `${view.faction}|${view.name}|${view.entity.kind}|${view.entity.faction}|${view.subText}`;
    if (key === this.currentKey) return;
    const entityChanged = view === null
      ? this.currentKey !== ''
      : !this.currentKey.startsWith(`${view.faction}|${view.name}|${view.entity.kind}|${view.entity.faction}|`);
    this.currentKey = key;

    if (view === null) {
      this.root.style.display = 'none';
      if (entityChanged) this.portraitRenderer.setEntity(null);
      return;
    }
    const glow = view.faction === null ? NEUTRAL_GLOW : themeForFaction(view.faction).glow;
    this.root.style.display = 'flex';
    this.root.style.border = `1px solid ${glow}`;
    this.portrait.style.border = `1px solid ${glow}`;
    this.nameEl.textContent = view.name;
    if (view.subText === '') {
      this.subTextEl.style.display = 'none';
      this.subTextEl.textContent = '';
    } else {
      this.subTextEl.style.display = 'block';
      this.subTextEl.textContent = view.subText;
    }
    // Only re-render the 3D portrait when the entity descriptor itself
    // changes — sub-text updates (e.g. HARVESTING N/M each tick) don't
    // need a GL pass.
    if (entityChanged) this.portraitRenderer.setEntity(view.entity);
  }

  private computeView(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
    selectedNodeId: number | null,
  ): PortraitView | null {
    // HQ selection (own or enemy — both are valid click targets).
    if (selectedHqFaction !== null) {
      return {
        name: 'HQ',
        entity: { kind: 'hq', faction: selectedHqFaction },
        faction: selectedHqFaction,
        subText: '',
      };
    }
    // Structure selection — work pods are the only live structure today.
    if (selectedStructureId !== null) {
      const s = findStructure(sim.state, selectedStructureId);
      if (s) {
        return {
          name: 'WORK  POD',
          entity: { kind: 'workPod', faction: s.faction },
          faction: s.faction,
          subText: '',
        };
      }
    }
    // Node selection — neutral palette; sub-text carries the remaining
    // energy value (replaces the in-world floating label).
    if (selectedNodeId !== null) {
      const n = findNode(sim.state, selectedNodeId);
      if (n) {
        const remaining = Math.max(0, Math.round(toFloat(n.remaining)));
        return {
          name: 'ENERGY  NODE',
          entity: { kind: 'energyNode', faction: null },
          faction: null,
          subText: `${remaining}  ENERGY`,
        };
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
        // Current-action readout. Hidden under multi-select because the
        // sub-text would be misleading (it'd describe one worker out of
        // many); a future pass can summarise the group.
        const subText = selectedUnitIds.size === 1
          ? workerActionText(sim, u)
          : '';
        return {
          name,
          entity: { kind: 'worker', faction: u.faction },
          faction: u.faction,
          subText,
        };
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

// Format a worker's current sim phase as a short "what is this worker
// doing right now" line for the portrait sub-text. The harvest /
// charging / building counters mirror the same progress the player
// would otherwise infer from the in-world charge bar + ambient
// harvest pulse, but in a single readable readout.
function workerActionText(sim: Sim, w: Worker): string {
  switch (w.phase) {
    case 'idle': return 'IDLE';
    case 'movingToNode': return 'MOVING';
    case 'movingToBuildSite': return 'MOVING';
    case 'walkingToCharge': return 'MOVING';
    case 'returning': return 'RETURNING';
    case 'harvesting': {
      const fid = sim.state.factions[w.faction].factionId;
      const total = factionConfigFor(fid).harvestTicks;
      const done = Math.max(0, Math.min(total, total - w.harvestTicksRemaining));
      return `HARVESTING  ${done}/${total}`;
    }
    case 'charging': {
      return `CHARGING  ${w.charge}/${w.maxCharge}`;
    }
    case 'building': {
      const s = findStructure(sim.state, w.targetStructureId);
      if (s === null || s.kind !== 'workPod') return 'BUILDING';
      const total = STRUCTURE_STATS.workPod.buildTicks;
      const done = Math.max(0, Math.min(total, total - s.buildTicksRemaining));
      return `BUILDING  ${done}/${total}`;
    }
  }
}
