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
//
// Step ordering is load-bearing and was tuned from a playtest:
//   - Train to the supply cap BEFORE building, so the build step always has a
//     freshly-trained (fully-charged) worker to dispatch — no "button greyed
//     while my only worker recharges" dead-end.
//   - Building is gated behind hitting 5/5, so the player feels the capacity
//     wall and the pod's purpose (+5 cap AND recharging) lands as the answer.
//   - Scouting points the player toward the enemy corner, seeding the
//     graduation "find the enemy HQ" goal.

export type TutorialStepId =
  | 'selectHq'
  | 'trainToCap'
  | 'buildPod'
  | 'harvest'
  | 'navigate'
  | 'scout'
  | 'readCharge'
  | 'selectPod'
  | 'research';

// How the coach ghost-cursor demonstrates a step's gesture.
export type CoachGesture = 'leftClick' | 'rightClick' | 'point';

// Where a step's coach bubble + ghost cursor anchor.
//   world  — a sim tile projected to screen each frame (pans with the camera)
//   screen — a viewport region the HUD owns (command card, portrait, …)
export type CoachAnchor =
  | { kind: 'world'; target: 'playerHq' | 'firstWorker' | 'nearestNode' | 'enemyHq' | 'scoutPoint' | 'firstPod' }
  | { kind: 'screen'; region: 'commandCard' | 'portrait' | 'resourceBar' | 'minimap' };

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

export const GUIDED_STEPS: readonly TutorialStep[] = [
  {
    id: 'selectHq',
    title: 'SELECT YOUR HQ',
    body: 'Click your HQ to focus it. The command card (bottom) shows what it can do.',
    anchor: { kind: 'world', target: 'playerHq' },
    gesture: 'leftClick',
  },
  {
    id: 'trainToCap',
    title: 'TRAIN WORKERS',
    body: 'Click TRAIN WORKER to queue workers. Watch SUPPLY (top): it stops you at 5/5. Fill it up.',
    anchor: { kind: 'screen', region: 'commandCard' },
    gesture: 'leftClick',
  },
  {
    id: 'buildPod',
    title: 'RAISE YOUR CAP — BUILD A POD',
    body: "You're capped at 5/5 (flashing, top). A Work Pod adds +5 cap AND recharges nearby workers. Select a worker, click BUILD WORK POD, then click a tile.",
    anchor: { kind: 'screen', region: 'commandCard' },
    gesture: 'leftClick',
  },
  {
    id: 'harvest',
    title: 'HARVEST ENERGY',
    body: 'Select a worker and LEFT-CLICK an energy node to send it gathering. Energy pays for everything.',
    anchor: { kind: 'world', target: 'nearestNode' },
    gesture: 'leftClick',
  },
  {
    id: 'navigate',
    title: 'MOVE THE CAMERA',
    body: 'SCROLL to zoom · WASD / arrows / middle-drag to pan · click the MINIMAP (bottom-right) to jump. Zoom out to see the whole arena before you scout.',
    anchor: { kind: 'screen', region: 'minimap' },
    gesture: 'point',
    ack: true,
  },
  {
    id: 'scout',
    title: 'SCOUT THE MAP',
    body: 'Select a worker and RIGHT-CLICK far toward the opposite corner. The enemy HQ is out there — go uncover it.',
    anchor: { kind: 'world', target: 'scoutPoint' },
    gesture: 'rightClick',
  },
  {
    id: 'readCharge',
    title: 'THE CHARGE METER',
    body: 'Each worker carries charge (portrait, bottom-left). At empty it stops to recharge at a pod or your HQ — that is the other reason pods matter.',
    anchor: { kind: 'screen', region: 'portrait' },
    gesture: 'point',
    ack: true,
  },
  {
    id: 'selectPod',
    title: 'SELECT THE WORK POD',
    body: 'Click your Work Pod — NOT the worker — to select it. Research lives on the pod, so selecting it swaps the command card.',
    anchor: { kind: 'world', target: 'firstPod' },
    gesture: 'leftClick',
  },
  {
    id: 'research',
    title: 'RESEARCH AUTO-RESUME',
    body: 'Click AUTO-RESUME on the command card. Workers will return to harvesting on their own after recharging.',
    anchor: { kind: 'screen', region: 'commandCard' },
    gesture: 'leftClick',
  },
];

// The snapshot the controller assembles each tick.
export interface TutorialCtx {
  // step gates
  hqSelected: boolean;
  atSupplyCap: boolean; // worker cap reached (queued + alive ≥ cap) with ≥1 alive
  podExists: boolean; // any alive friendly structure (building or operational)
  podSelected: boolean; // a friendly alive work pod is the current selection
  researchActiveOrDone: boolean;
  // latched player-action flags (fed from the input feedback hooks)
  didMove: boolean;
  didAssignHarvest: boolean;
  // graduation goal readouts
  energyBalance: number; // current energy pool (whole units)
  workerCount: number; // supplyUsed
  enemyHqFound: boolean; // enemy HQ tile has been explored
}

// Action-gated step predicates. Ack steps (`navigate`, `readCharge`) are not
// driven from here — they advance on the coach's GOT IT click — so they
// return false.
export function isStepDone(id: TutorialStepId, ctx: TutorialCtx): boolean {
  switch (id) {
    case 'selectHq':
      return ctx.hqSelected;
    case 'trainToCap':
      return ctx.atSupplyCap;
    case 'buildPod':
      return ctx.podExists;
    case 'harvest':
      return ctx.didAssignHarvest;
    case 'navigate':
      return false; // ack-gated
    case 'scout':
      return ctx.didMove;
    case 'readCharge':
      return false; // ack-gated
    case 'selectPod':
      return ctx.podSelected;
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
