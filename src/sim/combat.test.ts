// Combat determinism + functional checks for Phase 1.0.
//
// The hash-equality property (two runs of the same combat fixture
// produce identical hash sequences) is the determinism gate. The
// functional checks below catch "deterministic but broken" bugs the
// hash check can't see — e.g. units never actually take damage, or
// raiders never reach a defender.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import {
  COMBAT_MATCH_SPEC,
  buildCombatFrames,
  runCombatMatch,
} from './scripted-match';
import { UNIT_STATS } from './units-config';

describe('Sim — combat', () => {
  it('combat scenario is deterministic across two runs (1000 ticks)', () => {
    const a = runCombatMatch(1000);
    const b = runCombatMatch(1000);
    expect(a).toEqual(b);
  });

  it('raider closes range on stationary defender and combat begins', () => {
    // Raider walks toward enemy HQ; defender is in front of HQ. By
    // some tick before 200 (10s), the raider must have entered defender
    // attack range and exchanged at least one round of damage.
    const sim = new Sim(COMBAT_MATCH_SPEC);
    const frames = buildCombatFrames(200);
    let damageObserved = false;
    const defenderMaxHp = UNIT_STATS.defender.maxHp;
    const raiderMaxHp = UNIT_STATS.raider.maxHp;

    for (const f of frames) {
      sim.step(f);
      const defender = sim.state.units.find((u) => u.kind === 'defender');
      const raider = sim.state.units.find((u) => u.kind === 'raider');
      if (!defender || !raider) break;
      if (defender.hp < defenderMaxHp || raider.hp < raiderMaxHp) {
        damageObserved = true;
        break;
      }
    }
    expect(damageObserved).toBe(true);
  });

  it('combat resolves to a death: at least one unit dies in 1000 ticks', () => {
    const sim = new Sim(COMBAT_MATCH_SPEC);
    const frames = buildCombatFrames(1000);
    for (const f of frames) sim.step(f);

    const someoneDeed = sim.state.units.some((u) => !u.alive);
    expect(someoneDeed).toBe(true);
  });

  it('attack cooldown is honoured (no double-attack in same tick)', () => {
    // Spawn two raiders adjacent to each other, both faction 0; spawn
    // one defender adjacent, faction 1. Step forward one tick — the
    // defender should attack at most once in the same tick despite two
    // valid targets being in range. (Cooldown is set to attackCooldownTicks
    // immediately after firing.)
    const sim = new Sim({
      ...COMBAT_MATCH_SPEC,
      nodes: [],
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'defender', faction: 0, x: 10, y: 10 },
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 1, x: 10, y: 11 },
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 1, x: 10, y: 9 },
      ],
    });
    // After tick 1, defender has fired once. Total HP loss across the
    // two raiders should equal one attackDamage, not two.
    const totalHpLoss = sim.state.units
      .filter((u) => u.kind === 'raider')
      .reduce((acc, r) => acc + (UNIT_STATS.raider.maxHp - r.hp), 0);
    expect(totalHpLoss).toBe(UNIT_STATS.defender.attackDamage);
  });

  it('targeting tiebreaker is lowest entity ID (deterministic)', () => {
    // Two enemy raiders at exactly equal distance from a defender.
    // The defender must attack the lower-ID one. Without the
    // tiebreaker rule, iteration order would still resolve it but
    // changes to entity construction could silently flip targets.
    const sim = new Sim({ ...COMBAT_MATCH_SPEC, nodes: [] });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'defender', faction: 0, x: 10, y: 10 },
        // Both raiders are exactly 1 tile away (Manhattan 1, Chebyshev 1).
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 1, x: 11, y: 10 },
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 1, x: 10, y: 11 },
      ],
    });

    const raiders = sim.state.units.filter((u) => u.kind === 'raider');
    raiders.sort((a, b) => a.id - b.id);
    expect(raiders).toHaveLength(2);
    // Lower-ID raider should have taken the hit.
    expect(raiders[0].hp).toBeLessThan(UNIT_STATS.raider.maxHp);
    expect(raiders[1].hp).toBe(UNIT_STATS.raider.maxHp);
  });

  it('a dead unit stops contributing to state (combat ends after first death)', () => {
    // Run long enough that one of them dies, then check that the
    // survivor is no longer attacking (their HP doesn't change after
    // the death tick + a few cooldowns).
    const sim = new Sim(COMBAT_MATCH_SPEC);
    const frames = buildCombatFrames(2000);
    let deathTick = -1;
    let i = 0;
    for (; i < frames.length; i++) {
      sim.step(frames[i]);
      if (sim.state.units.some((u) => !u.alive)) {
        deathTick = sim.state.tick;
        break;
      }
    }
    expect(deathTick).toBeGreaterThan(0);

    // Snapshot survivor HP, run another 50 ticks (≥ 2 cooldowns), HP
    // must not change.
    const survivor = sim.state.units.find((u) => u.alive && (u.kind === 'defender' || u.kind === 'raider'));
    if (!survivor) {
      // Both died on the same tick — that's fine, no further damage
      // possible.
      return;
    }
    const hpAtDeath = survivor.hp;
    for (let j = 0; j < 50 && i + j < frames.length; j++) {
      sim.step(frames[i + 1 + j]);
    }
    expect(survivor.hp).toBe(hpAtDeath);
  });
});
