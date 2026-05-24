// Phase C.6 — pure tutorial logic.
//
// Step definitions, the per-step "done" predicates, and the graduation-goal
// evaluation. Deliberately DOM-free and sim-free: everything operates on a
// plain `TutorialCtx` snapshot the controller assembles each frame from sim
// state + input selection + exploration. That keeps this module unit-testable
// the same way `entity-life.ts` is — no Three.js, no document, just data in →
// booleans out.
//
// The energy goal is a *current-balance* read (no new sim field), so nothing
// here touches the determinism contract or the golden fixtures.

export type TutorialStepId =
  | 'selectHq'
  | 'trainWorker'
  | 'moveWorker'
  | 'assignHarvest'
  | 'readCharge'
  | 'buildPod'
  | 'research';

// How the coach ghost-cursor demonstrates a step's gesture.
export type CoachGesture = 'leftClick' | 'rightClick' | 'point';

// Where a step's coach bubble + ghost cursor anchor.
//   world  — a sim tile projected to screen each frame (pans with the camera)
//   screen — a viewport region the HUD owns (command card, portrait, …)
export type CoachAnchor =
  | { kind: 'world'; target: 'playerHq' | 'firstWorker' | 'nearestNode' | 'enemyHq' }
  | { kind: 'screen'; region: 'commandCard' | 'portrait' | 'resourceBar' };

export interface TutorialStep {
  id: TutorialStepId;
  title: string;
  body: string;
  anchor: CoachAnchor;
  gesture: CoachGesture;
  // `ack` steps are informational — they advance on a "GOT IT" click rather
  // than on a gated game action. `isStepDone` is never consulted for them;
  // the controller tracks the acknowledge click instead.
  ack?: boolean;
}

// The guided sequence. Order is load-bearing: each step teaches the gesture
// the next one assumes the player can perform.
export const GUIDED_STEPS: readonly TutorialStep[] = [
  {
    id: 'selectHq',
    title: 'SELECT YOUR HQ',
    body: 'Click your HQ to focus it. The command card (bottom) shows what it can do.',
    anchor: { kind: 'world', target: 'playerHq' },
    gesture: 'leftClick',
  },
  {
    id: 'trainWorker',
    title: 'TRAIN A WORKER',
    body: 'Click TRAIN WORKER on the command card. Workers gather energy and build.',
    anchor: { kind: 'screen', region: 'commandCard' },
    gesture: 'leftClick',
  },
  {
    id: 'moveWorker',
    title: 'MOVE YOUR WORKER',
    body: 'Click the worker to select it, then RIGHT-CLICK open ground to move it there.',
    anchor: { kind: 'world', target: 'firstWorker' },
    gesture: 'rightClick',
  },
  {
    id: 'assignHarvest',
    title: 'HARVEST ENERGY',
    body: 'With the worker selected, LEFT-CLICK an energy node to send it harvesting.',
    anchor: { kind: 'world', target: 'nearestNode' },
    gesture: 'leftClick',
  },
  {
    id: 'readCharge',
    title: 'THE CHARGE METER',
    body: 'Each worker carries energy charge (portrait, bottom-left). At empty it stops to recharge at a pod or your HQ.',
    anchor: { kind: 'screen', region: 'portrait' },
    gesture: 'point',
    ack: true,
  },
  {
    id: 'buildPod',
    title: 'BUILD A WORK POD',
    body: 'Select a worker, click BUILD WORK POD, then click a tile. Pods raise your worker cap (+5) and recharge workers.',
    anchor: { kind: 'screen', region: 'commandCard' },
    gesture: 'leftClick',
  },
  {
    id: 'research',
    title: 'RESEARCH AUTO-RESUME',
    body: 'Select an operational pod and click AUTO-RESUME. Workers will return to harvesting on their own after recharging.',
    anchor: { kind: 'screen', region: 'commandCard' },
    gesture: 'leftClick',
  },
];

// The snapshot the controller assembles each tick.
export interface TutorialCtx {
  // step gates
  hqSelected: boolean;
  selectedWorkerCount: number;
  workerExists: boolean; // supplyUsed >= 1 || a worker is queued
  podExists: boolean; // any alive friendly structure (building or operational)
  researchActiveOrDone: boolean;
  // latched player-action flags (fed from the input feedback hooks)
  didMove: boolean;
  didAssignHarvest: boolean;
  // graduation goal readouts
  energyBalance: number; // current energy pool (whole units)
  workerCount: number; // supplyUsed
  enemyHqFound: boolean; // enemy HQ tile has been explored
}

// Action-gated step predicates. Ack steps (e.g. `readCharge`) are not driven
// from here — they advance on the coach's GOT IT click — so they return false.
export function isStepDone(id: TutorialStepId, ctx: TutorialCtx): boolean {
  switch (id) {
    case 'selectHq':
      return ctx.hqSelected;
    case 'trainWorker':
      return ctx.workerExists;
    case 'moveWorker':
      return ctx.didMove;
    case 'assignHarvest':
      return ctx.didAssignHarvest;
    case 'readCharge':
      return false; // ack-gated; controller advances on the GOT IT click
    case 'buildPod':
      return ctx.podExists;
    case 'research':
      return ctx.researchActiveOrDone;
  }
}

export interface GoalThresholds {
  energy: number;
  workers: number;
}

// Tunable in playtest. Energy is a current-balance threshold (the value the
// resource bar already shows); workers is the alive-worker count, which can
// only reach 15 by building pods (cap starts at 5, +5 per operational pod),
// so the goal teaches building + capacity implicitly.
export const GOAL_THRESHOLDS: GoalThresholds = { energy: 300, workers: 15 };

export interface GoalState {
  energy: { current: number; target: number; met: boolean };
  workers: { current: number; target: number; met: boolean };
  enemyHq: { met: boolean };
  allMet: boolean;
}

export function evalGoals(
  ctx: TutorialCtx,
  thresholds: GoalThresholds = GOAL_THRESHOLDS,
): GoalState {
  const energyMet = ctx.energyBalance >= thresholds.energy;
  const workersMet = ctx.workerCount >= thresholds.workers;
  const hqMet = ctx.enemyHqFound;
  return {
    energy: { current: ctx.energyBalance, target: thresholds.energy, met: energyMet },
    workers: { current: ctx.workerCount, target: thresholds.workers, met: workersMet },
    enemyHq: { met: hqMet },
    allMet: energyMet && workersMet && hqMet,
  };
}
