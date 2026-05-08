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

import type { Fixed } from './fixed';

export type Faction = 0 | 1;

// Phase 3.11b: faction identity. Faction 0/1 is the player-slot
// discriminator (who owns what entity); FactionId is which *kind* of
// faction is being played in that slot. The two are orthogonal — a
// player can pick swarm, in which case faction 0 has factionId
// 'swarm' and faction 1 has factionId 'siege' (or vice versa).
//
// FactionId lives on FactionState so per-faction stat overrides
// (units-config.ts) and per-faction macro picks (ai.ts) can be looked
// up from a Faction. Hashed so replays preserve the asymmetry.
export type FactionId = 'swarm' | 'siege';

export function opposingFactionId(id: FactionId): FactionId {
  return id === 'swarm' ? 'siege' : 'swarm';
}

// Phase 3.2: 'vanguard' is the first tier-2 unit. Trained at production
// buildings once the faction has researched tier-2 at an upgrade
// structure. Bigger, slower, costs both Energy and Flux. Faction-
// asymmetric naming + per-faction tier-2 rosters arrive in 3.4.
export type UnitKind = 'worker' | 'defender' | 'raider' | 'vanguard';

// Phase 3.1: two-resource economy. Energy is the workhorse (gathered
// from scattered nodes, used for tier-1 production). Flux is scarce
// and contested (gathered from a small set of high-value nodes near
// contested zones, used for tier-2 production from 3.2 onward).
//
// Phase 3.5 adds the third + fourth kinds — `blue` and `red` are the
// faction-locked colour resources. Each faction can only harvest its
// own colour (blue → faction 0, red → faction 1, see FACTION_COLOR
// below). Required for every unit and every building. Colour nodes
// regenerate over time (see ResourceNode.regenPerTick), so the
// resource isn't a hard scarcity — but an enemy that pushes you off
// your colour nodes locks you out of production until you reclaim them.
export type ResourceKind = 'energy' | 'flux' | 'blue' | 'red';

// Faction → its own-colour ResourceKind. Faction 0 (cyan in the
// renderer) maps to 'blue'; faction 1 (red-orange) maps to 'red'.
// The cost-path checks in step.ts and the AI's worker bias both
// consult this lookup; keeping it as a single source of truth here
// means a future Phase 4+ "third faction with green colour" lands as
// one extra row.
export const FACTION_COLOR: Record<Faction, 'blue' | 'red'> = {
  0: 'blue',
  1: 'red',
};

export interface FactionState {
  // Phase 3.11b: which faction *kind* is being played in this slot.
  // Hashed; replays carry it in the header so deterministic playback
  // honours the asymmetry. Per-faction stat overrides + AI macro reads
  // discriminate on this field.
  factionId: FactionId;
  hqX: Fixed;
  hqY: Fixed;
  energy: Fixed;
  // Phase 3.1: scarce / contested resource. Tier-1 production stays
  // Energy-only; Phase 3.2 introduces tier-2 costs that gate on Flux.
  flux: Fixed;
  // Phase 3.5: faction-locked colour pool. Drained by every unit-train
  // + every structure-build + tier-2 research. Refilled only by
  // workers harvesting from the faction's own-colour nodes (blue for
  // faction 0, red for faction 1; see FACTION_COLOR). When this pool
  // hits 0 the faction is locked out of all production until it can
  // harvest more — the lockout-by-denial mechanic.
  color: Fixed;
  // Phase 3.1: placeholder boolean that tier-2 production (3.2) reads
  // to know whether the upgrade has been researched. ResearchTier2
  // command flips this; in 3.1 the only effect is the Flux deduction
  // itself (and the flag — observable in the hash for tests).
  tier2Researched: boolean;
  // HQ hit-points. Reaching 0 ends the match — the OTHER faction wins.
  // Post-2026-05-07 PvE pivot: HQ destruction is the ONLY win/loss
  // condition until 3.13's wave-survival lands. The previous
  // points-threshold path was esport-balance scaffolding and has been
  // removed; see PRD §0 + §6.7.
  hqHp: Fixed;
  // Phase 3.6: supply system. supplyUsed sums the supplyCost of every
  // alive unit owned by this faction; supplyCap is the cap that bounds
  // it. Train commands silently reject when supplyUsed + cost > cap.
  // supplyCap = SUPPLY_CAP_INITIAL + SUPPLY_CAP_BONUS_PER_PYLON × the
  // number of operational supply structures owned by this faction;
  // recomputed at the end of each step so a Pylon completing builds (or
  // dying) flips the cap on the next tick's commands.
  supplyCap: number;
  supplyUsed: number;
  // Phase 3.7: when true, trail segments owned by this faction live for
  // 2 × TRAIL_SEGMENT_LIFETIME instead of the base. Researched at a
  // Spire via ResearchTrailDurationAtStructure. Already-spawned trails
  // pick up the new lifetime too — the segment-age check looks up the
  // owner faction's flag at expiry-time, not at spawn-time.
  trailDurationResearched: boolean;
  // Phase 3.10.4: round-robin index for HQ-perimeter spawn placement.
  // Each TrainUnit at the HQ picks an offset from a fixed table of
  // perimeter tiles using `nextSpawnRotation % N`, then increments.
  // Workers no longer spawn on the HQ tile itself (selection collision
  // + visual overlap with the bigger HQ silhouette from 3.9.3).
  nextSpawnRotation: number;
}

// Phase 3.10.6: 'building' added — a worker assigned to construct an
// in-progress structure walks to it, then ticks down its
// buildTicksRemaining each tick while present. Multiple workers on the
// same structure stack contributions. Only structures spawned via the
// BuildStructureByWorker command (StructureBase.builtByWorker = true)
// require a worker to construct; legacy BuildStructure spawns
// already-operational and is used for test setup.
export type WorkerPhase = 'idle' | 'movingToNode' | 'harvesting' | 'returning' | 'building';

// Common fields on every unit. Combat applies to all units (workers can
// be killed by raiders), so HP and cooldown live here. attackCooldown is
// always present but is meaningless for units whose kind has zero damage
// (workers); the field is kept on the base for hash-stability across
// kinds rather than as kind-specific data.
//
// Phase 3.3: moveTarget is the manual move-order destination from a
// MoveUnit command. null means "no manual order; default behaviour."
// Workers with moveTarget set walk to it and then idle there (the field
// stays set as a 'parked here' marker so autoAssignIdleWorkers skips
// them — without that, the next AI/auto tick would re-route them to the
// nearest node and erase the player's order). Raiders + vanguards treat
// it as a temporary override of the march-to-HQ default; on arrival the
// field clears and they resume default behaviour. Defenders ignore the
// field (stationary). The field lives on UnitBase so the hash slot is
// uniform across kinds.
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
// Phase 3.10.10e (2026-05-08): the velocity / friction / lateral-bias
// fields added in 3.10.10 + 3.10.10b were reverted. The local-collision
// machinery they fed produced glitches the playtest read as worse than
// no collision at all, and slot allocation + formation retention
// (3.10.10d) solved the structural same-destination case the bias was
// trying to patch over. Movement is back to the pre-3.10.10 chebyshev
// step-toward-target model — units pass through each other on the
// local axis. The 3.10.10d slot + formation work is what's kept.

export interface Worker extends UnitBase {
  kind: 'worker';
  phase: WorkerPhase;
  targetNodeId: number; // 0 = no target
  carrying: Fixed; // amount of resource in transit (always non-negative)
  // Phase 3.7: energy-dump state. While dumpTicksRemaining > 0 the
  // worker moves at DUMP_SPEED_MULTIPLIER × normal speed and lays a
  // trail segment after each move. When the timer hits 0, dumpCooldown
  // Ticks is set so the worker can't immediately re-dump. activeTrailId
  // points at the Trail entity segments are appended to (0 = no
  // active trail). All three reset to 0 on death (canonical reset for
  // hash stability, same shape as carriedKind).
  dumpTicksRemaining: number;
  dumpCooldownTicks: number;
  activeTrailId: number;
  // Which resource is currently being carried. Always set to a
  // canonical value so determinism doesn't depend on null vs 'energy'
  // when carrying === 0; the hash treats this field as part of the
  // worker's state regardless. Default 'energy' on spawn / reset.
  carriedKind: ResourceKind;
  harvestTicksRemaining: number;
  // Phase 3.10.6: structure id this worker is assigned to construct
  // (0 = none). When non-zero and phase === 'building', the worker
  // walks to the structure tile and ticks down its buildTicksRemaining
  // each tick while in range. Reset to 0 on death + on build complete.
  targetStructureId: number;
  // Phase 3.10.10d: harvest slot allocation. When AssignWorkerToNode
  // lands the worker picks the lowest-index unused slot on the target
  // node (0..HARVEST_SLOT_COUNT-1, or 0 if all are taken — overflow
  // stacks). The worker walks to `node.center + HARVEST_SLOT_OFFSETS
  // [slot]` rather than to the node center, so multiple workers
  // commanded to the same node cluster around it without ever
  // targeting the same point. Slot is reserved while
  // `targetNodeId === node.id`; cleared (back to 0) when the worker
  // drops the node assignment (death, BuildStructureByWorker,
  // depleted-node early-out, etc).
  targetNodeSlot: number;
}

export interface Defender extends UnitBase {
  kind: 'defender';
  // Defenders are stationary in Phase 1 — no movement state required.
  // Add patrol targets later if the design calls for it.
}

export interface Raider extends UnitBase {
  kind: 'raider';
  // Raiders march toward the enemy HQ by default. No explicit target
  // field yet — the step function reads the opposing faction's HQ
  // directly. Adding a per-raider override (e.g. "attack this worker")
  // is straightforward when the design needs it.
}

export interface Vanguard extends UnitBase {
  kind: 'vanguard';
  // Phase 3.2 tier-2 unit. Behaves like a heavier raider for now —
  // marches toward the enemy HQ, attacks units / structures / HQ in
  // priority order. Per-vanguard target overrides arrive when factions
  // diverge in 3.4.
}

export type Unit = Worker | Defender | Raider | Vanguard;

// Phase 3.1: nodes carry a discriminator to distinguish Energy from
// Flux. The interface name stays generic; the prior `EnergyNode` was a
// misnomer once a second resource exists.
//
// Phase 3.5 adds passive regen. Each tick a node's `remaining` heals
// toward `maxReserve` by `regenPerTick`. Energy + Flux nodes have
// `regenPerTick === 0` so the existing economy is unchanged — they
// still deplete and die at empty (see step.advanceNode for the
// "regen-zero nodes die at remaining<=0" rule). Colour nodes have a
// non-zero regen so a denied faction recovers slowly.
export interface ResourceNode {
  id: number;
  alive: boolean;
  kind: ResourceKind;
  x: Fixed;
  y: Fixed;
  remaining: Fixed;
  // Per-tick regen amount, capped at maxReserve. 0 disables regen
  // (Energy + Flux). Colour nodes have a positive value tuned in 3.12.
  regenPerTick: Fixed;
  // Upper bound that `remaining` can regen to. Set to the initial
  // remaining for non-regen nodes so the cap is a no-op there;
  // colour nodes use the value from COLOR_NODE_STATS so a fully-
  // depleted node refills back to the same ceiling.
  maxReserve: Fixed;
  // Phase 3.8: per-faction discovery flag. Permanent — once set, never
  // unset (no fog-of-war rediscovery). Set by the discovery sweep when
  // any of the faction's units / structures comes within their vision
  // radius of the node's tile. Both renderer (showing the node) and AI
  // (auto-routing workers to harvestable nodes) consult this flag;
  // the player's input layer also gates AssignWorkerToNode picks on
  // discovery so they can't click an undiscovered node off-screen.
  discoveredBy: [boolean, boolean];
}

// Phase 1 export name retained as an alias so call sites already
// using `EnergyNode` keep compiling; new code should reach for
// `ResourceNode`.
export type EnergyNode = ResourceNode;

// Structures are first-class sim entities introduced in Phase 3.0. They
// have HP, position, faction, and (for production kinds) a build phase
// followed by a training phase. The HQ remains a special case on
// FactionState for now — migrating it into this structures array is a
// later sub-phase concern (see investigation 04, sub-phase notes).
//
// Production buildings train combat units. Workers continue to train at
// the HQ; per PRD §6.4 the HQ is the worker-only economy structure, and
// any combat training has to flow through a production building that
// can itself be denied by the opponent.
//
// Phase 3.2 adds the 'upgrade' kind — an upgrade structure ("Spire")
// that researches tier-2 once built. While research is running, the
// structure is occupied; on completion, the faction's tier2Researched
// flag is set and tier-2 production at any production building unlocks.
//
// Phase 3.6 adds the 'supply' kind — a Pylon. Pure-passive structure:
// build phase only, no train queue, no research. While operational it
// contributes SUPPLY_CAP_BONUS_PER_PYLON to its faction's supplyCap.
export type StructureKind = 'production' | 'upgrade' | 'supply';

export interface ProductionBuilding {
  id: number;
  alive: boolean;
  faction: Faction;
  kind: 'production';
  x: Fixed;
  y: Fixed;
  hp: Fixed;
  // While building: counts down from buildTicksTotal to 0. Operational
  // when 0. Cannot train units while building.
  buildTicksRemaining: number;
  // Active training. Null when idle. The single-slot model is a
  // deliberate Phase 3.0 simplification — multi-slot queues land in a
  // later pass once the basic flow is proven.
  trainingKind: UnitKind | null;
  trainTicksRemaining: number;
  // Phase 3.10.6: true when this structure was placed via
  // BuildStructureByWorker — buildTicksRemaining ticks down only when
  // a worker is on site (advanceWorkerPhase 'building' case). Legacy
  // BuildStructure spawns operational + sets this false.
  builtByWorker: boolean;
}

export interface UpgradeStructure {
  id: number;
  alive: boolean;
  faction: Faction;
  kind: 'upgrade';
  x: Fixed;
  y: Fixed;
  hp: Fixed;
  // Same build-phase semantics as ProductionBuilding.
  buildTicksRemaining: number;
  // Active research. 0 when idle. Single-slot — only one research at a
  // time. Phase 3.7 added researchKind so the same slot can host
  // multiple researches (tier-2 + trail-duration); on completion the
  // research-kind dispatch sets the appropriate faction-level flag.
  researchTicksRemaining: number;
  researchKind: 'tier2' | 'trailDuration' | null;
  builtByWorker: boolean;
}

// Phase 3.6: Pylon. Build-phase-only — no queue, no research, no
// per-tick activity. While alive AND operational
// (buildTicksRemaining === 0) it contributes SUPPLY_CAP_BONUS_PER_PYLON
// to its faction's supplyCap (recomputed at end of each step).
export interface SupplyStructure {
  id: number;
  alive: boolean;
  faction: Faction;
  kind: 'supply';
  x: Fixed;
  y: Fixed;
  hp: Fixed;
  buildTicksRemaining: number;
  builtByWorker: boolean;
}

export type Structure = ProductionBuilding | UpgradeStructure | SupplyStructure;

// Phase 3.7: a Trail is the deadly light path left behind by a worker
// using the energy-dump ability. Ownership is per-faction so any non-
// owner unit overlapping a segment dies on the next collision sweep.
// Segments are appended at the worker's tick-end position while the
// dump is active; each segment carries an `age` that ticks up by 1
// per step. Segments older than the effective lifetime (looked up at
// expiry-time so a faction researching trail-duration mid-trail picks
// up the new ceiling) are dropped. A trail dies when its segments
// array is empty.
export interface TrailSegment {
  x: Fixed;
  y: Fixed;
  age: number;
}

export interface Trail {
  id: number;
  alive: boolean;
  ownerFaction: Faction;
  segments: TrailSegment[];
}

export interface SimState {
  tick: number;
  rngState: bigint; // mirror of Rng.snapshot() — owned-but-mirrored for hash
  factions: [FactionState, FactionState];
  units: Unit[];
  nodes: ResourceNode[];
  // First-class structures (Phase 3.0+). Always present; empty at match
  // start. ID space is shared with units + nodes via nextEntityId so
  // entity IDs are globally unique within a match — useful for
  // future ID-targeted commands and for desync diagnostics.
  structures: Structure[];
  // Phase 3.7: trail entities, one per active dump. Same array-with-
  // tombstones discipline as units + structures (alive=false on death;
  // not spliced) so iteration order is bit-stable across the hash.
  trails: Trail[];
  nextEntityId: number;
  // Set when a faction's HQ is destroyed (the OTHER faction wins).
  // Post-2026-05-07 PvE pivot: HQ destruction is the only path to a
  // winner being set until 3.13 lands wave-survival + scenario-objective
  // win conditions. Earlier sub-phases also wrote this on a points
  // threshold; that path has been removed.
  winner: Faction | null;
}
