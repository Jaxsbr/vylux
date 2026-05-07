// Replay format + Match wrapper.
//
// A replay is the input log + the seed + the version. Anyone running
// the same binary (same `version`) against the same spec + frames must
// reach the same final state hash. This is the contract that makes
// shareable replays viable, and the same property the cross-OS CI gate
// validates against committed golden fixtures.
//
// File format (JSON):
//   {
//     "version": 1,
//     "spec": InitialMatchSpec (seed must be a number, not bigint),
//     "frames": InputFrame[],
//     "finalWinner": 0 | 1 | null (optional, validated when present),
//     "finalHash": "hex string" (optional, validated when present)
//   }
//
// Match is the gameplay-facing wrapper around Sim. The renderer drives
// it with `match.step(commands)`; AI commands and player commands flow
// through the same path. Match owns the input log; replays are produced
// by `match.toReplay()`.

import { tickAi } from './ai';
import type { Command, InputFrame } from './commands';
import { Sim } from './sim';
import type { Faction } from './types';
import type { InitialMatchSpec } from './state';

// Phase 3.0 bumped to v2: structures exist as first-class entities.
// Phase 3.1 bumped to v3: state shape adds `flux` + `tier2Researched`
// per faction, `kind` per node, and `carriedKind` per worker.
// Phase 3.2 bumps to v4: Structure union expands to include
// UpgradeStructure (with researchTicksRemaining); UnitKind adds
// 'vanguard'; commands gain ResearchTier2AtStructure (slot 7) while
// the deprecated standalone ResearchTier2 (slot 6) is retained as a
// reserved enum value per the never-reuse-IDs rule.
// Phase 3.3 bumps to v5: every Unit gains a nullable moveTarget on the
// base; commands gain MoveUnit (slot 8). Hash format extends each
// unit slot by a presence flag + 2 Fixed coords.
// Phase 3.5 bumps to v6: ResourceKind extends with 'blue' + 'red';
// FactionState gains `color`; ResourceNode gains `regenPerTick` +
// `maxReserve`. Every cost path (TrainUnit, BuildStructure,
// TrainAtStructure, ResearchTier2AtStructure) deducts colour. New
// step-loop pass for passive node regen.
// Phase 3.6 bumps to v7: supply system. FactionState gains `supplyCap` +
// `supplyUsed`; UnitStats gains `supplyCost`; new StructureKind
// 'supply' (Pylon) with its own STRUCTURE_STATS row. TrainUnit +
// TrainAtStructure reserve supply at queue time; applyDamage
// decrements on death; recomputeSupplyCaps end-of-step pass derives
// the cap from the count of operational Pylons.
// Phase 3.7 bumps to v8: worker energy dump + trails. New Trail entity
// kind on SimState.trails; Worker gains dumpTicksRemaining +
// dumpCooldownTicks + activeTrailId; FactionState gains
// trailDurationResearched; UpgradeStructure gains researchKind
// discriminator (tier2 / trailDuration / null). Two new commands —
// ActivateEnergyDump (slot 9) + ResearchTrailDurationAtStructure
// (slot 10). Two new step passes — trailKillSweep + advanceTrails.
// Phase 3.8 bumps to v9: fog of war + node discovery. ResourceNode
// gains a per-faction discoveredBy flag (permanent); UnitStats +
// StructureStats gain visionRadius. New step pass advanceDiscovery
// + initial-HQ discovery sweep at createInitialState. Renderer
// filters mesh visibility per playerFaction (presentation-only;
// the sim still hashes the canonical full state).
// Phase 3.10.4–3.10.6 bumps to v10. FactionState gains
// `nextSpawnRotation` (round-robin index for HQ-perimeter spawn);
// Worker gains `targetStructureId` + a new 'building' phase; new
// commands BuildStructureByWorker (slot 11) + AssignWorkerToBuild
// (slot 12). Structures no longer auto-tick build phase — only ticks
// down while ≥1 worker is on site. Workers now stop at the HQ
// perimeter to deposit (HQ_DEPOSIT_REACH_SQ wider than the old
// WORKER_REACH_SQ).
// Phase 3.10.8 bumps to v11 (2026-05-07 PvE pivot cleanup).
// FactionState's `points` field is removed alongside the points-
// threshold win condition — esport-balance scaffolding that doesn't
// fit the PvE direction. HQ destruction is the only winner path until
// 3.13 lands wave-survival + scenario-objective + boss conditions.
// Hash-shape: one fewer i32 per faction (the slot between hqHp and
// supplyCap is gone).
// Phase 3.10.9 bumps to v12 (game-feel pass v2). New step pass
// `applyUnitSeparation` between unit advancement and the trail kill
// sweep — pairwise sqrt-free push-back so stacked units visibly
// separate. Sim STATE shape is unchanged (positions are already in
// the hash) but step SEMANTICS move: movable-unit positions now
// reflect both the move intent and the resolved overlap. Existing v11
// replays still parse but no longer validate against the new sim;
// golden fixtures regenerated.
// Phase 3.10.9 partial revert (2026-05-08) bumps to v13. The
// `applyUnitSeparation` pass and its constants were removed —
// playtest read all three tuning iterations as worse than no
// collision. Sim STATE shape is again unchanged; step semantics
// revert to "advance only" (no separation). HARVEST_AT_NODE_REACH_SQ
// (the widened movingToNode→harvesting transition) is kept. Golden
// fixtures regenerated. Velocity-based steering + collision
// rebuild lands in sub-phase 3.10.10.
// Phase 3.10.10 bumps to v14 (2026-05-08). Per-unit velocity (vx, vy)
// added to UnitBase + the canonical hash. UnitStats gains accel +
// maxSpeed (replacing the prior `speed` field). Movement is no longer
// a position-only Chebyshev clamp — a steering pass accelerates a
// stored velocity toward a desired-velocity vector; integration adds
// velocity to position. New collision pass exchanges (or reflects)
// connecting-axis velocity for overlapping pairs, with an RNG
// perpendicular kick on convergent encounters. End-of-step friction
// pass decays velocity uniformly. Existing v13 replays no longer
// validate against the new sim; golden fixtures regenerated.
// Phase 3.10.10b bumps to v15 (2026-05-08). The one-tick perpendicular
// velocity kick from 3.10.10's first cut was being immediately
// overridden by next-tick steering ("desired = target − pos" with the
// original goal), so units jittered against each other on the
// connecting axis. Replaced with a *sustained* lateral steering bias:
// UnitBase gains `lateralBiasVx`, `lateralBiasVy: Fixed` and
// `lateralBiasTicks: number` (all hashed). On collision the bias is
// set perpendicular to the connecting axis with a sim-RNG sign,
// refreshed (not re-rolled) on subsequent contacts, and cleared by
// the end-of-step decay or by `zeroVelocity` on stationary phase
// transitions. `advanceMovementToward` adds the bias to the desired
// velocity (re-clamped per axis). Result: collisions redirect the
// unit's seek into a curve around the obstacle rather than a 1-D
// bounce loop. Sim shape moves; golden fixtures regenerated.
// Phase 3.10.10d bumps to v17 (2026-05-08). Slot allocation +
// formation retention — the structural fix the lateral-bias work
// couldn't solve on its own. Worker gains `targetNodeSlot: number`
// (0..HARVEST_SLOT_COUNT-1; hashed). On AssignWorkerToNode the worker
// picks the lowest-index unused slot on the target node, and walks to
// `node.center + HARVEST_SLOT_OFFSETS[slot]` (a hex of 6 points at
// radius 0.55 around the node) instead of the node centre — so
// multiple workers commanded to the same node never target the same
// point. On MoveUnit the worker / raider / vanguard picks a formation
// slot (0=centre, 1..6=hex ring at radius 0.7) so a multi-select
// right-click cluster spreads out instead of stacking on the click
// point. Slot picking runs at command-apply time, so a per-tick fan-
// out (N selected units → N sequential commands) gets slots 0..N-1.
// Slot cleared on death + on every code path that drops the node
// assignment (BuildStructureByWorker, AssignWorkerToBuild, depleted-
// node early-out, etc). The 3.10.10c lateral-bias collision pass is
// kept as second-line defence for residual transient overlaps. Sim
// shape moves; golden fixtures regenerated.
// Phase 3.10.10c bumps to v16 (2026-05-08). Same-target deadlock fix:
// 3.10.10b's independent RNG sign per partner collided on the same
// direction ~50% of the time; both partners would then drift in
// lockstep instead of diverging, and the no-re-roll refresh rule
// locked them in that bad state for the full bias lifetime — which
// reproduced cleanly when two workers were sent to the same node.
// Now one sim-RNG draw per pair, A gets `+sign`, B gets `-sign`
// (paired-opposite — partners always diverge on the perpendicular
// axis). The "refresh, don't re-roll" branch is gone too: each
// collision contact dictates direction, last-pair-processed wins for
// a given unit (deterministic; produces Y-shaped resolution in 3-worker
// clumps). Bias magnitude bumped 0.05 → 0.10 (double maxSpeed) so the
// per-axis re-clamp in `advanceMovementToward` pins the perpendicular
// axis to ±maxSpeed regardless of how much budget the connecting axis
// took; lifetime bumped 25 → 30 ticks. Sim shape unchanged (same three
// fields); step semantics + tunings change → golden fixtures
// regenerated.
// Phase 3.10.10e bumps to v18 (2026-05-08). Local-collision revert.
// The velocity layer (`vx, vy` on UnitBase, `accel/maxSpeed` on
// UnitStats) + lateral-bias fields (`lateralBiasVx, lateralBiasVy,
// lateralBiasTicks`) added in 3.10.10 + 3.10.10b were removed; the
// `applyUnitCollisions` + `applyUnitFriction` step passes are gone too.
// Local collision response produced visible glitches the playtest read
// as worse than no collision at all, and the structural same-destination
// case it was patching is solved cleanly by 3.10.10d's slot allocation
// + formation retention. Movement is back to the pre-3.10.10 chebyshev
// step-toward-target model; units pass through each other on the local
// axis between their slot destinations. The 3.10.10d kept fields:
// `Worker.targetNodeSlot` (hashed) for harvest-slot allocation, and
// `MoveUnit` continues to apply formation offsets to `moveTarget`.
// Hash format shrinks: each unit slot loses 5 i32/u32 fields (vx, vy,
// lateralBiasVx, lateralBiasVy, lateralBiasTicks). Golden fixtures
// regenerated.
export const REPLAY_VERSION = 18;

export interface ReplayLog {
  version: number;
  spec: InitialMatchSpec;
  frames: InputFrame[];
  finalWinner?: Faction | null;
  finalHash?: string;
}

export class Match {
  readonly sim: Sim;
  readonly spec: InitialMatchSpec;
  private readonly frames: InputFrame[] = [];

  constructor(spec: InitialMatchSpec) {
    if (typeof spec.seed === 'bigint') {
      // Replay JSON serialisation can't round-trip bigints in Phase 1.
      // The Rng accepts both, but Match only accepts number seeds so a
      // saved replay can be parsed back into the same spec.
      throw new Error('Match: spec.seed must be a number for replay compatibility');
    }
    this.spec = spec;
    this.sim = new Sim(spec);
  }

  // Apply a frame's worth of commands and advance one sim tick. Records
  // the frame in the input log so it can be replayed. Returns true if
  // the match concluded on this tick.
  step(commands: Command[]): boolean {
    const frame: InputFrame = { tick: this.sim.state.tick, commands };
    this.frames.push(frame);
    this.sim.step(frame);
    return this.sim.state.winner !== null;
  }

  get tick(): number {
    return this.sim.state.tick;
  }

  get winner(): Faction | null {
    return this.sim.state.winner;
  }

  toReplay(): ReplayLog {
    return {
      version: REPLAY_VERSION,
      spec: this.spec,
      frames: this.frames.slice(),
      finalWinner: this.sim.state.winner,
      finalHash: this.sim.stateHash(),
    };
  }
}

// Run a replay deterministically. Returns the final state hash and the
// per-tick hash stream (one entry per tick from tick=0 inclusive).
//
// Throws if the replay's `finalHash` is present and doesn't match the
// reproduced final hash. This is the production "did this replay drift"
// check; passing it is the property the cross-OS CI gate validates.
export interface ReplayResult {
  finalHash: string;
  hashes: string[];
  tick: number;
  winner: Faction | null;
}

export function playReplay(replay: ReplayLog): ReplayResult {
  if (replay.version !== REPLAY_VERSION) {
    throw new Error(
      `playReplay: unsupported version ${replay.version} (expected ${REPLAY_VERSION})`,
    );
  }
  const sim = new Sim(replay.spec);
  const hashes: string[] = [sim.stateHash()];
  for (const frame of replay.frames) {
    sim.step(frame);
    hashes.push(sim.stateHash());
  }
  const finalHash = sim.stateHash();
  if (replay.finalHash !== undefined && replay.finalHash !== finalHash) {
    throw new Error(
      `playReplay: final-hash mismatch (expected ${replay.finalHash}, got ${finalHash})`,
    );
  }
  if (replay.finalWinner !== undefined && replay.finalWinner !== sim.state.winner) {
    throw new Error(
      `playReplay: winner mismatch (expected ${replay.finalWinner}, got ${sim.state.winner})`,
    );
  }
  return {
    finalHash,
    hashes,
    tick: sim.state.tick,
    winner: sim.state.winner,
  };
}

export function serialiseReplay(replay: ReplayLog): string {
  return JSON.stringify(replay, null, 2);
}

export function parseReplay(json: string): ReplayLog {
  const obj = JSON.parse(json) as ReplayLog;
  if (typeof obj.version !== 'number' || obj.version !== REPLAY_VERSION) {
    throw new Error(`parseReplay: unsupported version ${obj.version}`);
  }
  if (!obj.spec || !Array.isArray(obj.frames)) {
    throw new Error('parseReplay: malformed replay (missing spec or frames)');
  }
  return obj;
}

// Convenience runner for AI-vs-AI matches: the runner concatenates AI
// commands for both factions each tick and records the result. Useful
// for generating sample replays from headless tests.
export function runAiVsAiToReplay(spec: InitialMatchSpec, maxTicks: number): Match {
  const match = new Match(spec);
  for (let t = 0; t < maxTicks && match.winner === null; t++) {
    const cmds = [...tickAi(match.sim.state, 0), ...tickAi(match.sim.state, 1)];
    match.step(cmds);
  }
  return match;
}
