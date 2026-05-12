// Shape of the deterministic sim's state.
//
// Design rules in this module:
// - Every field that affects state is either an integer or a Fixed (Q16.16).
//   No floats, no Date, no perf-now.
// - Entities live in arrays indexed by stable IDs (1-based, monotonic).
//   Removals leave a tombstone (alive=false) rather than splicing — this
//   keeps the array order stable across removals so iteration is
//   deterministic without sorting.
// - Mutation is in-place during step(); snapshots come from hash() and
//   from the replay-record layer that records the input log alongside
//   the seed.
//
// Phase C.1 (2026-05-12): work pods + worker charge layered on top of the
// Phase A reset surface. Workers now carry their own energy charge and
// have to recharge at a friendly work pod (or HQ, slower fallback).
// Each task drains 1 charge at start; movement is free while charge > 0
// but a 0-charge worker is locked into charge mode until full recharge.

import type { Fixed } from './fixed';

export type Faction = 0 | 1;

// Faction identity. Faction 0/1 is the player-slot discriminator (who
// owns what entity); FactionId is which *kind* of faction is being
// played in that slot. Per-faction stat overrides (units-config.ts) and
// per-faction macro picks (ai.ts) read off this field.
export type FactionId = 'swarm' | 'siege';

export function opposingFactionId(id: FactionId): FactionId {
  return id === 'swarm' ? 'siege' : 'swarm';
}

// Worker is the only unit kind. Combat units return in Phase D.
export type UnitKind = 'worker';

// Energy is the only live resource. Matter (construction material) lands
// in Phase C.2.
export type ResourceKind = 'energy';

// Phase C.1: only the work pod survives in the structures union. Future
// sub-phases re-introduce more kinds (HQ research host, combat-unit
// production buildings) — each as a new union member.
export type StructureKind = 'workPod';

// Phase C.1 expansion: which research the faction is currently spending
// on. `null` = idle (no research in progress). Adding a new research
// kind = adding a new string literal here; the at-most-one-active-
// research rule stays.
export type ResearchKind = 'autoResume';

export interface FactionState {
  factionId: FactionId;
  hqX: Fixed;
  hqY: Fixed;
  energy: Fixed;
  // HQ hit-points. Reaching 0 ends the match — the OTHER faction wins.
  // HQ destruction + Resign are the only paths to a winner.
  hqHp: Fixed;
  // Round-robin index for HQ-perimeter spawn placement (workers don't
  // spawn on the HQ tile itself; an offset table picks one of eight
  // surrounding tiles per spawn).
  nextSpawnRotation: number;
  // Phase C.1: worker supply cap. supplyCap starts at HQ_SUPPLY_CAP_INITIAL
  // and grows by WORK_POD_CAP_BONUS per operational work pod. supplyUsed
  // is the count of alive friendly workers (recomputed end-of-step so
  // train-time checks see a stable value).
  supplyCap: number;
  supplyUsed: number;
  // Phase C.1 research slot. Faction-level (not per-pod) — researching
  // at any operational pod kicks off the shared timer; once complete,
  // every owned worker reads the flag and benefits. Single-slot for
  // now: a faction can't research two things at once.
  researchingKind: ResearchKind | null;
  researchTicksRemaining: number;
  // Phase C.1 first research result: workers automatically resume the
  // last harvest target after charging. Without this flag, workers
  // park at idle post-charge and need a new player command.
  autoResumeResearched: boolean;
}

// Phase C.1 adds four worker phases:
//   movingToBuildSite — walking to construct a work pod
//   building          — at the pod tile, ticking construction
//   walkingToCharge   — energy depleted, walking to nearest pod (or HQ)
//   charging          — at the charge spot, ticking energy back up
// `walkingToCharge` + `charging` together are CHARGE MODE — both are
// uninterruptible. Player commands targeting a worker in charge mode are
// silently rejected; the renderer surfaces a floating "needs energy"
// lightning cue on the worker.
export type WorkerPhase =
  | 'idle'
  | 'movingToNode'
  | 'harvesting'
  | 'returning'
  | 'movingToBuildSite'
  | 'building'
  | 'walkingToCharge'
  | 'charging';

// Common fields on every unit. attackCooldown is kept on the base for
// hash-stability and forward-compat (combat units return in Phase D);
// it stays at 0 for workers.
interface UnitBase {
  id: number;
  alive: boolean;
  faction: Faction;
  x: Fixed;
  y: Fixed;
  hp: Fixed;
  attackCooldown: number;
  moveTarget: { x: Fixed; y: Fixed } | null;
}

export interface Worker extends UnitBase {
  kind: 'worker';
  phase: WorkerPhase;
  targetNodeId: number; // 0 = no target
  carrying: Fixed; // amount of resource in transit (always non-negative)
  // Always set to a canonical value so determinism doesn't depend on
  // null vs 'energy' when carrying === 0; the hash treats this field as
  // part of the worker's state regardless. Default 'energy' on spawn.
  carriedKind: ResourceKind;
  harvestTicksRemaining: number;
  // Harvest slot allocation (Phase 3.10.10d, kept). Each resource node has
  // HARVEST_SLOT_COUNT hex-arranged slot positions; on AssignWorkerToNode
  // the worker picks the lowest-index unused slot, so multiple workers
  // commanded to the same node cluster around it without ever targeting
  // the same point. Slot is reserved while targetNodeId === node.id.
  targetNodeSlot: number;
  // Phase C.1: per-worker energy charge. Drained 1 per task at task-start
  // (harvest cycle = 1, build action = 1). Movement is free while > 0.
  // At 0 the worker enters charge mode (walkingToCharge → charging) and
  // refuses all player commands until charge === maxCharge. Both stored
  // as integers; `charge` is non-negative.
  charge: number;
  maxCharge: number;
  // Phase C.1: structure id this worker is constructing (0 = none). Set
  // when BuildStructureByWorker is applied; the worker walks to the
  // structure tile and ticks down its buildTicksRemaining each tick
  // while within reach. Reset to 0 on construction complete or on the
  // worker dropping the build assignment.
  targetStructureId: number;
  // Phase C.1: structure id of the charge spot the worker is heading
  // toward (or sitting at). 0 means the spot is the friendly HQ — there
  // can only be one HQ, so the faction-on-Worker disambiguates it.
  chargeTargetStructureId: number;
  // Phase C.1: ticks accumulated while in the `charging` phase. Used
  // alongside the per-spot charge rate (pod or HQ) to decide when the
  // next charge unit lands.
  chargeTicksAccrued: number;
  // Phase C.1 auto-resume: the harvest node this worker was on before
  // entering charge mode. Captured at the charge transition; consulted
  // when the worker fully charges and the faction has the auto-resume
  // research. 0 = no previous harvest target (no auto-resume eligible).
  // Reset by any task-replacing command (AssignWorkerToNode picks a
  // new node, BuildStructureByWorker, MoveUnit).
  previousNodeId: number;
  // Phase C.1 charge-slot allocation. Assigned at charge-mode entry
  // — the lowest-index unused slot at the chosen charge spot (pod
  // structure id, or 0 = HQ; the worker's faction disambiguates HQ).
  // Same idiom as harvest slots: prevents workers from stacking on
  // the same point while charging. Cleared (back to 0) when the
  // worker exits charge mode.
  chargeSlot: number;
}

export type Unit = Worker;

export interface ResourceNode {
  id: number;
  alive: boolean;
  kind: ResourceKind;
  x: Fixed;
  y: Fixed;
  remaining: Fixed;
  // Per-faction discovery flag — permanent once set (no fog-of-war
  // rediscovery). Set by the discovery sweep when any of the faction's
  // alive units / HQ comes within their vision radius of the node.
  discoveredBy: [boolean, boolean];
}

// Pre-strip alias retained so any lingering `EnergyNode` reference still
// type-checks; new code should reach for ResourceNode.
export type EnergyNode = ResourceNode;

// Phase C.1: WorkPod is the only structure kind in the active sim.
// Build phase ticks down only while a worker is on site (the
// `building` worker phase covers that — advanceStructure does not
// auto-tick build progress).
export interface WorkPod {
  id: number;
  alive: boolean;
  faction: Faction;
  kind: 'workPod';
  x: Fixed;
  y: Fixed;
  hp: Fixed;
  // Ticks remaining until operational. Decrements only while a worker
  // is on site (within WORK_POD_BUILD_REACH_SQ of x,y) in the `building`
  // phase. At 0 the pod is operational — provides a +cap bonus + acts
  // as a charge spot.
  buildTicksRemaining: number;
}

export type Structure = WorkPod;

export interface SimState {
  tick: number;
  rngState: bigint; // mirror of Rng.snapshot() — owned-but-mirrored for hash
  factions: [FactionState, FactionState];
  units: Unit[];
  nodes: ResourceNode[];
  // Phase C.1: structures array re-introduced (scoped to WorkPod).
  // Same array-with-tombstones discipline as units.
  structures: Structure[];
  nextEntityId: number;
  // Set when a faction's HQ is destroyed (the OTHER faction wins) or
  // when the OTHER faction issues a Resign command.
  winner: Faction | null;
}
