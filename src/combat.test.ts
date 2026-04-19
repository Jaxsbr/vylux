import { describe, it, expect, beforeEach } from 'vitest';
import { tickCombat, type CombatUnit, type CombatWorker, type CombatHq, type PointsLedger } from './combat';
import { UNIT_STATS, HQ_MAX_HP } from './units-config';
import type * as THREE from 'three';

// Minimal mock Three.js types sufficient for combat logic.
// We never import THREE itself — scene.add is a no-op, positions are plain objects.
function makeVec3(x = 0, y = 0, z = 0): THREE.Vector3 {
  return {
    x, y, z,
    clone: () => makeVec3(x, y, z),
  } as unknown as THREE.Vector3;
}

function makeScene(): THREE.Scene {
  return {
    add: () => { /* no-op */ },
  } as unknown as THREE.Scene;
}

function makePointsLedger(): PointsLedger {
  let state = { blue: 0, red: 0 };
  return {
    get: () => ({ ...state }),
    set: (patch: Partial<{ blue: number; red: number }>) => {
      if (patch.blue !== undefined) state.blue = Math.max(0, patch.blue);
      if (patch.red !== undefined) state.red = Math.max(0, patch.red);
    },
  };
}

function makeWorker(
  faction: 'blue' | 'red',
  tileX: number,
  tileY: number,
  hp = UNIT_STATS.worker.maxHp,
): CombatWorker & { _disposed: boolean } {
  const w = {
    faction,
    tileX,
    tileY,
    hp,
    maxHp: UNIT_STATS.worker.maxHp,
    mesh: { position: makeVec3() },
    _disposed: false,
    takeDamage(amount: number): { died: boolean; damageDealt: number } {
      const before = w.hp;
      w.hp = Math.max(0, w.hp - amount);
      return { died: w.hp <= 0, damageDealt: before - w.hp };
    },
    dispose(_scene: THREE.Scene): void {
      w._disposed = true;
    },
  };
  return w;
}

function makeDefender(
  faction: 'blue' | 'red',
  tileX: number,
  tileY: number,
  hp = UNIT_STATS.defender.maxHp,
): CombatUnit & { _disposed: boolean } {
  const d = {
    faction,
    tileX,
    tileY,
    hp,
    maxHp: UNIT_STATS.defender.maxHp,
    attackCooldownRemaining: 0,
    mesh: { position: makeVec3() },
    _disposed: false,
    takeDamage(amount: number): { died: boolean; damageDealt: number } {
      const before = d.hp;
      d.hp = Math.max(0, d.hp - amount);
      return { died: d.hp <= 0, damageDealt: before - d.hp };
    },
    dispose(_scene: THREE.Scene): void {
      d._disposed = true;
    },
  };
  return d;
}

function makeRaider(
  faction: 'blue' | 'red',
  tileX: number,
  tileY: number,
  hp = UNIT_STATS.raider.maxHp,
): CombatUnit & { _disposed: boolean } {
  const r = {
    faction,
    tileX,
    tileY,
    hp,
    maxHp: UNIT_STATS.raider.maxHp,
    attackCooldownRemaining: 0,
    mesh: { position: makeVec3() },
    _disposed: false,
    takeDamage(amount: number): { died: boolean; damageDealt: number } {
      const before = r.hp;
      r.hp = Math.max(0, r.hp - amount);
      return { died: r.hp <= 0, damageDealt: before - r.hp };
    },
    dispose(_scene: THREE.Scene): void {
      r._disposed = true;
    },
  };
  return r;
}

function makeHq(faction: 'blue' | 'red', tileX: number, tileY: number): CombatHq {
  const h = {
    faction,
    tileX,
    tileY,
    hp: HQ_MAX_HP,
    maxHp: HQ_MAX_HP,
    damageAccumulator: 0,
    mesh: { position: makeVec3() },
    takeDamage(amount: number): { died: boolean; damageDealt: number } {
      const before = h.hp;
      h.hp = Math.max(0, h.hp - amount);
      return { died: h.hp <= 0, damageDealt: before - h.hp };
    },
  };
  return h;
}

describe('combat — defender attacks', () => {
  let scene: THREE.Scene;
  let pointsLedger: PointsLedger;
  let blueHq: CombatHq;
  let redHq: CombatHq;

  beforeEach(() => {
    scene = makeScene();
    pointsLedger = makePointsLedger();
    blueHq = makeHq('blue', 0, 0);
    redHq = makeHq('red', 19, 19);
  });

  it('defender damages in-range enemy each cooldown window', () => {
    const blueDef = makeDefender('blue', 5, 5);
    const redDef = makeDefender('red', 5, 6); // Chebyshev dist = 1, within range 1.5

    const defenders: CombatUnit[] = [blueDef, redDef];
    const workers: CombatWorker[] = [];
    const raiders: CombatUnit[] = [];

    const initialRedHp = redDef.hp;
    const damage = UNIT_STATS.defender.damage;

    // First tick — cooldown starts at 0, should fire immediately.
    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHq }, pointsLedger, dt: 0.016, scene });

    expect(redDef.hp).toBe(initialRedHp - damage);

    // Advance time just under full cooldown — should not fire again.
    const partialCooldown = UNIT_STATS.defender.attackCooldown - 0.1;
    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHq }, pointsLedger, dt: partialCooldown, scene });
    expect(redDef.hp).toBe(initialRedHp - damage); // unchanged

    // Advance remaining cooldown — fires again.
    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHq }, pointsLedger, dt: 0.11, scene });
    expect(redDef.hp).toBe(initialRedHp - damage * 2);
  });

  it('raider ignores enemy defenders when a closer worker is present', () => {
    const blueRaider = makeRaider('blue', 5, 5);
    const redDef = makeDefender('red', 5, 6); // dist 1
    const redWorker = makeWorker('red', 5, 6); // same dist — worker takes priority (sort stable, workers checked first)

    const defenders: CombatUnit[] = [redDef];
    const workers: CombatWorker[] = [redWorker];
    const raiders: CombatUnit[] = [blueRaider];

    const initialDefHp = redDef.hp;
    const initialWorkerHp = redWorker.hp;

    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHq }, pointsLedger, dt: 0.016, scene });

    // Raider should have attacked the worker, not the defender.
    expect(redWorker.hp).toBe(initialWorkerHp - UNIT_STATS.raider.damage);
    expect(redDef.hp).toBe(initialDefHp);
  });

  it('raider with only defenders in range does not attack', () => {
    const blueRaider = makeRaider('blue', 5, 5);
    const redDef = makeDefender('red', 5, 6); // dist 1 — in range

    const defenders: CombatUnit[] = [redDef];
    const workers: CombatWorker[] = [];
    const raiders: CombatUnit[] = [blueRaider];

    const initialDefHp = redDef.hp;

    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHq }, pointsLedger, dt: 0.016, scene });

    // Raider cannot target defenders — so no attack happens.
    expect(redDef.hp).toBe(initialDefHp);
    expect(blueRaider.attackCooldownRemaining).toBeLessThanOrEqual(0);
  });

  it('HP <= 0 splices unit from the array', () => {
    const blueDef = makeDefender('blue', 5, 5);
    // Red defender with 1 HP — one hit will kill.
    const redDef = makeDefender('red', 5, 6, 1);

    const defenders: CombatUnit[] = [blueDef, redDef];
    const workers: CombatWorker[] = [];
    const raiders: CombatUnit[] = [];

    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHq }, pointsLedger, dt: 0.016, scene });

    // Red defender should be dead and spliced out.
    expect(defenders).toHaveLength(1);
    expect(defenders[0]!.faction).toBe('blue');
    expect(redDef._disposed).toBe(true);
  });

  it('kill gives killer faction +5 points', () => {
    const blueDef = makeDefender('blue', 5, 5);
    const redDef = makeDefender('red', 5, 6, 1); // 1 HP

    const defenders: CombatUnit[] = [blueDef, redDef];
    const workers: CombatWorker[] = [];
    const raiders: CombatUnit[] = [];

    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHq }, pointsLedger, dt: 0.016, scene });

    expect(pointsLedger.get().blue).toBe(5);
    expect(pointsLedger.get().red).toBe(0);
  });

  it('HQ damage accrues floor(total_damage / 10) points to attacker', () => {
    // Blue defender adjacent to red HQ (tile 19,19). Place defender at 19,18 — dist 1.
    const blueDef = makeDefender('blue', 19, 18);
    const redHqClose = makeHq('red', 19, 19);

    const defenders: CombatUnit[] = [blueDef];
    const workers: CombatWorker[] = [];
    const raiders: CombatUnit[] = [];

    // Defender damage = 15. Floor(15/10) = 1 point per hit.
    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHqClose }, pointsLedger, dt: 0.016, scene });

    // 15 damage → accumulator=15 → floor(15/10)=1 point, accumulator becomes 5.
    expect(pointsLedger.get().blue).toBe(1);
    expect(redHqClose.damageAccumulator).toBeCloseTo(5);

    // Reset cooldown and fire again: carry 5 + 15 = 20 → floor(20/10)=2 more points (total 3), accumulator = 0.
    blueDef.attackCooldownRemaining = 0;
    tickCombat({ units: { workers, defenders, raiders }, hqs: { blue: blueHq, red: redHqClose }, pointsLedger, dt: 0.016, scene });

    expect(pointsLedger.get().blue).toBe(3);
    expect(redHqClose.damageAccumulator).toBeCloseTo(0);
  });
});
