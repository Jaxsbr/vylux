// Phase C.6 — tutorial runtime.
//
// Drives the two-phase sandbox: a GUIDED phase that walks the player through
// each gesture with an animated coach bubble, then a GRADUATION phase with
// three completion goals (energy balance / worker count / find the enemy HQ).
// All three goals met → a TUTORIAL COMPLETE overlay → back to the menu.
//
// Render-side only: it *reads* sim + input + exploration state and never
// mutates the deterministic sim, so the hash (and the golden fixtures) stay
// untouched. The step + goal logic lives in the DOM-free `tutorial-steps`
// module; this file is the wiring (assemble the per-frame ctx, advance the
// machine, own the DOM).

import type { Camera } from 'three';
import { toFloat } from '../../sim/fixed';
import type { Sim } from '../../sim/sim';
import { findStructure, findUnit } from '../../sim/state';
import type { Faction } from '../../sim/types';
import type { AudioManager } from '../../audio/audio-manager';
import type { Exploration } from '../exploration';
import type { InputController } from '../input-controller';
import { themeForFaction, VY_BG, VY_INK } from '../factions/theme';
import { CoachOverlay, projectTileToScreen } from './coach-overlay';
import {
  evalGoals,
  GUIDED_STEPS,
  isStepDone,
  type CoachAnchor,
  type GoalState,
  type TutorialCtx,
  type TutorialStepId,
} from './tutorial-steps';

type Phase = 'guided' | 'graduation' | 'complete';

export interface TutorialControllerOptions {
  sim: Sim;
  input: InputController;
  exploration: Exploration;
  playerFaction: Faction;
  camera: Camera;
  canvas: HTMLCanvasElement;
  audio: AudioManager;
  // Leave the tutorial — wired in main.ts to clear ?tutorial and show the
  // menu (window.location → pathname).
  onExit: () => void;
}

export class TutorialController {
  private readonly opts: TutorialControllerOptions;
  private readonly coach: CoachOverlay;
  private readonly objectives: HTMLDivElement;
  private readonly objectiveRows: { row: HTMLDivElement; mark: HTMLSpanElement; text: HTMLSpanElement }[];
  private readonly skipBtn: HTMLButtonElement;
  private readonly completeOverlay: HTMLDivElement;

  private phase: Phase = 'guided';
  private stepIndex = 0;
  private acknowledged = false;
  // Latched from the input feedback hooks (move / harvest leave only a
  // transient sim trace, so an explicit signal is more reliable than reading
  // it back out of the worker each tick).
  private didMove = false;
  private didAssignHarvest = false;

  constructor(opts: TutorialControllerOptions) {
    this.opts = opts;
    const theme = themeForFaction(opts.playerFaction);

    this.coach = new CoachOverlay(opts.playerFaction);

    // Objectives panel (top-left, shown in the graduation phase).
    this.objectives = document.createElement('div');
    this.objectives.style.cssText = [
      'position:fixed', 'top:64px', 'left:14px', 'z-index:33',
      'display:none', 'flex-direction:column', 'gap:8px',
      'padding:12px 16px',
      'background:rgba(7,9,12,0.82)',
      `border:${theme.strokeW}px solid ${theme.primary}`,
      `border-radius:${theme.radius}px`,
      `box-shadow:0 0 14px ${theme.glowSoft}`,
      'font-family:ui-monospace,Menlo,monospace', 'pointer-events:none',
    ].join(';');
    const objTitle = document.createElement('div');
    objTitle.textContent = 'OBJECTIVES';
    objTitle.style.cssText = [
      'font-size:10px', 'letter-spacing:0.3em', `color:${theme.primary}`,
      'margin-bottom:2px',
    ].join(';');
    this.objectives.appendChild(objTitle);
    this.objectiveRows = [0, 1, 2].map(() => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;color:#cde';
      const mark = document.createElement('span');
      mark.textContent = '○';
      mark.style.cssText = 'font-size:13px;width:14px;text-align:center;color:rgba(180,200,210,0.6)';
      const text = document.createElement('span');
      text.style.cssText = 'font-variant-numeric:tabular-nums';
      row.appendChild(mark);
      row.appendChild(text);
      this.objectives.appendChild(row);
      return { row, mark, text };
    });
    document.body.appendChild(this.objectives);

    // Skip button (top-right, under the mute indicator).
    this.skipBtn = document.createElement('button');
    this.skipBtn.textContent = 'SKIP TUTORIAL  ▸';
    this.skipBtn.style.cssText = [
      'position:fixed', 'top:42px', 'right:8px', 'z-index:36',
      'background:rgba(7,9,12,0.7)',
      `border:1px solid ${theme.primary}`, `border-radius:${theme.radius}px`,
      `color:${theme.primary}`, 'padding:6px 12px',
      'font-family:ui-monospace,Menlo,monospace', 'font-size:10px', 'letter-spacing:0.18em',
      'cursor:pointer',
    ].join(';');
    this.skipBtn.addEventListener('click', () => this.opts.onExit());
    document.body.appendChild(this.skipBtn);

    // Completion overlay (hidden until all goals are met).
    this.completeOverlay = this.buildCompleteOverlay(theme);
    document.body.appendChild(this.completeOverlay);

    this.showStep();
  }

  // Wired into the input feedback hooks from main.ts.
  notifyMove(): void {
    this.didMove = true;
  }
  notifyAssignHarvest(): void {
    this.didAssignHarvest = true;
  }

  // Called each render frame from main's tickHud, with the same dtMs the HUD
  // uses for its other per-frame animation.
  update(dtMs: number): void {
    this.opts.exploration.update();
    const ctx = this.buildCtx();

    if (this.phase === 'guided') {
      const step = GUIDED_STEPS[this.stepIndex];
      this.coach.setAnchor(this.anchorScreenPos(step.anchor));
      this.coach.update(dtMs);
      const done = step.ack ? this.acknowledged : isStepDone(step.id, ctx);
      if (done) this.advance();
      return;
    }

    if (this.phase === 'graduation') {
      this.renderObjectives(evalGoals(ctx));
      if (evalGoals(ctx).allMet) this.complete();
    }
  }

  // ----- test hooks (attached to __vyluxTest when ?test-hooks=1) ----------

  getPhase(): Phase {
    return this.phase;
  }
  getStepId(): TutorialStepId | null {
    return this.phase === 'guided' ? GUIDED_STEPS[this.stepIndex].id : null;
  }
  getGoalState(): GoalState {
    return evalGoals(this.buildCtx());
  }

  destroy(): void {
    this.coach.destroy();
    this.objectives.remove();
    this.skipBtn.remove();
    this.completeOverlay.remove();
  }

  // ----- internals --------------------------------------------------------

  private showStep(): void {
    const step = GUIDED_STEPS[this.stepIndex];
    this.coach.setStep({
      title: step.title,
      body: step.body,
      gesture: step.gesture,
      ack: step.ack === true,
      onAck: () => { this.acknowledged = true; },
    });
  }

  private advance(): void {
    this.acknowledged = false;
    this.stepIndex += 1;
    if (this.stepIndex >= GUIDED_STEPS.length) {
      this.enterGraduation();
    } else {
      this.showStep();
    }
  }

  private enterGraduation(): void {
    this.phase = 'graduation';
    this.coach.hide();
    this.objectives.style.display = 'flex';
  }

  private complete(): void {
    this.phase = 'complete';
    this.objectives.style.display = 'none';
    this.skipBtn.style.display = 'none';
    this.completeOverlay.style.display = 'flex';
    this.opts.audio.trainComplete();
  }

  private buildCtx(): TutorialCtx {
    const { sim, input, playerFaction, exploration } = this.opts;
    const state = sim.state;
    const fs = state.factions[playerFaction];

    let workerSelected = false;
    for (const id of input.getSelectedUnitIds()) {
      const u = findUnit(state, id);
      if (u && u.alive && u.kind === 'worker' && u.faction === playerFaction) {
        workerSelected = true;
        break;
      }
    }

    const podExists = state.structures.some((s) => s.alive && s.faction === playerFaction);

    // A friendly work pod is the current selection (the gate for the "select
    // the pod" step — research lives on the pod, not the worker).
    let podSelected = false;
    const selStructureId = input.getSelectedStructureId();
    if (selStructureId !== null) {
      const s = findStructure(state, selStructureId);
      podSelected = s !== null && s.alive && s.faction === playerFaction && s.kind === 'workPod';
    }

    // Cap reached: wait for the workers to actually *arrive* (supplyUsed, not
    // queued) so the player sees the SUPPLY pill hit 5/5 and pulse red — the
    // capacity wall the build step then answers. Also means all five workers
    // are alive + freshly charged when the build step opens, so its button is
    // never greyed waiting on a recharge.
    const atSupplyCap = fs.supplyUsed >= fs.supplyCap;

    const enemy = (1 - playerFaction) as Faction;
    const enemyFs = state.factions[enemy];
    const enemyHqFound = exploration.isPositionExplored(toFloat(enemyFs.hqX), toFloat(enemyFs.hqY));

    return {
      hqSelected: input.getSelectedHqFaction() === playerFaction,
      atSupplyCap,
      workerSelected,
      podExists,
      podSelected,
      researchActiveOrDone: fs.researchingKind === 'autoResume' || fs.autoResumeResearched,
      didMove: this.didMove,
      didAssignHarvest: this.didAssignHarvest,
      energyBalance: Math.floor(toFloat(fs.energy)),
      workerCount: fs.supplyUsed,
      enemyHqFound,
    };
  }

  private anchorScreenPos(anchor: CoachAnchor): { x: number; y: number } | null {
    if (anchor.kind === 'world') {
      const tile = this.worldTargetTile(anchor.target);
      return projectTileToScreen(tile.x, tile.y, this.opts.camera, this.opts.canvas);
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    switch (anchor.region) {
      case 'commandCard':
        return { x: w / 2, y: h - 96 };
      case 'portrait':
        return { x: 132, y: h - 92 };
      case 'resourceBar':
        return { x: w / 2, y: 44 };
      case 'minimap':
        return { x: w - 110, y: h - 110 };
    }
  }

  private worldTargetTile(
    target: 'playerHq' | 'firstWorker' | 'nearestNode' | 'enemyHq' | 'scoutPoint' | 'firstPod',
  ): { x: number; y: number } {
    const { sim, playerFaction } = this.opts;
    const state = sim.state;
    const fs = state.factions[playerFaction];
    const hq = { x: toFloat(fs.hqX), y: toFloat(fs.hqY) };
    const enemyFs = state.factions[(1 - playerFaction) as Faction];
    const enemy = { x: toFloat(enemyFs.hqX), y: toFloat(enemyFs.hqY) };

    switch (target) {
      case 'playerHq':
        return hq;
      case 'enemyHq':
        return enemy;
      case 'scoutPoint':
        // Halfway from the player HQ toward the enemy corner — a concrete
        // "go this way" target that starts the player toward the find-enemy-HQ
        // goal rather than just "move somewhere".
        return { x: hq.x + (enemy.x - hq.x) * 0.5, y: hq.y + (enemy.y - hq.y) * 0.5 };
      case 'firstPod': {
        for (const s of state.structures) {
          if (s.alive && s.faction === playerFaction && s.kind === 'workPod') {
            return { x: toFloat(s.x), y: toFloat(s.y) };
          }
        }
        return hq;
      }
      case 'firstWorker': {
        for (const u of state.units) {
          if (u.alive && u.kind === 'worker' && u.faction === playerFaction) {
            return { x: toFloat(u.x), y: toFloat(u.y) };
          }
        }
        return hq;
      }
      case 'nearestNode': {
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const n of state.nodes) {
          if (!n.alive) continue;
          const nx = toFloat(n.x);
          const ny = toFloat(n.y);
          const dx = nx - hq.x;
          const dy = ny - hq.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x: nx, y: ny };
          }
        }
        return best ?? hq;
      }
    }
  }

  private renderObjectives(goals: GoalState): void {
    const theme = themeForFaction(this.opts.playerFaction);
    const rows: { met: boolean; text: string }[] = [
      { met: goals.energy.met, text: `ENERGY   ${goals.energy.current} / ${goals.energy.target}` },
      { met: goals.workers.met, text: `WORKERS  ${goals.workers.current} / ${goals.workers.target}` },
      { met: goals.enemyHq.met, text: `FIND ENEMY HQ   ${goals.enemyHq.met ? 'FOUND' : '—'}` },
    ];
    rows.forEach((r, i) => {
      const { mark, text } = this.objectiveRows[i];
      mark.textContent = r.met ? '✓' : '○';
      mark.style.color = r.met ? theme.primary : 'rgba(180,200,210,0.6)';
      text.textContent = r.text;
      text.style.color = r.met ? theme.primary : '#cde';
    });
  }

  private buildCompleteOverlay(theme: ReturnType<typeof themeForFaction>): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'inset:0', 'display:none',
      'align-items:center', 'justify-content:center', 'flex-direction:column', 'gap:24px',
      `background:radial-gradient(ellipse at center, ${theme.deep} 0%, ${VY_BG} 70%)`,
      'z-index:60', 'font-family:ui-monospace,Menlo,monospace', `color:${VY_INK}`,
    ].join(';');

    const heading = document.createElement('div');
    heading.textContent = 'TUTORIAL  COMPLETE';
    heading.style.cssText = [
      'font-size:56px', `letter-spacing:${theme.titleTrack}`, `font-weight:${theme.titleWeight}`,
      `color:${theme.primary}`, `text-shadow:0 0 32px ${theme.glowHard}, 0 0 80px ${theme.glowSoft}`,
      'text-align:center',
    ].join(';');
    el.appendChild(heading);

    const tag = document.createElement('div');
    tag.textContent = 'You can move, harvest, build, and research. Now hold the grid.';
    tag.style.cssText = `font-size:13px;letter-spacing:${theme.bodyTrack};color:${theme.bright};text-align:center;max-width:520px`;
    el.appendChild(tag);

    const btn = document.createElement('button');
    btn.textContent = 'BACK TO MENU';
    btn.style.cssText = [
      'margin-top:10px', 'background:transparent',
      `border:${theme.strokeW}px solid ${theme.primary}`, `border-radius:${theme.radius}px`,
      `color:${theme.primary}`, 'padding:14px 32px',
      'font-family:inherit', 'font-size:13px', `letter-spacing:${theme.cardTrack}`,
      `box-shadow:0 0 16px ${theme.glow}`, 'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', () => this.opts.onExit());
    el.appendChild(btn);

    return el;
  }
}
