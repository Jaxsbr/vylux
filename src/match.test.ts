import { describe, it, expect } from 'vitest';
import { evaluateMatch, WIN_POINTS } from './match';

function makeArgs(blue: number, red: number, blueHqHp = 500, redHqHp = 500) {
  return {
    pointsLedger: { get: () => ({ blue, red }) },
    hqs: { blue: { hp: blueHqHp }, red: { hp: redHqHp } },
  };
}

describe('evaluateMatch', () => {
  it('returns null when both below threshold and both HQs alive', () => {
    expect(evaluateMatch(makeArgs(0, 0))).toBeNull();
    expect(evaluateMatch(makeArgs(499, 499))).toBeNull();
  });

  it('blue at WIN_POINTS → blue-wins', () => {
    expect(evaluateMatch(makeArgs(WIN_POINTS, 0))).toBe('blue-wins');
  });

  it('red at WIN_POINTS → red-wins', () => {
    expect(evaluateMatch(makeArgs(0, WIN_POINTS))).toBe('red-wins');
  });

  it('blue HQ hp=0 → red-wins', () => {
    expect(evaluateMatch(makeArgs(499, 0, 0, 500))).toBe('red-wins');
  });

  it('red HQ hp=0 → blue-wins', () => {
    expect(evaluateMatch(makeArgs(0, 499, 500, 0))).toBe('blue-wins');
  });

  it('tie-break: both at WIN_POINTS, red has more points → red-wins', () => {
    expect(evaluateMatch(makeArgs(WIN_POINTS, WIN_POINTS + 10))).toBe('red-wins');
  });

  it('tie-break: both at WIN_POINTS, blue has more points → blue-wins', () => {
    expect(evaluateMatch(makeArgs(WIN_POINTS + 10, WIN_POINTS))).toBe('blue-wins');
  });

  it('tie-break: truly simultaneous equal points → blue-wins (deterministic)', () => {
    expect(evaluateMatch(makeArgs(WIN_POINTS, WIN_POINTS))).toBe('blue-wins');
  });

  it('both HQs dead same frame, red more points → red-wins', () => {
    expect(evaluateMatch(makeArgs(100, 200, 0, 0))).toBe('red-wins');
  });

  it('both HQs dead same frame, equal points → blue-wins', () => {
    expect(evaluateMatch(makeArgs(100, 100, 0, 0))).toBe('blue-wins');
  });
});
