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
// Phase 3.11b bumps to v19 (2026-05-08). FactionState gains `factionId:
// 'swarm' | 'siege'`; hashed as a u32 slot per faction (0=swarm,
// 1=siege).
// Phase A bumps to v20 (2026-05-10). Catalogue strip — combat units
// (Defender / Raider / Vanguard), structures (Forge / Spire / Pylon),
// research (Tier-2 / Trail+), the energy-dump ability + Trail entities,
// the Flux + Colour resources, and the supply system are all out.
// Phase C.1 bumps to v21 (2026-05-12). Worker carries per-unit charge
// (`charge`, `maxCharge`, `chargeTicksAccrued`) + new task targets
// (`targetStructureId`, `chargeTargetStructureId`). WorkerPhase adds
// 'movingToBuildSite' | 'building' | 'walkingToCharge' | 'charging'.
// SimState.structures re-enters the canonical shape (scoped to
// WorkPod). FactionState gains `supplyCap` + `supplyUsed`. CommandKind
// `BuildStructureByWorker = 11` is un-retired with the same shape it
// had pre-Phase-A.
// Phase C.1 follow-up bumps to v22 (2026-05-12). Faction-level research
// slot — FactionState gains `researchingKind` + `researchTicksRemaining`
// + `autoResumeResearched`. Worker gains `previousNodeId` (auto-resume
// memory). New CommandKind.StartResearchAtPod = 14. Currently a single
// research kind ('autoResume'): on completion, workers automatically
// resume their last harvest after charging.
// Phase C.1 follow-up bumps to v23 (2026-05-12). Charge-spot slot
// allocation — Worker gains `chargeSlot` (hashed; 0 when not in
// charge mode). Workers heading to the same pod / HQ pick distinct
// hex / octagonal offsets so they don't stack on one point. Same
// idiom as harvest-slot allocation at energy nodes. Golden fixtures
// regenerated.
// Phase C.2 bumps to v24 (2026-05-23). Worker training is queued + timed,
// not instant. FactionState gains `trainQueue: TrainQueueItem[]` +
// `trainTicksRemaining`; UNIT_STATS.worker.trainTicks is now 40 (2 s).
// TrainUnit pays energy + reserves supply at enqueue (supplyUsed + queue
// length must stay under the cap; queue capped at MAX_TRAIN_QUEUE=5);
// a new advanceProduction step pass spawns the head on completion. The
// hash gains the head timer + queue contents per faction. Two latent
// faction-override bugs fixed alongside: spawnUnit now sources maxHp
// from the per-faction stats (Swarm 30 / Siege 60, not a flat 40) and
// TrainUnit charges the per-faction trainCost (40 / 60, not a flat 50).
// Golden fixtures regenerated.
// Phase C.6.5 follow-up bumps to v25 (2026-05-24). Faction balance: the Siege
// worker's stat overrides are flattened to Swarm's (speed 0.055 / trainCost 40
// / maxHp 30) and Siege's harvest interval matches Swarm's (harvestTicks 23) —
// the slower + costlier Siege worker made the faction strictly worse, so the
// asymmetry is parked until combat units return (Phase D). Sim STATE shape is
// unchanged — only per-faction stat VALUES move — but per the version contract
// any pre-bump v24 replay no longer loads (parseReplay + playReplay reject any
// version ≠ the current one). Golden fixtures regenerated. (The
// C.6.5 map work itself — 64² grid + randomised energy field — needed no bump:
// it's render + spec-builder only, and the golden fixtures use their own
// scripted-match specs.)
// Phase C.6.6 bumps to v26 (2026-05-26). Workers gained **grid A* pathfinding**
// (`pathfind.ts`): a cached waypoint route planned around inflated tile
// footprints, walked with a plain straight step (no steering layer — an
// earlier A*+steering hybrid was reverted for frame jitter + oscillation).
// Workers gained two hashed fields (`path` + `pathGoalTile`), so the state
// shape — and every per-tick hash — changes; all three golden fixtures
// regenerated. `gridSize` is static config and is NOT hashed.
// Phase C.6.7 bumps to v27 (2026-05-26). Fog foundation: SimState gains a
// per-faction explored-TILE set (`explored: [Uint8Array, Uint8Array]`, one
// byte per tile, length gridSize²), seeded by an initial-HQ exploration
// sweep and advanced each tick by a new `advanceExploration` pass (same
// vision sources as advanceDiscovery — HQ + units + operational pods — but
// marking tiles, using the pathfind tile convention so the fog aligns with
// the A* grid). The set is folded into the canonical hash (a compact 32-bit
// checksum per bitmap via Hasher.writeBytes, not a per-byte BigInt mix), so
// the per-tick hash changes and all three golden fixtures regenerate. Node
// `discoveredBy` is unchanged → AI behaviour is byte-identical; this is a
// pure additive-state refactor. The render `Exploration` now reads this set
// instead of recomputing its own (one source of truth). `gridSize` stays
// static config (NOT hashed); only the bitmap contents are.
// Phase C.6.8 bumps to v28 (2026-05-26). Scout order: WorkerPhase gains
// 'scouting' (a new hashed enum VALUE, not a new field) and the wire format
// gains CommandKind.ScoutWorker = 15. On apply the worker auto-targets the
// nearest unexplored tile (from the faction's explored set — no node peeking),
// reuses the existing `moveTarget` field to walk there, reveals fog en route,
// and re-picks the frontier until the map is fully revealed (then drops to
// idle). No new STATE field — the 'scouting' phase rides the existing
// workerPhaseToInt slot and moveTarget — so the golden fixtures DON'T move
// (the scripted + AI-vs-AI matches never issue a scout; AI scouting lands in
// C.6.10). The version still bumps because the command set expanded: a v27
// binary replaying a log containing a ScoutWorker would silently drop it.
// Phase C.6.10 bumps to v29 (2026-05-26). AI scouting. Worker gains a hashed
// `idleTicks` counter (consecutive stalled-idle ticks), maintained by a new
// `updateIdleTimers` step pass; the AI (`dispatchScouts` in ai.ts) reads it to
// send stalled workers — idle past AI_IDLE_SCOUT_TICKS with no discovered live
// node to harvest — scouting, scaling the scout count with the stall (≈ half,
// capped at AI_MAX_SCOUTS) and never scouting a fully-revealed map. The new
// field changes the per-tick hash (idle workers tick it every frame) AND the
// AI now plays differently once its home patch depletes, so all three golden
// fixtures regenerate.
// Pre-Phase-D ad-hoc pass bumps to v30 (2026-05-27). Two sim changes: (1)
// charge-spot picking now chooses the physically NEAREST of {nearest pod, HQ}
// instead of always preferring a pod — a worker stops trekking across the map
// past its own HQ to a distant pod (pickChargeTarget rewrite); (2) the
// previously-reserved CommandKind.AssignWorkerToBuild = 12 is now live — it
// assigns a worker to FINISH an existing partial build (no spawn, no re-paid
// Energy), rescuing a half-built pod abandoned by its original builder. State
// SHAPE is unchanged, but charge-target choice changes worker routing and the
// command set expands, so all three golden fixtures regenerate (an idle-worker
// charge near both an HQ and a pod can now land at a different spot).
// Ad-hoc follow-up bumps to v31 (2026-05-27). Scouting is now FREE: the
// ScoutWorker command no longer drains a charge (scouting is exploration /
// movement, not an energy-burning task). It still requires a controllable
// worker (≥1 charge, not in charge mode) to start, but it spends nothing — so
// a worker can scout on 1 charge and keep it, fixing the bug where a worker
// sent to scout with its last charge dropped to 0 and got stranded scouting
// the fog forever (uncontrollable). State SHAPE is unchanged, but every AI
// scout now retains the charge it previously spent, so the AI-vs-AI golden
// fixture moves (the AI scouts in that match); it's regenerated. The two
// scripted harvest fixtures never scout, so they don't move.
//
// v32 (pre-Phase-D scored match): adds `FactionState.energyHarvested` (Fixed,
// hashed) — cumulative deposited energy, the spine of the new timed-match
// score. Spec gains an optional `matchLengthTicks` that opts the match into
// the timed/exhaustion end with a deterministic score-based winner (see
// sim/score.ts + checkWinner). The new field changes the hash even when
// matchLengthTicks is unset, so every fixture regenerates. The mirrored
// energy field (map-gen.ts now generates source-half + 180° rotation) only
// affects callers that go through generateEnergyField — the determinism
// goldens build their own hand-spec, so node positions don't move there.
//
// v33 (Phase D.1 — Matter + cost split): adds `FactionState.matter` (Fixed,
// hashed) — the second spendable resource. `ResourceKind` gains 'matter', so
// nodes + carried loads can now hash as kind=1; the worker deposit site
// credits `matter` (matter is build-time-only, not scored, so there's no
// cumulative twin). Costs generalised to `{ energy?, matter? }`: the work pod
// now costs 40 E + 30 M (was 60 E). Spec node shape renamed `energy`→`amount`
// + optional `kind`; spec gains optional `initialMatter`. The new faction
// field changes the hash on every tick, so every fixture regenerates; the
// AI-vs-AI gate also now seeds a matter node + the AI harvests/spends it.
//
// v34 (Phase D.1 follow-up): matter now FEEDS THE SCORE — adds cumulative
// `FactionState.matterHarvested` (Fixed, hashed), the monotonic twin of
// energyHarvested. The score spine becomes total resources harvested
// (energy + matter); checkWinner / scoreBreakdown / the tie-break read both.
// New hashed field → every fixture regenerates. (Match length 5→15 min is a
// spec value, not hashed — it doesn't move the goldens.)
export const REPLAY_VERSION = 34;

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
