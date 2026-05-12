// Phase A — Context-sensitive in-game action bar (stripped surface).
//
// Phase A retains the action bar shell + the TRAIN WORKER button when
// the HQ is selected. All other actions (combat training, structure
// building, research, energy dump) are out until they return via the
// new tech tree (docs/plan.md Phase C+). The delegate interface keeps
// its full shape for back-compat with the input controller; the now-
// unused callbacks remain as no-op declarations until the input layer
// drops them too.

import type { Faction, UnitKind } from '../sim/types';
import type { Sim } from '../sim/sim';
import { toFloat, type Fixed } from '../sim/fixed';
import { RESEARCH_AUTO_RESUME_COST, RESEARCH_AUTO_RESUME_TICKS, STRUCTURE_STATS, unitStatsFor } from '../sim/units-config';
import { findStructure, findUnit } from '../sim/state';
import { isInChargeMode } from '../sim/step';
import { themeForFaction } from './factions/theme';

const displayCost = (f: Fixed): number => Math.round(toFloat(f));

export interface ActionBarDelegate {
  onTrainKindSelected(kind: UnitKind): void;
  onBuildForgeSelected(): void;
  onBuildSpireSelected(): void;
  onBuildPylonSelected(): void;
  onResearchTier2Selected(): void;
  onResearchTrailDurationSelected(): void;
  onDumpSelected(): void;
  // Phase C.1: enter placement mode for a work pod. The next left-click
  // commits a BuildStructureByWorker command paid for by the first
  // selected actionable worker.
  onBuildWorkPodSelected(): void;
  // Phase C.1 research: kick off auto-resume research at the currently
  // selected work pod. The input controller turns the selection +
  // delegate call into a StartResearchAtPod command for the sim.
  onResearchAutoResumeSelected(): void;
}

interface ButtonSpec {
  id: string;
  label: string;
  hotkey?: string;
  costEnergy?: number;
  enabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}

const FACTION_TINT: Record<Faction, string> = {
  0: themeForFaction(0).primary,
  1: themeForFaction(1).primary,
};

const FACTION_TINT_DIM: Record<Faction, string> = {
  0: themeForFaction(0).glow,
  1: themeForFaction(1).glow,
};

export class ActionBar {
  private readonly faction: Faction;
  private readonly delegate: ActionBarDelegate;
  private readonly bar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly buttonContainer: HTMLDivElement;
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
    const { hint, specs } = this.computeView(sim, selectedUnitIds, selectedStructureId, selectedHqFaction);
    // Refresh-skip key must include the label too — the in-progress
    // research button paints its label as `RESEARCHING (Xs)` and the
    // seconds tick down each frame. Without the label in the key,
    // refresh() short-circuits and the counter freezes.
    const key = hint + '|' + specs.map((s) =>
      `${s.id}:${s.enabled ? '1' : '0'}:${s.disabledReason ?? ''}:${s.label}`
    ).join('/');
    if (key === this.currentSpecKey) return;
    this.currentSpecKey = key;
    this.hint.textContent = hint;
    this.renderButtons(specs);
  }

  private computeView(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
  ): { hint: string; specs: ButtonSpec[] } {
    const fs = sim.state.factions[this.faction];

    // 1. HQ selected → TRAIN WORKER + cap meter in the hint.
    if (selectedHqFaction === this.faction) {
      const factionId = fs.factionId;
      const stats = unitStatsFor(factionId, 'worker');
      const energyOk = fs.energy >= stats.trainCost;
      const capOk = fs.supplyUsed < fs.supplyCap;
      const enabled = energyOk && capOk;
      let reason: string | undefined;
      if (!capOk) reason = 'cap reached';
      else if (!energyOk) reason = 'no energy';
      return {
        hint: `HQ  ·  ${fs.supplyUsed}/${fs.supplyCap}`,
        specs: [{
          id: 'train-worker',
          label: 'TRAIN  WORKER',
          hotkey: 'W',
          costEnergy: displayCost(stats.trainCost),
          enabled,
          disabledReason: reason,
          onClick: () => this.delegate.onTrainKindSelected('worker'),
        }],
      };
    }

    // 2. Work pod selected → research action / status.
    if (selectedStructureId !== null) {
      const s = findStructure(sim.state, selectedStructureId);
      if (s && s.faction === this.faction && s.kind === 'workPod') {
        const op = s.buildTicksRemaining === 0;
        if (!op) {
          return { hint: 'WORK  POD  ·  BUILDING', specs: [] };
        }
        const specs: ButtonSpec[] = [];
        // Auto-resume research: button when idle + not done; status
        // when in progress; "active" label when complete.
        if (fs.autoResumeResearched) {
          // Researched — info only; another slot will land here once
          // the second research item exists.
        } else if (fs.researchingKind === 'autoResume') {
          // Mid-research. Show a disabled button with the remaining
          // seconds so the player can see progress without scraping
          // sim state.
          const secs = Math.ceil(fs.researchTicksRemaining / 20);
          specs.push({
            id: 'research-auto-resume',
            label: `RESEARCHING  (${secs}s)`,
            enabled: false,
            disabledReason: 'in progress',
            onClick: () => { /* no-op while mid-research */ },
          });
        } else {
          const energyOk = fs.energy >= RESEARCH_AUTO_RESUME_COST;
          const busy = fs.researchingKind !== null;
          const enabled = energyOk && !busy;
          let reason: string | undefined;
          if (busy) reason = 'another research in progress';
          else if (!energyOk) reason = 'no energy';
          specs.push({
            id: 'research-auto-resume',
            label: 'RESEARCH  AUTO-RESUME',
            hotkey: 'R',
            costEnergy: displayCost(RESEARCH_AUTO_RESUME_COST),
            enabled,
            disabledReason: reason,
            onClick: () => this.delegate.onResearchAutoResumeSelected(),
          });
        }
        const hint = fs.autoResumeResearched
          ? 'WORK  POD  ·  AUTO-RESUME  ACTIVE'
          : `WORK  POD  ·  +5  CAP  ·  CHARGE  BAY`;
        return { hint, specs };
      }
    }
    // Reference the duration constant so the import isn't dead — surfaces
    // when (later) the research bar tooltip wants to read it.
    void RESEARCH_AUTO_RESUME_TICKS;

    // 3. Worker(s) selected → BUILD WORK POD.
    let workerSelected = false;
    let workerActionable = false;
    for (const id of selectedUnitIds) {
      const u = findUnit(sim.state, id);
      if (!u || u.kind !== 'worker') continue;
      if (u.faction !== this.faction) continue;
      workerSelected = true;
      if (!isInChargeMode(u) && u.charge >= 1) workerActionable = true;
    }
    if (workerSelected) {
      const podStats = STRUCTURE_STATS.workPod;
      const energyOk = fs.energy >= podStats.buildCost;
      const enabled = energyOk && workerActionable;
      let reason: string | undefined;
      if (!workerActionable) reason = 'worker needs charge';
      else if (!energyOk) reason = 'no energy';
      return {
        hint: 'WORKER',
        specs: [{
          id: 'build-work-pod',
          label: 'BUILD  WORK  POD',
          hotkey: 'B',
          costEnergy: displayCost(podStats.buildCost),
          enabled,
          disabledReason: reason,
          onClick: () => this.delegate.onBuildWorkPodSelected(),
        }],
      };
    }

    return { hint: 'SELECT  YOUR  HQ  OR  A  WORKER', specs: [] };
  }

  private renderButtons(specs: ButtonSpec[]): void {
    this.buttonContainer.innerHTML = '';
    if (specs.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = [
        'font-size:10px', 'letter-spacing:0.32em',
        'color:rgba(154,170,180,0.4)',
      ].join(';');
      placeholder.textContent = 'NO  ACTIONS';
      this.buttonContainer.appendChild(placeholder);
      return;
    }
    for (const spec of specs) {
      this.buttonContainer.appendChild(this.makeButton(spec));
    }
  }

  private makeButton(spec: ButtonSpec): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.disabled = !spec.enabled;
    btn.style.cssText = [
      'background:rgba(13,17,22,0.92)',
      `border:1px solid ${spec.enabled ? FACTION_TINT[this.faction] : FACTION_TINT_DIM[this.faction]}`,
      'border-radius:4px',
      'padding:8px 12px',
      'min-width:120px', 'min-height:54px',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:4px',
      'color:rgba(216,232,240,0.92)',
      'font-family:ui-monospace,Menlo,monospace',
      `cursor:${spec.enabled ? 'pointer' : 'not-allowed'}`,
      `opacity:${spec.enabled ? '1' : '0.5'}`,
    ].join(';');

    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'font-size:13px; letter-spacing:0.18em; font-weight:600;';
    labelRow.textContent = spec.label;
    btn.appendChild(labelRow);

    if (spec.hotkey) {
      const hk = document.createElement('div');
      hk.style.cssText = 'font-size:9px; letter-spacing:0.32em; color:rgba(154,170,180,0.6);';
      hk.textContent = `[ ${spec.hotkey} ]`;
      btn.appendChild(hk);
    }
    if (spec.costEnergy !== undefined) {
      const cost = document.createElement('div');
      cost.style.cssText = 'font-size:11px; letter-spacing:0.16em; color:#ffd166;';
      cost.textContent = `E ${spec.costEnergy}`;
      btn.appendChild(cost);
    }
    if (!spec.enabled && spec.disabledReason) btn.title = spec.disabledReason;
    btn.addEventListener('click', () => spec.onClick());
    return btn;
  }
}
