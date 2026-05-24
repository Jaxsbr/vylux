import { describe, expect, it } from 'vitest';
import {
  evalGoals,
  GOAL_THRESHOLDS,
  GUIDED_STEPS,
  isStepDone,
  type TutorialCtx,
} from './tutorial-steps';

// A neutral ctx with every gate unmet; override only what each case exercises.
function ctx(over: Partial<TutorialCtx> = {}): TutorialCtx {
  return {
    hqSelected: false,
    atSupplyCap: false,
    podExists: false,
    podSelected: false,
    researchActiveOrDone: false,
    didMove: false,
    didAssignHarvest: false,
    energyBalance: 0,
    workerCount: 0,
    enemyHqFound: false,
    ...over,
  };
}

describe('guided step sequence', () => {
  it('teaches the gestures in the playtest-tuned order (train → build before harvest)', () => {
    expect(GUIDED_STEPS.map((s) => s.id)).toEqual([
      'selectHq',
      'trainToCap',
      'buildPod',
      'harvest',
      'navigate',
      'scout',
      'readCharge',
      'selectPod',
      'research',
    ]);
  });

  it('marks navigate + readCharge as acknowledge steps', () => {
    const ackSteps = GUIDED_STEPS.filter((s) => s.ack === true);
    expect(ackSteps.map((s) => s.id)).toEqual(['navigate', 'readCharge']);
  });

  it('builds the pod before harvesting so the build worker is freshly charged', () => {
    const ids = GUIDED_STEPS.map((s) => s.id);
    expect(ids.indexOf('buildPod')).toBeLessThan(ids.indexOf('harvest'));
  });
});

describe('isStepDone', () => {
  it('selectHq gates on the HQ being selected', () => {
    expect(isStepDone('selectHq', ctx())).toBe(false);
    expect(isStepDone('selectHq', ctx({ hqSelected: true }))).toBe(true);
  });

  it('trainToCap gates on the supply cap being reached', () => {
    expect(isStepDone('trainToCap', ctx())).toBe(false);
    expect(isStepDone('trainToCap', ctx({ atSupplyCap: true }))).toBe(true);
  });

  it('buildPod gates on a friendly pod existing', () => {
    expect(isStepDone('buildPod', ctx())).toBe(false);
    expect(isStepDone('buildPod', ctx({ podExists: true }))).toBe(true);
  });

  it('harvest gates on a harvest assignment having been issued', () => {
    expect(isStepDone('harvest', ctx())).toBe(false);
    expect(isStepDone('harvest', ctx({ didAssignHarvest: true }))).toBe(true);
  });

  it('navigate is ack-gated, so the action predicate is always false', () => {
    expect(isStepDone('navigate', ctx({ didMove: true, podExists: true }))).toBe(false);
  });

  it('scout gates on a move order having been issued', () => {
    expect(isStepDone('scout', ctx())).toBe(false);
    expect(isStepDone('scout', ctx({ didMove: true }))).toBe(true);
  });

  it('readCharge is ack-gated, so the action predicate is always false', () => {
    expect(isStepDone('readCharge', ctx({ podSelected: true }))).toBe(false);
  });

  it('selectPod gates on a friendly work pod being selected', () => {
    expect(isStepDone('selectPod', ctx())).toBe(false);
    expect(isStepDone('selectPod', ctx({ podSelected: true }))).toBe(true);
  });

  it('research gates on auto-resume being in progress or done', () => {
    expect(isStepDone('research', ctx())).toBe(false);
    expect(isStepDone('research', ctx({ researchActiveOrDone: true }))).toBe(true);
  });
});

describe('evalGoals', () => {
  it('uses the 300 energy / 15 worker thresholds by default', () => {
    expect(GOAL_THRESHOLDS).toEqual({ energy: 300, workers: 15 });
  });

  it('reports each goal independently', () => {
    const g = evalGoals(ctx({ energyBalance: 300, workerCount: 10, enemyHqFound: false }));
    expect(g.energy.met).toBe(true);
    expect(g.workers.met).toBe(false);
    expect(g.enemyHq.met).toBe(false);
    expect(g.allMet).toBe(false);
  });

  it('treats the energy goal as a balance threshold (≥, not ==)', () => {
    expect(evalGoals(ctx({ energyBalance: 299 })).energy.met).toBe(false);
    expect(evalGoals(ctx({ energyBalance: 301 })).energy.met).toBe(true);
  });

  it('completes only when all three goals are met', () => {
    const g = evalGoals(ctx({ energyBalance: 320, workerCount: 15, enemyHqFound: true }));
    expect(g.allMet).toBe(true);
  });

  it('honours custom thresholds', () => {
    const g = evalGoals(ctx({ energyBalance: 5, workerCount: 2 }), { energy: 5, workers: 2 });
    expect(g.energy.met).toBe(true);
    expect(g.workers.met).toBe(true);
  });
});
