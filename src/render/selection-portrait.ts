// Bottom-left selection HUD: portrait + name + status for the currently
// selected entity. Pairs with ActionBar (bottom-centre command card) — same
// refresh signature, same selection inputs. The portrait box hosts a tiny
// WebGL scene that renders the actual in-game mesh for the selected entity
// (via PortraitRenderer), so the player sees a 3D snapshot of what they
// clicked rather than an abstract glyph.
//
// Phase C.2: the flat status text is replaced by an action-icon + label row
// plus HP / charge bars (workers) or an HP / build bar (pods). The panel is
// a fixed footprint so it never resizes to fit its text.

import type { Faction } from '../sim/types';
import type { Sim } from '../sim/sim';
import { findNode, findStructure, findUnit } from '../sim/state';
import { toFloat } from '../sim/fixed';
import { factionConfigFor, STRUCTURE_STATS, unitStatsFor } from '../sim/units-config';
import type { Worker } from '../sim/types';
import { themeForFaction } from './factions/theme';
import { PortraitRenderer, type PortraitEntity } from './portrait-renderer';
import { hudIconSvg, workerPhaseIcon, type HudIconName } from './hud-icons';

interface BarView {
  cur: number;
  max: number;
}

interface PortraitView {
  name: string;
  entity: PortraitEntity;
  faction: Faction | null; // null → neutral (nodes have no owning faction)
  status: string;          // action / state readout ('' → no status row)
  statusIcon: HudIconName | null;
  hp: BarView | null;      // null → no HP bar
  charge: BarView | null;  // null → no charge bar (non-workers)
}

const PORTRAIT_PX = 128;
const TEXT_COL_PX = 160; // fixed → panel never resizes to fit status text

// Neutral glow tint for unowned things (energy nodes) — used on the
// portrait box border so it visually mirrors the gold node colour.
const NEUTRAL_GLOW = 'rgba(255,209,102,0.55)';
const HP_COLOR = '#5fe08a';
const CHARGE_COLOR = '#00e5ff';

interface Bar {
  row: HTMLDivElement;
  fill: HTMLDivElement;
  value: HTMLDivElement;
}

export class SelectionPortrait {
  private readonly playerFaction: Faction;
  private readonly root: HTMLDivElement;
  private readonly portrait: HTMLDivElement;
  private readonly portraitCanvas: HTMLCanvasElement;
  private readonly portraitRenderer: PortraitRenderer;
  private readonly textColumn: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly statusRow: HTMLDivElement;
  private readonly statusIconEl: HTMLDivElement;
  private readonly statusLabel: HTMLDivElement;
  private readonly hpBar: Bar;
  private readonly chargeBar: Bar;
  private currentKey = '';

  constructor(playerFaction: Faction, parent: HTMLElement) {
    this.playerFaction = playerFaction;

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:18px', 'bottom:18px', 'z-index:8',
      'display:none',
      'flex-direction:row', 'align-items:stretch', 'gap:14px',
      'background:rgba(7,9,12,0.82)',
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
      'flex:0 0 auto',
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
      'display:flex', 'flex-direction:column', 'gap:7px',
      `width:${TEXT_COL_PX}px`, 'justify-content:center',
    ].join(';');
    this.root.appendChild(this.textColumn);

    this.nameEl = document.createElement('div');
    this.nameEl.style.cssText = [
      'font-size:16px', 'letter-spacing:0.28em', 'font-weight:600',
      'color:rgba(216,232,240,0.95)',
    ].join(';');
    this.textColumn.appendChild(this.nameEl);

    // Status row: action icon + label (e.g. ⛏ HARVESTING 3/20).
    this.statusRow = document.createElement('div');
    this.statusRow.style.cssText = [
      'display:none', 'flex-direction:row', 'align-items:center', 'gap:6px',
      'min-height:16px',
    ].join(';');
    this.statusIconEl = document.createElement('div');
    this.statusIconEl.style.cssText = 'line-height:0;flex:0 0 auto;';
    this.statusRow.appendChild(this.statusIconEl);
    this.statusLabel = document.createElement('div');
    this.statusLabel.style.cssText = [
      'font-size:11px', 'letter-spacing:0.14em',
      'color:rgba(154,170,180,0.9)',
    ].join(';');
    this.statusRow.appendChild(this.statusLabel);
    this.textColumn.appendChild(this.statusRow);

    this.hpBar = makeBar('HP', HP_COLOR);
    this.textColumn.appendChild(this.hpBar.row);
    this.chargeBar = makeBar('CHG', CHARGE_COLOR);
    this.textColumn.appendChild(this.chargeBar.row);

    parent.appendChild(this.root);
  }

  detach(): void {
    this.portraitRenderer.dispose();
    this.root.remove();
  }

  // Per-frame animation tick — drives the portrait's in-game life pulse +
  // slow turntable spin. Separate from refresh() (which is selection /
  // status-driven + skips when nothing changed); animate runs every frame so
  // the 3D portrait keeps breathing + rotating while shown.
  animate(dtSeconds: number): void {
    this.portraitRenderer.animate(dtSeconds);
  }

  refresh(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
    selectedNodeId: number | null = null,
  ): void {
    const view = this.computeView(sim, selectedUnitIds, selectedStructureId, selectedHqFaction, selectedNodeId);
    const barKey = (b: BarView | null): string => (b === null ? '-' : `${b.cur}/${b.max}`);
    const key = view === null
      ? ''
      : `${view.faction}|${view.name}|${view.entity.kind}|${view.entity.faction}|${view.status}|${view.statusIcon ?? ''}|${barKey(view.hp)}|${barKey(view.charge)}`;
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

    // Status row.
    if (view.status === '') {
      this.statusRow.style.display = 'none';
    } else {
      this.statusRow.style.display = 'flex';
      this.statusLabel.textContent = view.status;
      if (view.statusIcon === null) {
        this.statusIconEl.style.display = 'none';
      } else {
        this.statusIconEl.style.display = 'block';
        this.statusIconEl.style.color = view.faction === null ? NEUTRAL_GLOW : themeForFaction(view.faction).primary;
        this.statusIconEl.innerHTML = hudIconSvg(view.statusIcon, 15);
      }
    }
    setBar(this.hpBar, view.hp);
    setBar(this.chargeBar, view.charge);

    // Only re-render the 3D portrait when the entity descriptor itself
    // changes — status / bar updates each tick don't need a GL pass.
    if (entityChanged) this.portraitRenderer.setEntity(view.entity);
  }

  private computeView(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
    selectedNodeId: number | null,
  ): PortraitView | null {
    // HQ selection (own or enemy — both are valid click targets). HQ HP
    // lives in the top resource bar, so the portrait shows no bars.
    if (selectedHqFaction !== null) {
      return {
        name: 'HQ',
        entity: { kind: 'hq', faction: selectedHqFaction },
        faction: selectedHqFaction,
        status: '', statusIcon: null, hp: null, charge: null,
      };
    }
    // Structure selection — work pods are the only live structure today.
    if (selectedStructureId !== null) {
      const s = findStructure(sim.state, selectedStructureId);
      if (s) {
        const total = STRUCTURE_STATS.workPod.buildTicks;
        const building = s.buildTicksRemaining > 0;
        const status = building
          ? `BUILDING ${Math.max(0, Math.min(total, total - s.buildTicksRemaining))}/${total}`
          : 'OPERATIONAL';
        return {
          name: 'WORK POD',
          entity: { kind: 'workPod', faction: s.faction },
          faction: s.faction,
          status,
          statusIcon: building ? 'build' : null,
          hp: { cur: Math.round(toFloat(s.hp)), max: Math.round(toFloat(STRUCTURE_STATS.workPod.maxHp)) },
          charge: null,
        };
      }
    }
    // Node selection — neutral palette; status carries remaining energy.
    if (selectedNodeId !== null) {
      const n = findNode(sim.state, selectedNodeId);
      if (n) {
        const remaining = Math.max(0, Math.round(toFloat(n.remaining)));
        return {
          name: 'ENERGY NODE',
          entity: { kind: 'energyNode', faction: null },
          faction: null,
          status: `${remaining} ENERGY`,
          statusIcon: null, hp: null, charge: null,
        };
      }
    }
    // Unit selection. Under multi-select we show the first worker's
    // portrait + a count, but suppress the per-unit status / bars (they'd
    // describe just one of the group).
    if (selectedUnitIds.size > 0) {
      const first = selectedUnitIds.values().next().value as number;
      const u = findUnit(sim.state, first);
      if (u) {
        const multi = selectedUnitIds.size > 1;
        const maxHp = unitStatsFor(sim.state.factions[u.faction].factionId, 'worker').maxHp;
        return {
          name: multi ? `WORKER ×${selectedUnitIds.size}` : 'WORKER',
          entity: { kind: 'worker', faction: u.faction },
          faction: u.faction,
          status: multi ? '' : workerActionText(sim, u),
          statusIcon: multi ? null : workerPhaseIcon(u.phase),
          hp: multi ? null : { cur: Math.round(toFloat(u.hp)), max: Math.round(toFloat(maxHp)) },
          charge: multi ? null : { cur: u.charge, max: u.maxCharge },
        };
      }
    }
    void this.playerFaction;
    return null;
  }
}

// A label + track + fill bar. The fill width + value text are set per
// refresh; the whole row is hidden when its BarView is null.
function makeBar(label: string, color: string): Bar {
  const row = document.createElement('div');
  row.style.cssText = 'display:none;flex-direction:row;align-items:center;gap:6px;';

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'font-size:9px;letter-spacing:0.1em;color:rgba(154,170,180,0.7);width:26px;flex:0 0 auto;';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const track = document.createElement('div');
  track.style.cssText = 'flex:1;height:7px;background:rgba(40,50,58,0.7);border-radius:3px;overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = `height:100%;width:0%;background:${color};border-radius:3px;`;
  track.appendChild(fill);
  row.appendChild(track);

  const value = document.createElement('div');
  value.style.cssText = 'font-size:9px;letter-spacing:0.06em;color:rgba(154,170,180,0.85);width:42px;flex:0 0 auto;text-align:right;';
  row.appendChild(value);

  return { row, fill, value };
}

function setBar(bar: Bar, view: BarView | null): void {
  if (view === null) {
    bar.row.style.display = 'none';
    return;
  }
  bar.row.style.display = 'flex';
  const pct = view.max > 0 ? Math.max(0, Math.min(1, view.cur / view.max)) * 100 : 0;
  bar.fill.style.width = `${pct}%`;
  bar.value.textContent = `${view.cur}/${view.max}`;
}

// Format a worker's current sim phase as a short "what is this worker doing
// right now" line for the status label. Pairs with workerPhaseIcon.
function workerActionText(sim: Sim, w: Worker): string {
  switch (w.phase) {
    case 'idle': return 'IDLE';
    case 'movingToNode': return 'MOVING';
    case 'movingToBuildSite': return 'MOVING';
    case 'scouting': return 'SCOUTING';
    case 'walkingToCharge': return 'TO CHARGE';
    case 'returning': return 'RETURNING';
    case 'harvesting': {
      const fid = sim.state.factions[w.faction].factionId;
      const total = factionConfigFor(fid).harvestTicks;
      const done = Math.max(0, Math.min(total, total - w.harvestTicksRemaining));
      return `HARVESTING ${done}/${total}`;
    }
    case 'charging': {
      return `CHARGING ${w.charge}/${w.maxCharge}`;
    }
    case 'building': {
      const s = findStructure(sim.state, w.targetStructureId);
      if (s === null || s.kind !== 'workPod') return 'BUILDING';
      const total = STRUCTURE_STATS.workPod.buildTicks;
      const done = Math.max(0, Math.min(total, total - s.buildTicksRemaining));
      return `BUILDING ${done}/${total}`;
    }
  }
}
