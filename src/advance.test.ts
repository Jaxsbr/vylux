import { describe, it, expect, vi, type Mock } from 'vitest';
import { advanceRaiders, type AdvanceRaider, type AdvanceTarget, type AdvanceDefender } from './advance';

type TestRaider = Omit<AdvanceRaider, 'moveTo'> & { moveTo: Mock };

function makeRaider(
  tileX: number,
  tileY: number,
  overrides?: Omit<Partial<AdvanceRaider>, 'moveTo'>,
): TestRaider {
  const moveTo = vi.fn();
  return {
    faction: 'blue',
    tileX,
    tileY,
    targetTileX: tileX,
    targetTileY: tileY,
    hp: 60,
    moveTo,
    ...overrides,
  };
}

function makeHq(tileX: number, tileY: number, hp = 500): AdvanceTarget {
  return { tileX, tileY, hp };
}

function makeWorker(tileX: number, tileY: number, hp = 80): AdvanceTarget {
  return { tileX, tileY, hp };
}

function makeDefender(tileX: number, tileY: number, hp = 120, unitId?: number): AdvanceDefender {
  return { tileX, tileY, hp, unitId };
}

const ATTACK_RANGE = 1.5; // matches UNIT_STATS.raider.range

describe('advanceRaiders — picks nearest enemy', () => {
  it('issues moveTo toward the nearest worker when multiple targets exist', () => {
    const raider = makeRaider(0, 0);
    const nearWorker = makeWorker(5, 0);
    const farWorker = makeWorker(15, 0);
    const hq = makeHq(19, 19);

    advanceRaiders([raider], [nearWorker, farWorker], [], hq, ATTACK_RANGE);

    expect(raider.moveTo).toHaveBeenCalledWith(5, 0);
  });

  it('issues moveTo toward HQ when no workers or defenders remain', () => {
    const raider = makeRaider(0, 0);
    const hq = makeHq(19, 19);

    advanceRaiders([raider], [], [], hq, ATTACK_RANGE);

    expect(raider.moveTo).toHaveBeenCalledWith(19, 19);
  });

  it('picks HQ over distant worker when HQ is actually closer', () => {
    // Raider at (14,14): HQ at (19,19) is ~7 tiles away, worker at (0,0) is ~19.8 tiles away.
    const raider = makeRaider(14, 14);
    const hq = makeHq(19, 19);
    const farWorker = makeWorker(0, 0);

    advanceRaiders([raider], [farWorker], [], hq, ATTACK_RANGE);

    // Nearest is HQ (~7 tiles), not worker (~19.8) — raider should advance to HQ.
    expect(raider.moveTo).toHaveBeenCalledWith(19, 19);
  });

  it('advances toward defender when defender is nearer than HQ and no workers present', () => {
    // Raider at (10,10): defender at (12,10) is ~2 tiles, HQ at (19,19) is ~12 tiles.
    const raider = makeRaider(10, 10);
    const hq = makeHq(19, 19);
    const nearDef = makeDefender(12, 10);

    advanceRaiders([raider], [], [nearDef], hq, ATTACK_RANGE);

    expect(raider.moveTo).toHaveBeenCalledWith(12, 10);
  });
});

describe('advanceRaiders — no targets (stands still)', () => {
  it('does not call moveTo when there are no enemies', () => {
    const raider = makeRaider(5, 5);
    const deadHq = makeHq(19, 19, 0); // hp=0, treated as dead

    advanceRaiders([raider], [], [], deadHq, ATTACK_RANGE);

    expect(raider.moveTo).not.toHaveBeenCalled();
  });

  it('does not call moveTo for a dead raider', () => {
    const deadRaider = makeRaider(5, 5, { hp: 0 });
    const hq = makeHq(19, 19);

    advanceRaiders([deadRaider], [], [], hq, ATTACK_RANGE);

    expect(deadRaider.moveTo).not.toHaveBeenCalled();
  });
});

describe('advanceRaiders — already in attack range (stops)', () => {
  it('does not call moveTo when raider is within attack range of nearest target', () => {
    const raider = makeRaider(18, 18); // Chebyshev dist to (19,19) = 1 <= 1.5
    const hq = makeHq(19, 19);

    advanceRaiders([raider], [], [], hq, ATTACK_RANGE);

    expect(raider.moveTo).not.toHaveBeenCalled();
  });

  it('does not call moveTo when worker is exactly at attack range (Chebyshev = 1)', () => {
    const raider = makeRaider(5, 5);
    const worker = makeWorker(6, 5); // Chebyshev dist = 1 <= 1.5

    advanceRaiders([raider], [worker], [], makeHq(19, 19), ATTACK_RANGE);

    expect(raider.moveTo).not.toHaveBeenCalled();
  });

  it('does not call moveTo when defender is exactly at attack range', () => {
    const raider = makeRaider(5, 5);
    const def = makeDefender(6, 5); // Chebyshev dist = 1 <= 1.5

    advanceRaiders([raider], [], [def], makeHq(19, 19), ATTACK_RANGE);

    expect(raider.moveTo).not.toHaveBeenCalled();
  });
});

describe('advanceRaiders — dead target switchover mid-flight', () => {
  it('switches to next nearest enemy when current target dies', () => {
    const raider = makeRaider(8, 0);

    // First advance: worker at (10,0) is alive and nearer than HQ.
    const worker = makeWorker(10, 0, 80);
    const hq = makeHq(19, 19);

    advanceRaiders([raider], [worker], [], hq, ATTACK_RANGE);
    expect(raider.moveTo).toHaveBeenCalledWith(10, 0);

    // Simulate worker dying.
    worker.hp = 0;
    raider.moveTo.mockClear();

    // Second advance: target changes to HQ.
    advanceRaiders([raider], [worker], [], hq, ATTACK_RANGE);
    expect(raider.moveTo).toHaveBeenCalledWith(19, 19);
  });

  it('stands still when last target dies and no more targets', () => {
    const raider = makeRaider(8, 0);
    const deadWorker = makeWorker(10, 0, 0);
    const deadHq = makeHq(19, 19, 0);

    advanceRaiders([raider], [deadWorker], [], deadHq, ATTACK_RANGE);

    expect(raider.moveTo).not.toHaveBeenCalled();
  });
});

describe('advanceRaiders — does not spam moveTo', () => {
  it('does not re-issue moveTo when target tile unchanged', () => {
    const raider = makeRaider(0, 0, {
      targetTileX: 19,
      targetTileY: 19,
    });
    const hq = makeHq(19, 19);

    advanceRaiders([raider], [], [], hq, ATTACK_RANGE);

    // raider already targeting (19,19) — no new moveTo call.
    expect(raider.moveTo).not.toHaveBeenCalled();
  });
});

describe('advanceRaiders — defender between raider and HQ', () => {
  it('raider advances toward closer defender, not the farther HQ', () => {
    // Raider at (5,9): defender at (8,9) is ~3 tiles, HQ at (16,9) is 11 tiles.
    const raider = makeRaider(5, 9);
    const def = makeDefender(8, 9);
    const hq = makeHq(16, 9);

    advanceRaiders([raider], [], [def], hq, ATTACK_RANGE);

    // Should advance to defender, not HQ.
    expect(raider.moveTo).toHaveBeenCalledWith(8, 9);
  });
});
