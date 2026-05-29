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
import { MAX_TRAIN_QUEUE, RESEARCH_AUTO_RESUME_COST, RESEARCH_AUTO_RESUME_TICKS, STRUCTURE_STATS, canAfford, unitStatsFor, type ResourceCost } from '../sim/units-config';
import { findStructure, findUnit, isFullyExplored } from '../sim/state';
import { isInChargeMode } from '../sim/step';
import { themeForFaction, RESOURCE_COLOR } from './factions/theme';
import { hudIconSvg, type HudIconName } from './hud-icons';

const displayCost = (f: Fixed): number => Math.round(toFloat(f));
// Phase D.1: pull a single resource amount out of a cost bag for the badge
// (undefined when that resource isn't part of the cost → no badge drawn).
const costAmount = (cost: ResourceCost, key: 'energy' | 'matter'): number | undefined => {
  const f = cost[key];
  return f === undefined ? undefined : displayCost(f);
};

// Phase C.2: SC2-style command card — a fixed 3-wide grid of icon tiles so
// the bar never resizes to fit its text and actions read as buttons, not
// labels. Empty slots render as dim grid cells.
const GRID_COLS = 3;
const TILE_PX = 64;

// A render-ready view of the HQ production queue (head progress + how many
// units are waiting). Null whenever the HQ isn't the active selection or
// nothing is queued.
interface QueueView {
  count: number;
  headFraction: number; // 0..1 production progress of the in-build head
}

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
  // Phase C.6.9: send the selected worker(s) scouting — reveal fog toward
  // the nearest frontier. Auto-targets in the sim; no placement step.
  onScoutSelected(): void;
}

interface ButtonSpec {
  id: string;
  label: string;
  icon: HudIconName;
  hotkey?: string;
  costEnergy?: number;
  // Phase D.1: matter cost badge (violet), shown beneath the energy badge
  // when the action also costs matter (e.g. the work pod).
  costMatter?: number;
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
  private readonly queueStrip: HTMLDivElement;
  private readonly buttonContainer: HTMLDivElement;
  // Separate skip-keys so the queue strip (advances every tick) doesn't
  // force the command-card tiles to rebuild every frame during production.
  private currentHint = '';
  private currentTilesKey = '';
  private currentQueueKey = '';

  constructor(faction: Faction, delegate: ActionBarDelegate, root: HTMLElement) {
    this.faction = faction;
    this.delegate = delegate;

    // Bottom-centre command area (SC2 model: portrait bottom-left, command
    // card bottom-centre). Fixed-width grid below, so the card never
    // reflows as the selection changes.
    this.bar = document.createElement('div');
    this.bar.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:18px', 'transform:translateX(-50%)',
      'z-index:8',
      'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:6px',
      'font-family:ui-monospace,Menlo,monospace',
      'pointer-events:auto',
    ].join(';');

    this.hint = document.createElement('div');
    this.hint.style.cssText = [
      'font-size:10px', 'letter-spacing:0.32em',
      'color:rgba(154,170,180,0.7)',
      'min-height:14px', 'text-align:center',
    ].join(';');
    this.bar.appendChild(this.hint);

    // Production-queue strip (only visible when the HQ has a queue).
    this.queueStrip = document.createElement('div');
    this.queueStrip.style.cssText = [
      'display:none', 'flex-direction:row', 'gap:5px',
      'align-items:center', 'justify-content:center', 'min-height:0',
    ].join(';');
    this.bar.appendChild(this.queueStrip);

    this.buttonContainer = document.createElement('div');
    this.buttonContainer.style.cssText = [
      'display:grid', `grid-template-columns:repeat(${GRID_COLS},${TILE_PX}px)`,
      'gap:8px',
      'background:rgba(7,9,12,0.82)',
      'padding:10px',
      `border:1px solid ${FACTION_TINT_DIM[faction]}`,
      'border-radius:6px',
      `box-shadow:0 0 14px ${FACTION_TINT_DIM[faction]}`,
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
    selectedNodeId: number | null = null,
  ): void {
    const { hint, specs, queue } = this.computeView(sim, selectedUnitIds, selectedStructureId, selectedHqFaction, selectedNodeId);

    if (hint !== this.currentHint) {
      this.currentHint = hint;
      this.hint.textContent = hint;
    }

    // Tiles rebuild only when the action set changes. The label is in the
    // key so the in-progress research tile's countdown still repaints;
    // the queue progress is deliberately NOT here so a producing HQ
    // doesn't churn the command-card buttons (+ flicker hover) each tick.
    const tilesKey = specs.map((s) =>
      `${s.id}:${s.enabled ? '1' : '0'}:${s.disabledReason ?? ''}:${s.label}`
    ).join('/');
    if (tilesKey !== this.currentTilesKey) {
      this.currentTilesKey = tilesKey;
      this.renderTiles(specs);
    }

    // Queue strip advances each tick the head progresses.
    const queueKey = queue === null ? '' : `${queue.count}:${Math.round(queue.headFraction * 100)}`;
    if (queueKey !== this.currentQueueKey) {
      this.currentQueueKey = queueKey;
      this.renderQueue(queue);
    }
  }

  private computeView(
    sim: Sim,
    selectedUnitIds: ReadonlySet<number>,
    selectedStructureId: number | null,
    selectedHqFaction: Faction | null,
    selectedNodeId: number | null,
  ): { hint: string; specs: ButtonSpec[]; queue: QueueView | null } {
    const fs = sim.state.factions[this.faction];

    // Nodes have no actions today — short-circuit so the hint doesn't
    // fall through to "SELECT YOUR HQ OR A WORKER" while a node is
    // clearly selected on screen. The portrait sub-text carries the
    // node readout.
    if (selectedNodeId !== null) {
      return { hint: '', specs: [], queue: null };
    }

    // 1. HQ selected → TRAIN WORKER + cap meter in the hint.
    if (selectedHqFaction === this.faction) {
      const factionId = fs.factionId;
      const stats = unitStatsFor(factionId, 'worker');
      const queued = fs.trainQueue.length;
      const energyOk = canAfford(fs, stats.trainCost);
      // Phase C.2: the cap counts queued units too (matches the sim
      // reservation gate), and the queue itself is bounded.
      const capOk = (fs.supplyUsed + queued) < fs.supplyCap;
      const queueOk = queued < MAX_TRAIN_QUEUE;
      const enabled = energyOk && capOk && queueOk;
      let reason: string | undefined;
      if (!queueOk) reason = 'queue full';
      else if (!capOk) reason = 'cap reached';
      else if (!energyOk) reason = 'no energy';
      const headTotal = queued > 0 ? unitStatsFor(factionId, fs.trainQueue[0].kind).trainTicks : 0;
      const queue: QueueView | null = queued > 0
        ? { count: queued, headFraction: headTotal > 0 ? (headTotal - fs.trainTicksRemaining) / headTotal : 1 }
        : null;
      return {
        hint: `HQ  ·  ${fs.supplyUsed}/${fs.supplyCap}`,
        specs: [{
          id: 'train-worker',
          label: 'TRAIN WORKER',
          icon: 'worker',
          hotkey: 'W',
          costEnergy: costAmount(stats.trainCost, 'energy'),
          costMatter: costAmount(stats.trainCost, 'matter'),
          enabled,
          disabledReason: reason,
          onClick: () => this.delegate.onTrainKindSelected('worker'),
        }],
        queue,
      };
    }

    // 2. Work pod selected → research action / status.
    if (selectedStructureId !== null) {
      const s = findStructure(sim.state, selectedStructureId);
      if (s && s.faction === this.faction && s.kind === 'workPod') {
        const op = s.buildTicksRemaining === 0;
        if (!op) {
          return { hint: 'WORK  POD  ·  BUILDING', specs: [], queue: null };
        }
        const specs: ButtonSpec[] = [];
        // Auto-resume research: tile when idle + not done; status tile
        // when in progress; nothing once complete (info is in the hint).
        if (fs.autoResumeResearched) {
          // Researched — info only; another slot will land here once
          // the second research item exists.
        } else if (fs.researchingKind === 'autoResume') {
          // Mid-research. Show a disabled tile with the remaining
          // seconds so the player can see progress without scraping
          // sim state.
          const secs = Math.ceil(fs.researchTicksRemaining / 20);
          specs.push({
            id: 'research-auto-resume',
            label: `RESEARCHING ${secs}s`,
            icon: 'research',
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
            label: 'AUTO-RESUME',
            icon: 'research',
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
        return { hint, specs, queue: null };
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
      const specs: ButtonSpec[] = [];

      // Build work pod (Phase D.1: costs energy + matter).
      const podStats = STRUCTURE_STATS.workPod;
      const podCostOk = canAfford(fs, podStats.buildCost);
      // Distinguish which resource is short so the tooltip is actionable.
      const podEnergyShort = podStats.buildCost.energy !== undefined && fs.energy < podStats.buildCost.energy;
      const podMatterShort = podStats.buildCost.matter !== undefined && fs.matter < podStats.buildCost.matter;
      let podReason: string | undefined;
      if (!workerActionable) podReason = 'worker needs charge';
      else if (podEnergyShort && podMatterShort) podReason = 'no energy or matter';
      else if (podMatterShort) podReason = 'no matter';
      else if (podEnergyShort) podReason = 'no energy';
      specs.push({
        id: 'build-work-pod',
        label: 'BUILD WORK POD',
        icon: 'pod',
        hotkey: 'B',
        costEnergy: costAmount(podStats.buildCost, 'energy'),
        costMatter: costAmount(podStats.buildCost, 'matter'),
        enabled: podCostOk && workerActionable,
        disabledReason: podReason,
        onClick: () => this.delegate.onBuildWorkPodSelected(),
      });

      // Phase C.6.9: scout — reveal fog toward the nearest frontier. Costs
      // one charge (no energy), so no cost badge. Greys out when the
      // faction's map is already fully revealed (nothing left to scout).
      const fullyExplored = isFullyExplored(sim.state, this.faction);
      let scoutReason: string | undefined;
      if (!workerActionable) scoutReason = 'worker needs charge';
      else if (fullyExplored) scoutReason = 'map revealed';
      specs.push({
        id: 'scout',
        label: 'SCOUT',
        icon: 'scout',
        hotkey: 'E',
        enabled: workerActionable && !fullyExplored,
        disabledReason: scoutReason,
        onClick: () => this.delegate.onScoutSelected(),
      });

      return { hint: 'WORKER', specs, queue: null };
    }

    return { hint: 'SELECT  YOUR  HQ  OR  A  WORKER', specs: [], queue: null };
  }

  // Production-queue strip — one cell per queued worker; the head cell
  // carries a thin production-progress bar that advances each tick.
  private renderQueue(queue: QueueView | null): void {
    this.queueStrip.innerHTML = '';
    if (queue === null) {
      this.queueStrip.style.display = 'none';
      return;
    }
    this.queueStrip.style.display = 'flex';
    const tint = FACTION_TINT[this.faction];
    for (let i = 0; i < queue.count; i++) {
      const head = i === 0;
      const cell = document.createElement('div');
      cell.style.cssText = [
        'position:relative', 'width:24px', 'height:24px', 'box-sizing:border-box',
        'display:flex', 'align-items:center', 'justify-content:center',
        'border-radius:3px', 'background:rgba(7,9,12,0.85)', 'overflow:hidden',
        `border:1px solid ${head ? tint : FACTION_TINT_DIM[this.faction]}`,
        `color:${head ? tint : 'rgba(154,170,180,0.65)'}`, 'line-height:0',
      ].join(';');
      cell.innerHTML = hudIconSvg('worker', 14);
      if (head) {
        const bar = document.createElement('div');
        const pct = Math.max(0, Math.min(1, queue.headFraction)) * 100;
        bar.style.cssText = [
          'position:absolute', 'left:0', 'bottom:0', 'height:3px',
          `width:${pct}%`, `background:${tint}`,
        ].join(';');
        cell.appendChild(bar);
      }
      this.queueStrip.appendChild(cell);
    }
  }

  private renderTiles(specs: ButtonSpec[]): void {
    this.buttonContainer.innerHTML = '';
    // Always fill a whole number of GRID_COLS-wide rows (min one) so the
    // card footprint never changes as the selection changes — empty slots
    // render as dim cells.
    const cells = Math.max(GRID_COLS, Math.ceil(specs.length / GRID_COLS) * GRID_COLS);
    for (let i = 0; i < cells; i++) {
      const spec = specs[i];
      this.buttonContainer.appendChild(spec ? this.makeTile(spec) : makeEmptyCell());
    }
  }

  private makeTile(spec: ButtonSpec): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.disabled = !spec.enabled;
    const accent = spec.enabled ? FACTION_TINT[this.faction] : FACTION_TINT_DIM[this.faction];
    btn.style.cssText = [
      `width:${TILE_PX}px`, `height:${TILE_PX}px`, 'box-sizing:border-box',
      'position:relative',
      'background:rgba(13,17,22,0.95)',
      `border:1px solid ${accent}`,
      'border-radius:5px',
      'padding:5px 3px 4px',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:2px',
      'color:rgba(216,232,240,0.95)',
      'font-family:ui-monospace,Menlo,monospace',
      `cursor:${spec.enabled ? 'pointer' : 'not-allowed'}`,
      `opacity:${spec.enabled ? '1' : '0.45'}`,
      `box-shadow:${spec.enabled ? `0 0 8px ${FACTION_TINT_DIM[this.faction]}` : 'none'}`,
    ].join(';');

    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = `color:${accent};line-height:0;`;
    iconWrap.innerHTML = hudIconSvg(spec.icon, 26);
    btn.appendChild(iconWrap);

    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'font-size:7px;letter-spacing:0.06em;font-weight:600;text-align:center;line-height:1.1;';
    labelRow.textContent = spec.label;
    btn.appendChild(labelRow);

    if (spec.hotkey) {
      const hk = document.createElement('div');
      hk.style.cssText = 'position:absolute;top:2px;left:3px;font-size:8px;font-weight:700;color:rgba(154,170,180,0.85);';
      hk.textContent = spec.hotkey;
      btn.appendChild(hk);
    }
    if (spec.costEnergy !== undefined) {
      const cost = document.createElement('div');
      cost.style.cssText = 'position:absolute;top:2px;right:3px;font-size:8px;font-weight:700;color:#ffd166;';
      cost.textContent = `${spec.costEnergy}`;
      btn.appendChild(cost);
    }
    // Phase D.1: matter cost badge (matter colour), stacked just under the
    // energy badge so a dual-cost action (the work pod) shows both at a glance.
    if (spec.costMatter !== undefined) {
      const m = document.createElement('div');
      m.style.cssText = `position:absolute;top:12px;right:3px;font-size:8px;font-weight:700;color:${RESOURCE_COLOR.matter};`;
      m.textContent = `${spec.costMatter}`;
      btn.appendChild(m);
    }
    if (!spec.enabled && spec.disabledReason) btn.title = spec.disabledReason;
    btn.addEventListener('click', () => spec.onClick());
    return btn;
  }
}

// A dim, empty command-card slot — keeps the grid a fixed size regardless
// of how many actions the current selection offers.
function makeEmptyCell(): HTMLDivElement {
  const cell = document.createElement('div');
  cell.style.cssText = [
    `width:${TILE_PX}px`, `height:${TILE_PX}px`, 'box-sizing:border-box',
    'border-radius:5px',
    'border:1px solid rgba(80,96,108,0.18)',
    'background:rgba(13,17,22,0.45)',
  ].join(';');
  return cell;
}
