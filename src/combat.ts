import * as THREE from 'three';
import type { FactionId } from './placement';
import { UNIT_STATS, RETALIATE_WINDOW_TICKS } from './units-config';
import { addPoints } from './points';

// Minimum interfaces used by combat — allows mocking in tests without Three.js scene.
export type CombatUnit = {
  faction: FactionId;
  tileX: number;
  tileY: number;
  hp: number;
  maxHp: number;
  attackCooldownRemaining: number;
  takeDamage: (amount: number) => { died: boolean; damageDealt: number };
  dispose: (scene: THREE.Scene) => void;
  mesh: { position: THREE.Vector3 };
  /** Optional death-pulse support — present on defender/raider bundles. */
  triggerDeathPulse?: () => void;
  readonly deathPulseActive?: boolean;
  /** Optional damage-taken flash — called on every hit. */
  triggerDamagePulse?: () => void;
};

export type CombatWorker = {
  faction: FactionId;
  tileX: number;
  tileY: number;
  hp: number;
  maxHp: number;
  takeDamage: (amount: number) => { died: boolean; damageDealt: number };
  dispose: (scene: THREE.Scene) => void;
  mesh: { position: THREE.Vector3 };
  /** Optional death-pulse support — present on worker bundles. */
  triggerDeathPulse?: () => void;
  readonly deathPulseActive?: boolean;
  /** Optional damage-taken flash — called on every hit. */
  triggerDamagePulse?: () => void;
};

export type CombatHq = {
  faction: FactionId;
  tileX: number;
  tileY: number;
  hp: number;
  maxHp: number;
  damageAccumulator: number;
  takeDamage: (amount: number) => { died: boolean; damageDealt: number };
  mesh: { position: THREE.Vector3 };
  /** Optional damage-taken flash — called on every raider hit. */
  triggerDamagePulse?: () => void;
};

export type PointsLedger = {
  get: () => { blue: number; red: number };
  set: (patch: Partial<{ blue: number; red: number }>) => void;
};

// Active attack beam for rendering.
type AttackBeam = {
  line: THREE.Line;
  lifetime: number;
  maxLifetime: number;
  mat: THREE.LineBasicMaterial;
};

// Per-attacker beam record — one line object per combat unit, reused each hit.
const attackerBeams = new WeakMap<object, AttackBeam>();

const BEAM_LIFETIME = 0.12; // seconds — ~120 ms

function getOrCreateBeam(
  attacker: CombatUnit,
  scene: THREE.Scene,
  factionColor: number,
): AttackBeam {
  let beam = attackerBeams.get(attacker);
  if (beam === undefined) {
    const points = [new THREE.Vector3(), new THREE.Vector3()];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: factionColor,
      transparent: true,
      opacity: 1,
    });
    const line = new THREE.Line(geo, mat);
    line.name = 'attack-beam';
    line.renderOrder = 500;
    scene.add(line);
    beam = { line, lifetime: 0, maxLifetime: BEAM_LIFETIME, mat };
    attackerBeams.set(attacker, beam);
  }
  return beam;
}

function fireBeam(
  attacker: CombatUnit,
  targetPos: THREE.Vector3,
  scene: THREE.Scene,
  factionColor: number,
): void {
  const beam = getOrCreateBeam(attacker, scene, factionColor);
  const from = attacker.mesh.position;
  const pos = beam.line.geometry.attributes['position'];
  if (pos === undefined) return;
  pos.setXYZ(0, from.x, from.y + 0.5, from.z);
  pos.setXYZ(1, targetPos.x, targetPos.y + 0.5, targetPos.z);
  pos.needsUpdate = true;
  beam.lifetime = BEAM_LIFETIME;
  beam.mat.opacity = 1;
  beam.line.visible = true;
}

function tickBeams(beams: AttackBeam[], dt: number): void {
  for (const beam of beams) {
    if (!beam.line.visible) continue;
    beam.lifetime -= dt;
    if (beam.lifetime <= 0) {
      beam.line.visible = false;
      beam.mat.opacity = 0;
    } else {
      beam.mat.opacity = beam.lifetime / beam.maxLifetime;
    }
  }
}

const FACTION_COLOR: Record<FactionId, number> = {
  blue: 0x00e0ff,
  red: 0xff4a1a,
};

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function enemyFaction(f: FactionId): FactionId {
  return f === 'blue' ? 'red' : 'blue';
}

// Raider retaliation state — keyed by raider object reference.
// Tracks which tick this raider was last hit by a defender, and which defender id.
type RaiderRetaliationState = {
  lastHitTick: number;      // combat-tick counter when last hit by a defender
  lastHitDefenderId: number; // numeric id of the most-recent attacker defender
};
const raiderRetaliation = new WeakMap<object, RaiderRetaliationState>();

// Global combat tick counter — incremented each tickCombat call.
// Used for retaliation window comparison.
let combatTickCounter = 0;

export type TickCombatArgs = {
  units: {
    workers: CombatWorker[];
    defenders: CombatUnit[];
    raiders: CombatUnit[];
  };
  hqs: { blue: CombatHq; red: CombatHq };
  pointsLedger: PointsLedger;
  dt: number;
  scene: THREE.Scene;
};

// Extended raider interface — raiders produced by raider.ts carry these extra fields.
type RetaliatingRaider = CombatUnit & {
  lastHitByDefenderTick?: number;
  lastHitByDefenderId?: number;
};

// Extended defender interface — defenders produced by defender.ts carry a unitId.
type IdentifiedDefender = CombatUnit & {
  unitId?: number;
};

export function tickCombat({ units, hqs, pointsLedger, dt, scene }: TickCombatArgs): void {
  combatTickCounter++;
  const { workers, defenders, raiders } = units;

  // Collect all active beams for fading.
  const allBeams: AttackBeam[] = [];
  for (const attacker of [...defenders, ...raiders]) {
    const b = attackerBeams.get(attacker);
    if (b !== undefined) allBeams.push(b);
  }
  tickBeams(allBeams, dt);

  // Process defenders — target: any enemy unit or HQ.
  for (const def of defenders) {
    def.attackCooldownRemaining -= dt;
    if (def.attackCooldownRemaining > 0) continue;

    const stats = UNIT_STATS.defender;
    const enemy = enemyFaction(def.faction);
    const hqTarget = hqs[enemy];

    // Collect all valid enemy targets.
    const enemyWorkers = workers.filter((w) => w.faction === enemy);
    const enemyDefenders = defenders.filter((d) => d.faction === enemy);
    const enemyRaiders = raiders.filter((r) => r.faction === enemy);

    type TileTarget = { tileX: number; tileY: number; dist: number } & (
      | { kind: 'unit'; unit: CombatUnit | CombatWorker }
      | { kind: 'hq'; hq: CombatHq }
    );
    const candidates: TileTarget[] = [];

    for (const w of enemyWorkers) {
      const dist = chebyshev(def.tileX, def.tileY, w.tileX, w.tileY);
      if (dist <= stats.range) {
        candidates.push({ kind: 'unit', unit: w, tileX: w.tileX, tileY: w.tileY, dist });
      }
    }
    for (const d of enemyDefenders) {
      const dist = chebyshev(def.tileX, def.tileY, d.tileX, d.tileY);
      if (dist <= stats.range) {
        candidates.push({ kind: 'unit', unit: d, tileX: d.tileX, tileY: d.tileY, dist });
      }
    }
    for (const r of enemyRaiders) {
      const dist = chebyshev(def.tileX, def.tileY, r.tileX, r.tileY);
      if (dist <= stats.range) {
        candidates.push({ kind: 'unit', unit: r, tileX: r.tileX, tileY: r.tileY, dist });
      }
    }
    const hqDist = chebyshev(def.tileX, def.tileY, hqTarget.tileX, hqTarget.tileY);
    if (hqDist <= stats.range) {
      candidates.push({ kind: 'hq', hq: hqTarget, tileX: hqTarget.tileX, tileY: hqTarget.tileY, dist: hqDist });
    }

    if (candidates.length === 0) continue;

    // Pick nearest.
    candidates.sort((a, b) => a.dist - b.dist);
    const target = candidates[0]!;

    let targetPos: THREE.Vector3;

    if (target.kind === 'hq') {
      const { damageDealt } = target.hq.takeDamage(stats.damage);
      targetPos = target.hq.mesh.position.clone();
      target.hq.triggerDamagePulse?.();
      // Accumulate fractional points.
      target.hq.damageAccumulator += damageDealt;
      const pts = Math.floor(target.hq.damageAccumulator / 10);
      if (pts > 0) {
        addPoints(pointsLedger, def.faction, pts);
        target.hq.damageAccumulator -= pts * 10;
      }
    } else {
      const { died, damageDealt: _ } = target.unit.takeDamage(stats.damage);
      targetPos = target.unit.mesh.position.clone();
      target.unit.triggerDamagePulse?.();
      // Track retaliation: if we hit a raider, record this hit on the raider.
      // Tiebreaker for multiple defenders: most-recent hit wins (latest tick wins).
      const hitRaider = target.unit as RetaliatingRaider;
      if (hitRaider.lastHitByDefenderTick !== undefined) {
        const defId = (def as IdentifiedDefender).unitId ?? 0;
        hitRaider.lastHitByDefenderTick = combatTickCounter;
        hitRaider.lastHitByDefenderId = defId;
        // Also write to the WeakMap for the advance-logic's retaliation check.
        raiderRetaliation.set(target.unit, {
          lastHitTick: combatTickCounter,
          lastHitDefenderId: defId,
        });
      }
      if (died) {
        addPoints(pointsLedger, def.faction, 5);
      }
    }

    fireBeam(def, targetPos, scene, FACTION_COLOR[def.faction]);
    def.attackCooldownRemaining = stats.attackCooldown;
  }

  // Process raiders — target: workers + defenders + HQ (nearest, with retaliation priority).
  //
  // Targeting priority per raider:
  //   1. RETALIATE: if a defender hit this raider within RETALIATE_WINDOW_TICKS, target
  //      that defender first (even if it's not the nearest). If out of range, fall through.
  //   2. NEAREST ENEMY: nearest of {workers, defenders, HQ} by Chebyshev. Tiebreaker:
  //      workers before defenders before HQ (first candidate wins on equal dist).
  for (const raider of raiders) {
    raider.attackCooldownRemaining -= dt;
    if (raider.attackCooldownRemaining > 0) continue;

    const stats = UNIT_STATS.raider;
    const enemy = enemyFaction(raider.faction);
    const hqTarget = hqs[enemy];

    const enemyWorkers = workers.filter((w) => w.faction === enemy);
    const enemyDefenders = defenders.filter((d) => d.faction === enemy);

    // -- Retaliation check --
    // Read from the bundle's own retaliation fields (set by defender-hit tracking above).
    const retRaider = raider as RetaliatingRaider;
    if (
      retRaider.lastHitByDefenderTick !== undefined &&
      retRaider.lastHitByDefenderId !== undefined &&
      combatTickCounter - retRaider.lastHitByDefenderTick <= RETALIATE_WINDOW_TICKS
    ) {
      const retaliateId = retRaider.lastHitByDefenderId;
      const retTarget = enemyDefenders.find(
        (d) => (d as IdentifiedDefender).unitId === retaliateId && d.hp > 0,
      );
      if (retTarget !== undefined) {
        const retDist = chebyshev(raider.tileX, raider.tileY, retTarget.tileX, retTarget.tileY);
        if (retDist <= stats.range) {
          // Fire on the retaliation target.
          const { died } = retTarget.takeDamage(stats.damage);
          retTarget.triggerDamagePulse?.();
          fireBeam(raider, retTarget.mesh.position.clone(), scene, FACTION_COLOR[raider.faction]);
          raider.attackCooldownRemaining = stats.attackCooldown;
          if (died) {
            addPoints(pointsLedger, raider.faction, 5);
          }
          continue;
        }
        // Retaliate target out of range — fall through to nearest.
      }
    }

    // -- Nearest enemy targeting --
    // Pool: workers, then defenders, then HQ. All within attack range.
    // Tiebreaker: workers first (appended first), then defenders, then HQ.
    type RaiderTarget =
      | { kind: 'worker'; unit: CombatWorker; dist: number }
      | { kind: 'defender'; unit: CombatUnit; dist: number }
      | { kind: 'hq'; hq: CombatHq; dist: number };
    const candidates: RaiderTarget[] = [];

    for (const w of enemyWorkers) {
      const dist = chebyshev(raider.tileX, raider.tileY, w.tileX, w.tileY);
      if (dist <= stats.range) {
        candidates.push({ kind: 'worker', unit: w, dist });
      }
    }
    for (const d of enemyDefenders) {
      const dist = chebyshev(raider.tileX, raider.tileY, d.tileX, d.tileY);
      if (dist <= stats.range) {
        candidates.push({ kind: 'defender', unit: d, dist });
      }
    }
    const hqDist = chebyshev(raider.tileX, raider.tileY, hqTarget.tileX, hqTarget.tileY);
    if (hqDist <= stats.range) {
      candidates.push({ kind: 'hq', hq: hqTarget, dist: hqDist });
    }

    if (candidates.length === 0) continue;

    // Sort by distance; stable on equal dist due to append order (worker < defender < hq).
    candidates.sort((a, b) => a.dist - b.dist);
    const target = candidates[0]!;

    let targetPos: THREE.Vector3;

    if (target.kind === 'hq') {
      const { damageDealt } = target.hq.takeDamage(stats.damage);
      targetPos = target.hq.mesh.position.clone();
      target.hq.triggerDamagePulse?.();
      target.hq.damageAccumulator += damageDealt;
      const pts = Math.floor(target.hq.damageAccumulator / 10);
      if (pts > 0) {
        addPoints(pointsLedger, raider.faction, pts);
        target.hq.damageAccumulator -= pts * 10;
      }
    } else {
      const unit = target.kind === 'worker' ? target.unit : target.unit;
      const { died } = unit.takeDamage(stats.damage);
      targetPos = unit.mesh.position.clone();
      unit.triggerDamagePulse?.();
      if (died) {
        addPoints(pointsLedger, raider.faction, 5);
      }
    }

    fireBeam(raider, targetPos, scene, FACTION_COLOR[raider.faction]);
    raider.attackCooldownRemaining = stats.attackCooldown;
  }

  // Remove dead units — trigger death pulse if available, defer disposal until pulse completes.
  type DeadUnit = {
    hp: number;
    dispose: (scene: THREE.Scene) => void;
    triggerDeathPulse?: () => void;
    readonly deathPulseActive?: boolean;
  };
  function removeDead<T extends DeadUnit>(arr: T[]): void {
    for (let i = arr.length - 1; i >= 0; i--) {
      const unit = arr[i] as T;
      if (unit.hp <= 0) {
        if (unit.triggerDeathPulse !== undefined && unit.deathPulseActive === false) {
          // Pulse not yet triggered — fire it now and leave the unit in the array.
          unit.triggerDeathPulse();
        } else if (unit.deathPulseActive === true) {
          // Pulse is running — keep the unit in the array until it finishes.
        } else {
          // No pulse support or pulse already done — dispose immediately.
          unit.dispose(scene);
          arr.splice(i, 1);
        }
      }
    }
  }
  removeDead(workers as unknown as DeadUnit[]);
  removeDead(defenders);
  removeDead(raiders);
}

/**
 * Expose the retaliation WeakMap for use by advance.ts — pure read, no mutations.
 * Returns the retaliation state for the given raider object, or undefined.
 */
export function getRaiderRetaliation(raider: object): RaiderRetaliationState | undefined {
  return raiderRetaliation.get(raider);
}

/** Expose combatTickCounter for retaliation window checks in advance.ts. */
export function getCombatTickCounter(): number {
  return combatTickCounter;
}
