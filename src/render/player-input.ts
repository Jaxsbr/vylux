// Buildables panel + match-end overlay.
//
// Clicking a button no longer queues a TrainUnit command directly.
// Instead it enters placement mode on the input controller; the player
// then clicks a tile to actually spawn the unit there. This is what
// PRD §3.8 mechanical-mastery calls "no hidden APM tax" — the click is
// the action that matters, not a deferred consequence.

import type { Faction, UnitKind } from '../sim/types';
import {
  findFirstOperationalProduction,
  findFirstOperationalUpgrade,
  findFirstUpgradeAnyState,
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

// Reused empty set for refresh() callers that don't pass a selection
// (or never have one — observer mode). Avoids allocating per frame.
const EMPTY_SELECTION: ReadonlySet<number> = new Set();

export interface BuildablesPanelDelegate {
  // Phase 3.0: WORKER stays HQ-trained. DEFENDER / RAIDER / VANGUARD
  // route through a production building; the controller picks the
  // structure target.
  onTrainKindSelected(kind: UnitKind): void;
  // Phase 3.0: clicked BUILD FORGE — caller enters placement mode.
  onBuildForgeSelected(): void;
  // Phase 3.2: clicked BUILD SPIRE — placement mode for upgrade kind.
  onBuildSpireSelected(): void;
  // Phase 3.6: clicked BUILD PYLON — placement mode for supply kind.
  onBuildPylonSelected(): void;
  // Phase 3.2: clicked RESEARCH TIER 2 — controller emits the
  // ResearchTier2AtStructure command targeting the player's first
  // operational, idle Spire.
  onResearchTier2Selected(): void;
  // Phase 3.7: clicked DUMP — controller fans out one
  // ActivateEnergyDump command per selected dumpable worker.
  onDumpSelected(): void;
  // Phase 3.7: clicked TRAIL DURATION — researches at the first idle
  // Spire (same shape as the tier-2 button).
  onResearchTrailDurationSelected(): void;
}

export class BuildablesPanel {
  private readonly faction: Faction;
  private readonly delegate: BuildablesPanelDelegate;
  private readonly panel: HTMLDivElement;
  private readonly unitButtons = new Map<UnitKind, HTMLButtonElement>();
  private buildForgeButton: HTMLButtonElement | null = null;
  private buildSpireButton: HTMLButtonElement | null = null;
  private buildPylonButton: HTMLButtonElement | null = null;
  private researchTier2Button: HTMLButtonElement | null = null;
  private researchTrailDurationButton: HTMLButtonElement | null = null;
  private dumpButton: HTMLButtonElement | null = null;

  constructor(faction: Faction, delegate: BuildablesPanelDelegate, root: HTMLElement) {
    this.faction = faction;
    this.delegate = delegate;
    this.panel = this.buildPanel();
    root.appendChild(this.panel);
  }

  // Reflect current affordability + structure-availability on the
  // buttons (greys out unaffordable / unavailable options). Called
  // from the render loop, cheap enough to run every frame.
  refresh(sim: Sim, selectedUnitIds: ReadonlySet<number> = EMPTY_SELECTION): void {
    const fs = sim.state.factions[this.faction];
    const energy = fs.energy;
    const flux = fs.flux;
    const color = fs.color;
    const colorLabel = FACTION_COLOR[this.faction]; // 'blue' | 'red'
    const operationalForge = findFirstOperationalProduction(sim.state, this.faction);
    const forgeBusy = operationalForge !== null && operationalForge.trainingKind !== null;
    const idleSpire = findFirstOperationalUpgrade(sim.state, this.faction);
    const anySpire = findFirstUpgradeAnyState(sim.state, this.faction);

    for (const [kind, btn] of this.unitButtons) {
      const stats = UNIT_STATS[kind];
      const affordableEnergy = energy >= stats.trainCost;
      const affordableFlux = flux >= stats.trainFluxCost;
      const affordableColor = color >= stats.trainColorCost;
      const supplyOk = fs.supplyUsed + stats.supplyCost <= fs.supplyCap;
      let enabled = affordableEnergy && affordableFlux && affordableColor && supplyOk;
      let blockedReason = '';

      // Combat units route through a Forge in 3.0; worker stays at HQ.
      if (kind !== 'worker') {
        if (operationalForge === null) {
          enabled = false;
          blockedReason = 'no forge';
        } else if (forgeBusy) {
          enabled = false;
          blockedReason = 'forge busy';
        }
      }
      // Phase 3.2: tier-2 units gate on faction-level research too.
      if (stats.requiresTier2 && !fs.tier2Researched) {
        enabled = false;
        blockedReason = 'tier 2 not researched';
      }
      if (!affordableFlux && enabled === false && blockedReason === '') {
        blockedReason = 'no flux';
      }
      // Phase 3.5: colour reason takes priority when no other block
      // applies — surfacing "no blue" / "no red" makes the lockout-
      // by-denial mechanic legible.
      if (!affordableColor && blockedReason === '') {
        blockedReason = `no ${colorLabel}`;
      }
      // Phase 3.6: supply reason. Lowest priority — every other block
      // surfaces first because they're more actionable.
      if (!supplyOk && blockedReason === '') {
        blockedReason = 'supply blocked';
      }

      btn.disabled = !enabled;
      btn.style.opacity = enabled ? '1' : '0.45';
      btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
      const reasonEl = btn.querySelector<HTMLDivElement>('[data-reason]');
      if (reasonEl !== null) reasonEl.textContent = blockedReason;
    }

    if (this.buildForgeButton !== null) {
      const affordableEnergy = energy >= STRUCTURE_STATS.production.buildCost;
      const affordableColor = color >= STRUCTURE_STATS.production.buildColorCost;
      const enabled = affordableEnergy && affordableColor;
      this.buildForgeButton.disabled = !enabled;
      this.buildForgeButton.style.opacity = enabled ? '1' : '0.45';
      this.buildForgeButton.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    if (this.buildSpireButton !== null) {
      // Single-spire-per-match in 3.2; the AI commits to the same rule.
      const affordableEnergy = energy >= STRUCTURE_STATS.upgrade.buildCost;
      const affordableColor = color >= STRUCTURE_STATS.upgrade.buildColorCost;
      const alreadyHave = anySpire !== null;
      const enabled = affordableEnergy && affordableColor && !alreadyHave && !fs.tier2Researched;
      this.buildSpireButton.disabled = !enabled;
      this.buildSpireButton.style.opacity = enabled ? '1' : '0.45';
      this.buildSpireButton.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    if (this.buildPylonButton !== null) {
      const affordableEnergy = energy >= STRUCTURE_STATS.supply.buildCost;
      const affordableColor = color >= STRUCTURE_STATS.supply.buildColorCost;
      const enabled = affordableEnergy && affordableColor;
      this.buildPylonButton.disabled = !enabled;
      this.buildPylonButton.style.opacity = enabled ? '1' : '0.45';
      this.buildPylonButton.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    if (this.researchTier2Button !== null) {
      const affordableFlux = flux >= TIER2_FLUX_COST;
      const affordableColor = color >= TIER2_COLOR_COST;
      const enabled = idleSpire !== null && affordableFlux && affordableColor && !fs.tier2Researched;
      this.researchTier2Button.disabled = !enabled;
      this.researchTier2Button.style.opacity = enabled ? '1' : '0.45';
      this.researchTier2Button.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    // Phase 3.7: TRAIL DURATION research — same shape as TIER 2 but
    // gates on its own faction-level flag.
    if (this.researchTrailDurationButton !== null) {
      const affordableFlux = flux >= TRAIL_DURATION_FLUX_COST;
      const enabled = idleSpire !== null && affordableFlux && !fs.trailDurationResearched;
      this.researchTrailDurationButton.disabled = !enabled;
      this.researchTrailDurationButton.style.opacity = enabled ? '1' : '0.45';
      this.researchTrailDurationButton.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    // Phase 3.7: DUMP — enabled when at least one selected unit is a
    // player-owned, alive worker that's not currently dumping nor on
    // cooldown, and the faction can afford the dump cost. Cheap to
    // re-evaluate every frame for the small selection sizes the game
    // produces.
    if (this.dumpButton !== null) {
      let canDumpAny = false;
      if (energy >= DUMP_ENERGY_COST) {
        for (const id of selectedUnitIds) {
          const u = sim.state.units.find((x) => x.id === id);
          if (!u || !u.alive) continue;
          if (u.faction !== this.faction) continue;
          if (u.kind !== 'worker') continue;
          if (u.dumpTicksRemaining > 0) continue;
          if (u.dumpCooldownTicks > 0) continue;
          canDumpAny = true;
          break;
        }
      }
      this.dumpButton.disabled = !canDumpAny;
      this.dumpButton.style.opacity = canDumpAny ? '1' : '0.45';
      this.dumpButton.style.cursor = canDumpAny ? 'pointer' : 'not-allowed';
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

    const kinds: UnitKind[] = ['worker', 'defender', 'raider', 'vanguard'];
    for (const kind of kinds) {
      const btn = this.buildUnitButton(kind);
      panel.appendChild(btn);
      this.unitButtons.set(kind, btn);
    }

    // Structure-placement + research actions, separated visually so
    // they read as base-management rather than unit-train.
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;background:#345;margin:0 4px';
    panel.appendChild(sep);

    const forgeBtn = this.buildForgeButtonEl();
    panel.appendChild(forgeBtn);
    this.buildForgeButton = forgeBtn;

    const spireBtn = this.buildSpireButtonEl();
    panel.appendChild(spireBtn);
    this.buildSpireButton = spireBtn;

    const pylonBtn = this.buildPylonButtonEl();
    panel.appendChild(pylonBtn);
    this.buildPylonButton = pylonBtn;

    const researchBtn = this.buildResearchTier2ButtonEl();
    panel.appendChild(researchBtn);
    this.researchTier2Button = researchBtn;

    const trailBtn = this.buildResearchTrailDurationButtonEl();
    panel.appendChild(trailBtn);
    this.researchTrailDurationButton = trailBtn;

    const dumpBtn = this.buildDumpButtonEl();
    panel.appendChild(dumpBtn);
    this.dumpButton = dumpBtn;

    return panel;
  }

  private buildUnitButton(kind: UnitKind): HTMLButtonElement {
    const btn = document.createElement('button');
    const stats = UNIT_STATS[kind];
    const energyCost = stats.trainCost / 65536;
    const fluxCost = stats.trainFluxCost / 65536;
    const costLine = fluxCost > 0
      ? `${energyCost.toFixed(0)} e + ${fluxCost.toFixed(0)} f`
      : `${energyCost.toFixed(0)} energy`;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #345', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:90px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">${kind}</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${costLine}</div>`,
      `<div data-reason style="font-size:9px;opacity:0.85;margin-top:2px;color:#fa6;letter-spacing:0.04em"></div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.delegate.onTrainKindSelected(kind);
    });
    return btn;
  }

  private buildForgeButtonEl(): HTMLButtonElement {
    const btn = document.createElement('button');
    const cost = STRUCTURE_STATS.production.buildCost / 65536;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #564', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:110px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">build forge</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${cost.toFixed(0)} energy</div>`,
      `<div style="font-size:9px;opacity:0.6;margin-top:2px">click tile to place</div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.delegate.onBuildForgeSelected();
    });
    return btn;
  }

  private buildSpireButtonEl(): HTMLButtonElement {
    const btn = document.createElement('button');
    const cost = STRUCTURE_STATS.upgrade.buildCost / 65536;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #564', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:110px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">build spire</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${cost.toFixed(0)} energy</div>`,
      `<div style="font-size:9px;opacity:0.6;margin-top:2px">click tile to place</div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.delegate.onBuildSpireSelected();
    });
    return btn;
  }

  private buildPylonButtonEl(): HTMLButtonElement {
    const btn = document.createElement('button');
    const cost = STRUCTURE_STATS.supply.buildCost / 65536;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #564', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:110px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">build pylon</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${cost.toFixed(0)} energy</div>`,
      `<div style="font-size:9px;opacity:0.6;margin-top:2px">+8 supply cap</div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.delegate.onBuildPylonSelected();
    });
    return btn;
  }

  private buildResearchTrailDurationButtonEl(): HTMLButtonElement {
    const btn = document.createElement('button');
    const cost = TRAIL_DURATION_FLUX_COST / 65536;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #564', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:110px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">trail+</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${cost.toFixed(0)} flux</div>`,
      `<div style="font-size:9px;opacity:0.6;margin-top:2px">2× trail life</div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.delegate.onResearchTrailDurationSelected();
    });
    return btn;
  }

  private buildDumpButtonEl(): HTMLButtonElement {
    const btn = document.createElement('button');
    const cost = DUMP_ENERGY_COST / 65536;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #564', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:110px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">dump (E)</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${cost.toFixed(0)} energy</div>`,
      `<div style="font-size:9px;opacity:0.6;margin-top:2px">leaves deadly trail</div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.delegate.onDumpSelected();
    });
    return btn;
  }

  private buildResearchTier2ButtonEl(): HTMLButtonElement {
    const btn = document.createElement('button');
    const cost = TIER2_FLUX_COST / 65536;
    btn.style.cssText = [
      'padding:8px 14px',
      'background:#0e1218', 'color:#cde',
      'border:1px solid #564', 'border-radius:4px',
      'font-family:inherit', 'font-size:11px',
      'cursor:pointer', 'min-width:110px',
    ].join(';');
    btn.innerHTML = [
      `<div style="font-weight:600;text-transform:uppercase;color:${factionColorCss(this.faction)}">tier 2</div>`,
      `<div style="font-size:10px;opacity:0.75;margin-top:2px">${cost.toFixed(0)} flux</div>`,
      `<div style="font-size:9px;opacity:0.6;margin-top:2px">research at spire</div>`,
    ].join('');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      this.delegate.onResearchTier2Selected();
    });
    return btn;
  }
}

function factionColorCss(faction: Faction): string {
  return faction === 0 ? '#00e5ff' : '#ff6a33';
}

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
