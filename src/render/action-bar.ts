// Phase 3.10 — Context-sensitive in-game action bar.
//
// Replaces the Phase 1 always-visible flat BuildablesPanel ("a wall of
// cards of information") with a selection-driven action bar — the
// standard RTS pattern. The actions you see are the ones the *thing
// you have selected* can do.
//
//   HQ selected            → TRAIN WORKER
//   Worker(s) selected     → BUILD FORGE / SPIRE / PYLON, DUMP
//   Forge selected         → TRAIN DEFENDER / RAIDER / VANGUARD
//   Spire selected         → RESEARCH TIER 2 / TRAIL+
//   Pylon selected         → info-only ("+8 supply")
//   Mixed unit kinds       → no actions (right-click moves them)
//   Nothing selected       → empty hint
//
// Each button shows its hotkey letter, faction-coloured cost glyphs,
// and a tooltip explaining why it's disabled (if it is). Buttons are
// rebuilt per refresh — cheap (handful of DOM nodes) and avoids the
// stale-state bugs the old panel accumulated.

import type { Faction, UnitKind } from '../sim/types';
import {
  findFirstOperationalProduction,
  findFirstOperationalUpgrade,
  findFirstUpgradeAnyState,
  findStructure,
  findUnit,
} from '../sim/state';
import {
  DUMP_ENERGY_COST,
  STRUCTURE_STATS,
  TIER2_COLOR_COST,
  TIER2_FLUX_COST,
  TRAIL_DURATION_FLUX_COST,
  UNIT_STATS,
} from '../sim/units-config';
import { FACTION_COLOR } from '../sim/types';
import type { Sim } from '../sim/sim';
import { toFloat, type Fixed } from '../sim/fixed';

// Display helper: Fixed costs (Q16.16) come in as integers like 3276800
// for 50; the player wants to see "50". toFloat does the divide.
const displayCost = (f: Fixed): number => Math.round(toFloat(f));

export interface ActionBarDelegate {
  onTrainKindSelected(kind: UnitKind): void;
  onBuildForgeSelected(): void;
  onBuildSpireSelected(): void;
  onBuildPylonSelected(): void;
  onResearchTier2Selected(): void;
  onResearchTrailDurationSelected(): void;
  onDumpSelected(): void;
}

interface ButtonSpec {
  id: string;
  label: string;
  sublabel?: string;
  hotkey?: string;
  costEnergy?: number;
  costFlux?: number;
  costColor?: number;
  enabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}

const FACTION_TINT: Record<Faction, string> = {
  0: '#00e5ff',
  1: '#ff6a33',
};

const FACTION_TINT_DIM: Record<Faction, string> = {
  0: 'rgba(0,229,255,0.55)',
  1: 'rgba(255,106,51,0.55)',
};

export class ActionBar {
  private readonly faction: Faction;
  private readonly delegate: ActionBarDelegate;
  private readonly bar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly buttonContainer: HTMLDivElement;
  // Lookup of button specs by id so refresh can compare-and-skip if
  // nothing changed (small optimisation; pure DOM cost is tiny but
  // avoiding rebuilds preserves :hover / :focus state).
  private currentSpecKey = '';

  constructor(faction: Faction, delegate: ActionBarDelegate, root: HTMLElement) {
    this.faction = faction;
    this.delegate = delegate;

    this.bar = document.createElement('div');
    this.bar.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'bottom:18px', 'z-index:8',
      'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:8px',
      'font-family:ui-monospace,Menlo,monospace',
      'pointer-events:auto',
    ].join(';');

    this.hint = document.createElement('div');
    this.hint.style.cssText = [
      'font-size:10px', 'letter-spacing:0.32em',
      'color:rgba(154,170,180,0.6)',
      'min-height:14px', 'text-align:center',
    ].join(';');
    this.bar.appendChild(this.hint);

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.style.cssText = [
      'display:flex', 'gap:10px',
      'background:rgba(7,9,12,0.78)',
      'padding:10px 14px',
      'border:1px solid rgba(0,229,255,0.18)',
      'border-radius:6px',
      'box-shadow:0 0 12px rgba(0,229,255,0.12)',
      'min-height:74px', 'min-width:240px',
      'align-items:center', 'justify-content:center',
    ].join(';');
    this.bar.appendChild(this.buttonContainer);

    root.appendChild(this.bar);
  }

  detach(): void {
    this.bar.remove();
  }

  refresh(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
  ): void {
    const ctx = this.computeSelectionContext(sim, selectedUnitIds, selectedStructureId, selectedHqFaction);
    const specs = this.computeSpecs(sim, ctx);
    // Hint is part of the comparison key — without it, going from 1
    // worker selected → 2 workers selected wouldn't refresh the hint
    // ("WORKER" vs "2 WORKERS") because the button list is identical.
    const key = ctx.kind + '|' + ctx.hint + '|' + specs.map((s) => `${s.id}:${s.enabled ? '1' : '0'}:${s.disabledReason ?? ''}`).join('/');
    if (key === this.currentSpecKey) return;
    this.currentSpecKey = key;

    this.hint.textContent = ctx.hint;
    this.renderButtons(specs);
  }

  // ----- selection → context -------------------------------------------

  private computeSelectionContext(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
  ): SelectionContext {
    if (selectedHqFaction !== null) {
      return { kind: 'hq', hint: 'HQ' };
    }
    if (selectedStructureId !== null) {
      const s = findStructure(sim.state, selectedStructureId);
      if (s && s.alive && s.faction === this.faction) {
        if (s.kind === 'production') return { kind: 'forge', structureId: s.id, hint: 'FORGE' };
        if (s.kind === 'upgrade') return { kind: 'spire', structureId: s.id, hint: 'SPIRE' };
        if (s.kind === 'supply') return { kind: 'pylon', structureId: s.id, hint: 'PYLON · +8 SUPPLY' };
      }
    }
    if (selectedUnitIds.size > 0) {
      let allWorkers = true;
      let count = 0;
      for (const id of selectedUnitIds) {
        const u = findUnit(sim.state, id);
        if (!u || u.faction !== this.faction) continue;
        count++;
        if (u.kind !== 'worker') allWorkers = false;
      }
      if (count === 0) {
        return { kind: 'none', hint: 'SELECT  YOUR  HQ  OR  A  UNIT' };
      }
      if (allWorkers) {
        return { kind: 'workers', workerCount: count, hint: count === 1 ? 'WORKER' : `${count} WORKERS` };
      }
      return { kind: 'mixed', hint: 'MIXED  SELECTION  ·  RIGHT-CLICK  TO  MOVE' };
    }
    return { kind: 'none', hint: 'SELECT  YOUR  HQ  OR  A  UNIT' };
  }

  // ----- context → buttons ---------------------------------------------

  private computeSpecs(sim: Sim, ctx: SelectionContext): ButtonSpec[] {
    const fs = sim.state.factions[this.faction];
    const colorLabel = FACTION_COLOR[this.faction];
    switch (ctx.kind) {
      case 'hq':
        return [this.workerTrainSpec(fs, colorLabel)];
      case 'workers':
        return [
          this.buildForgeSpec(fs, colorLabel),
          this.buildSpireSpec(sim, fs, colorLabel),
          this.buildPylonSpec(fs, colorLabel),
          this.dumpSpec(fs),
        ];
      case 'forge':
        return [
          this.combatTrainSpec(sim, fs, colorLabel, 'defender', 'D'),
          this.combatTrainSpec(sim, fs, colorLabel, 'raider', 'R'),
          this.combatTrainSpec(sim, fs, colorLabel, 'vanguard', 'V'),
        ];
      case 'spire':
        return [
          this.researchTier2Spec(sim, fs, colorLabel),
          this.researchTrailSpec(sim, fs),
        ];
      case 'pylon':
      case 'mixed':
      case 'none':
        return [];
    }
  }

  private workerTrainSpec(fs: Sim['state']['factions'][number], colorLabel: 'blue' | 'red'): ButtonSpec {
    const stats = UNIT_STATS.worker;
    const energyOk = fs.energy >= stats.trainCost;
    const colorOk = fs.color >= stats.trainColorCost;
    const supplyOk = fs.supplyUsed + stats.supplyCost <= fs.supplyCap;
    const enabled = energyOk && colorOk && supplyOk;
    let reason: string | undefined;
    if (!energyOk) reason = 'no energy';
    else if (!colorOk) reason = `no ${colorLabel}`;
    else if (!supplyOk) reason = 'supply blocked';
    return {
      id: 'train-worker',
      label: 'TRAIN  WORKER',
      hotkey: 'W',
      costEnergy: displayCost(stats.trainCost),
      costColor: displayCost(stats.trainColorCost),
      enabled,
      disabledReason: reason,
      onClick: () => this.delegate.onTrainKindSelected('worker'),
    };
  }

  private combatTrainSpec(
    sim: Sim,
    fs: Sim['state']['factions'][number],
    colorLabel: 'blue' | 'red',
    kind: Exclude<UnitKind, 'worker'>,
    hotkey: string,
  ): ButtonSpec {
    const stats = UNIT_STATS[kind];
    const operationalForge = findFirstOperationalProduction(sim.state, this.faction);
    const forgeBusy = operationalForge !== null && operationalForge.trainingKind !== null;
    const energyOk = fs.energy >= stats.trainCost;
    const fluxOk = fs.flux >= stats.trainFluxCost;
    const colorOk = fs.color >= stats.trainColorCost;
    const supplyOk = fs.supplyUsed + stats.supplyCost <= fs.supplyCap;
    const tierOk = !stats.requiresTier2 || fs.tier2Researched;
    const enabled = operationalForge !== null && !forgeBusy && energyOk && fluxOk && colorOk && supplyOk && tierOk;
    let reason: string | undefined;
    if (operationalForge === null) reason = 'no forge';
    else if (forgeBusy) reason = 'forge busy';
    else if (!tierOk) reason = 'tier 2 not researched';
    else if (!energyOk) reason = 'no energy';
    else if (!fluxOk) reason = 'no flux';
    else if (!colorOk) reason = `no ${colorLabel}`;
    else if (!supplyOk) reason = 'supply blocked';
    return {
      id: `train-${kind}`,
      label: `TRAIN  ${kind.toUpperCase()}`,
      hotkey,
      costEnergy: displayCost(stats.trainCost),
      costFlux: stats.trainFluxCost > 0 ? displayCost(stats.trainFluxCost) : undefined,
      costColor: displayCost(stats.trainColorCost),
      enabled,
      disabledReason: reason,
      onClick: () => this.delegate.onTrainKindSelected(kind),
    };
  }

  private buildForgeSpec(fs: Sim['state']['factions'][number], colorLabel: 'blue' | 'red'): ButtonSpec {
    const s = STRUCTURE_STATS.production;
    const energyOk = fs.energy >= s.buildCost;
    const colorOk = fs.color >= s.buildColorCost;
    const enabled = energyOk && colorOk;
    let reason: string | undefined;
    if (!energyOk) reason = 'no energy';
    else if (!colorOk) reason = `no ${colorLabel}`;
    return {
      id: 'build-forge',
      label: 'BUILD  FORGE',
      sublabel: 'click tile',
      hotkey: 'F',
      costEnergy: displayCost(s.buildCost),
      costColor: displayCost(s.buildColorCost),
      enabled,
      disabledReason: reason,
      onClick: () => this.delegate.onBuildForgeSelected(),
    };
  }

  private buildSpireSpec(sim: Sim, fs: Sim['state']['factions'][number], colorLabel: 'blue' | 'red'): ButtonSpec {
    const s = STRUCTURE_STATS.upgrade;
    const energyOk = fs.energy >= s.buildCost;
    const colorOk = fs.color >= s.buildColorCost;
    const alreadyHave = findFirstUpgradeAnyState(sim.state, this.faction) !== null;
    const enabled = energyOk && colorOk && !alreadyHave;
    let reason: string | undefined;
    if (alreadyHave) reason = 'have spire';
    else if (!energyOk) reason = 'no energy';
    else if (!colorOk) reason = `no ${colorLabel}`;
    return {
      id: 'build-spire',
      label: 'BUILD  SPIRE',
      sublabel: 'click tile',
      hotkey: 'S',
      costEnergy: displayCost(s.buildCost),
      costColor: displayCost(s.buildColorCost),
      enabled,
      disabledReason: reason,
      onClick: () => this.delegate.onBuildSpireSelected(),
    };
  }

  private buildPylonSpec(fs: Sim['state']['factions'][number], colorLabel: 'blue' | 'red'): ButtonSpec {
    const s = STRUCTURE_STATS.supply;
    const energyOk = fs.energy >= s.buildCost;
    const colorOk = fs.color >= s.buildColorCost;
    const enabled = energyOk && colorOk;
    let reason: string | undefined;
    if (!energyOk) reason = 'no energy';
    else if (!colorOk) reason = `no ${colorLabel}`;
    return {
      id: 'build-pylon',
      label: 'BUILD  PYLON',
      sublabel: '+8 supply',
      hotkey: 'P',
      costEnergy: displayCost(s.buildCost),
      costColor: displayCost(s.buildColorCost),
      enabled,
      disabledReason: reason,
      onClick: () => this.delegate.onBuildPylonSelected(),
    };
  }

  private dumpSpec(fs: Sim['state']['factions'][number]): ButtonSpec {
    const energyOk = fs.energy >= DUMP_ENERGY_COST;
    return {
      id: 'dump',
      label: 'DUMP',
      sublabel: 'leaves trail',
      hotkey: 'E',
      costEnergy: displayCost(DUMP_ENERGY_COST),
      enabled: energyOk,
      disabledReason: energyOk ? undefined : 'no energy',
      onClick: () => this.delegate.onDumpSelected(),
    };
  }

  private researchTier2Spec(sim: Sim, fs: Sim['state']['factions'][number], colorLabel: 'blue' | 'red'): ButtonSpec {
    const idle = findFirstOperationalUpgrade(sim.state, this.faction);
    const fluxOk = fs.flux >= TIER2_FLUX_COST;
    const colorOk = fs.color >= TIER2_COLOR_COST;
    const enabled = idle !== null && fluxOk && colorOk && !fs.tier2Researched;
    let reason: string | undefined;
    if (fs.tier2Researched) reason = 'done';
    else if (idle === null) reason = 'spire busy';
    else if (!fluxOk) reason = 'no flux';
    else if (!colorOk) reason = `no ${colorLabel}`;
    return {
      id: 'research-tier2',
      label: 'TIER  2',
      sublabel: 'unlocks vanguard',
      hotkey: 'T',
      costFlux: displayCost(TIER2_FLUX_COST),
      costColor: displayCost(TIER2_COLOR_COST),
      enabled,
      disabledReason: reason,
      onClick: () => this.delegate.onResearchTier2Selected(),
    };
  }

  private researchTrailSpec(sim: Sim, fs: Sim['state']['factions'][number]): ButtonSpec {
    const idle = findFirstOperationalUpgrade(sim.state, this.faction);
    const fluxOk = fs.flux >= TRAIL_DURATION_FLUX_COST;
    const enabled = idle !== null && fluxOk && !fs.trailDurationResearched;
    let reason: string | undefined;
    if (fs.trailDurationResearched) reason = 'done';
    else if (idle === null) reason = 'spire busy';
    else if (!fluxOk) reason = 'no flux';
    return {
      id: 'research-trail',
      label: 'TRAIL+',
      sublabel: '2× trail life',
      hotkey: 'L',
      costFlux: displayCost(TRAIL_DURATION_FLUX_COST),
      enabled,
      disabledReason: reason,
      onClick: () => this.delegate.onResearchTrailDurationSelected(),
    };
  }

  // ----- DOM rendering -------------------------------------------------

  private renderButtons(specs: ButtonSpec[]): void {
    this.buttonContainer.innerHTML = '';
    if (specs.length === 0) {
      // Empty state: keep the bar visible but slim. The hint text
      // above already says what to do.
      return;
    }
    for (const spec of specs) {
      this.buttonContainer.appendChild(this.buildButton(spec));
    }
  }

  private buildButton(spec: ButtonSpec): HTMLButtonElement {
    const tint = FACTION_TINT[this.faction];
    const tintDim = FACTION_TINT_DIM[this.faction];
    const btn = document.createElement('button');
    btn.disabled = !spec.enabled;
    if (spec.disabledReason) btn.title = spec.disabledReason;
    btn.style.cssText = [
      'position:relative',
      'background:transparent',
      `border:1px solid ${spec.enabled ? tint : 'rgba(154,170,180,0.25)'}`,
      `color:${spec.enabled ? tint : 'rgba(154,170,180,0.55)'}`,
      'padding:10px 14px 12px',
      'min-width:104px', 'min-height:54px',
      'font-family:ui-monospace,Menlo,monospace',
      'cursor:' + (spec.enabled ? 'pointer' : 'not-allowed'),
      'opacity:' + (spec.enabled ? '1' : '0.7'),
      'transition:background 0.15s, box-shadow 0.15s',
      'box-shadow:' + (spec.enabled ? `0 0 6px ${tintDim}` : 'none'),
      'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:4px',
    ].join(';');
    if (spec.enabled) {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = this.faction === 0
          ? 'rgba(0,229,255,0.10)'
          : 'rgba(255,106,51,0.10)';
        btn.style.boxShadow = `0 0 16px ${tint}`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.boxShadow = `0 0 6px ${tintDim}`;
      });
    }
    btn.addEventListener('click', () => {
      if (!spec.enabled) return;
      spec.onClick();
    });

    // Hotkey badge — top-right corner, small.
    if (spec.hotkey) {
      const hk = document.createElement('span');
      hk.textContent = spec.hotkey;
      hk.style.cssText = [
        'position:absolute', 'top:3px', 'right:5px',
        'font-size:9px', 'letter-spacing:0.1em',
        `color:${spec.enabled ? tint : 'rgba(154,170,180,0.45)'}`,
        'opacity:0.65',
      ].join(';');
      btn.appendChild(hk);
    }

    const label = document.createElement('div');
    label.textContent = spec.label;
    label.style.cssText = 'font-size:11px;letter-spacing:0.18em;font-weight:600';
    btn.appendChild(label);

    if (spec.sublabel) {
      const sub = document.createElement('div');
      sub.textContent = spec.sublabel;
      sub.style.cssText = [
        'font-size:9px', 'letter-spacing:0.12em',
        'color:rgba(154,170,180,0.55)',
      ].join(';');
      btn.appendChild(sub);
    }

    const costRow = document.createElement('div');
    costRow.style.cssText = 'display:flex;gap:6px;margin-top:2px;font-size:10px;letter-spacing:0.06em';
    if (spec.costEnergy !== undefined) costRow.appendChild(this.costGlyph('E', spec.costEnergy, '#ffd166'));
    if (spec.costFlux !== undefined) costRow.appendChild(this.costGlyph('F', spec.costFlux, '#a3ff66'));
    if (spec.costColor !== undefined) costRow.appendChild(this.costGlyph('C', spec.costColor, FACTION_TINT[this.faction]));
    btn.appendChild(costRow);

    return btn;
  }

  private costGlyph(letter: string, value: number, color: string): HTMLSpanElement {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:2px';
    const g = document.createElement('span');
    g.textContent = letter;
    g.style.cssText = `color:${color};font-weight:700;opacity:0.85`;
    wrap.appendChild(g);
    const v = document.createElement('span');
    v.textContent = String(value);
    v.style.cssText = 'opacity:0.85';
    wrap.appendChild(v);
    return wrap;
  }
}

interface SelectionContext {
  kind: 'hq' | 'workers' | 'forge' | 'spire' | 'pylon' | 'mixed' | 'none';
  hint: string;
  workerCount?: number;
  structureId?: number;
}
