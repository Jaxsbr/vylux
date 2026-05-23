// Sim-event detector for audio cues.
//
// Polls sim state once per tick, compares against a snapshot, fires
// audio cues for player-relevant events. Lives renderer-side (no sim
// shape change, no event-system in the deterministic sim) so the
// determinism gate is never touched — audio is a one-way consumer of
// state, exactly like the renderer.
//
// Throttled at most one cue per *type* per tick — a tick where four
// raiders all hit a worker fires one attackHit, not four. Keeps the
// mix sane without losing the "something just happened" feedback.
//
// Detected events (player-faction perspective):
//   - new alive friendly unit (id not seen last tick)        → trainComplete
//   - friendly structure buildTicksRemaining > 0 → 0          → buildComplete
//   - any friendly unit's HP decreased                        → attackHit
//   - friendly HQ HP decreased                                → alertHqHit
//   - friendly worker enters charge mode (Phase C.3)          → chargeStart
//   - friendly worker leaves charge mode alive (Phase C.3)    → chargeComplete
//   - faction starts a research (null → kind) (Phase C.3)     → researchStart
//   - autoResume research lands (false → true) (Phase C.3)    → researchComplete
//
// The charge / research watches are the C.3 cues that can't live at an
// input-controller fire site: charge transitions are sim-driven (a task
// drains the last charge), and research completes on a sim timer, so
// both are diffed here against the previous tick's snapshot.

import { toFloat } from '../sim/fixed';
import { isInChargeMode } from '../sim/step';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import type { AudioManager } from '../audio/audio-manager';

export class GameEventDetector {
  private readonly prevUnitIds = new Set<number>();
  private readonly prevUnitHp = new Map<number, number>();
  // Structures (work pods) whose build was still in progress last tick.
  private readonly prevStructureBuilding = new Set<number>();
  // Worker ids that were in charge mode (walkingToCharge / charging) last
  // tick — diffed for the enter/leave charge cues.
  private readonly prevChargeMode = new Set<number>();
  private prevHqHp = 0;
  // Faction-level research watches.
  private prevResearching = false;
  private prevAutoResume = false;
  private lastTick = -1;
  private primed = false;

  constructor(
    private readonly sim: Sim,
    private readonly playerFaction: Faction,
    private readonly audio: AudioManager,
    // Phase C.4: optional VFX hook fired alongside the researchComplete chime
    // so the renderer can pulse the affected pods + workers. Kept as a
    // callback (not a direct renderer ref) so the detector stays audio/sim
    // only — the orchestration layer wires the visual.
    private readonly onResearchComplete: (() => void) | null = null,
  ) {}

  update(): void {
    const state = this.sim.state;
    if (state.tick === this.lastTick) return;
    this.lastTick = state.tick;

    // First call: prime snapshot without firing. Otherwise the bootstrap
    // tick fires alerts for "new" entities that were spawned by
    // createInitialState — not what the player did.
    if (!this.primed) {
      this.snapshot();
      this.primed = true;
      return;
    }

    let trainFired = false;
    let buildFired = false;
    let attackFired = false;
    let chargeStartFired = false;
    let chargeCompleteFired = false;

    for (const u of state.units) {
      if (u.faction !== this.playerFaction) continue;

      // Train complete — friendly unit ID we haven't seen.
      if (u.alive && !this.prevUnitIds.has(u.id) && !trainFired) {
        this.audio.trainComplete();
        trainFired = true;
      }

      // Attack hit — any friendly unit's HP decreased since last tick.
      const hp = u.alive ? toFloat(u.hp) : 0;
      const prevHp = this.prevUnitHp.get(u.id);
      if (prevHp !== undefined && hp < prevHp && !attackFired) {
        this.audio.attackHit();
        attackFired = true;
      }

      // Charge transitions (workers only). A worker that dies while
      // charging is dropped from the snapshot without firing "complete"
      // — only alive workers leaving charge mode count as recharged.
      if (u.kind === 'worker' && u.alive) {
        const wasCharging = this.prevChargeMode.has(u.id);
        const nowCharging = isInChargeMode(u);
        if (!wasCharging && nowCharging && !chargeStartFired) {
          this.audio.chargeStart();
          chargeStartFired = true;
        } else if (wasCharging && !nowCharging && !chargeCompleteFired) {
          this.audio.chargeComplete();
          chargeCompleteFired = true;
        }
      }
    }

    // Build complete — a friendly structure that was mid-construction
    // last tick is now operational (buildTicksRemaining hit 0).
    for (const s of state.structures) {
      if (s.faction !== this.playerFaction || !s.alive) continue;
      if (this.prevStructureBuilding.has(s.id) && s.buildTicksRemaining === 0 && !buildFired) {
        this.audio.buildComplete();
        buildFired = true;
      }
    }

    // Alert — friendly HQ HP decreased. (Single scalar check, so no
    // per-tick throttle flag is needed.)
    const hqHp = toFloat(state.factions[this.playerFaction].hqHp);
    if (hqHp < this.prevHqHp) {
      this.audio.alertHqHit();
    }

    // Research watches (faction-level scalars).
    const fs = state.factions[this.playerFaction];
    const researching = fs.researchingKind !== null;
    if (researching && !this.prevResearching) {
      this.audio.researchStart();
    }
    if (fs.autoResumeResearched && !this.prevAutoResume) {
      this.audio.researchComplete();
      this.onResearchComplete?.();
    }

    this.snapshot();
  }

  private snapshot(): void {
    const state = this.sim.state;
    this.prevUnitIds.clear();
    this.prevUnitHp.clear();
    this.prevChargeMode.clear();
    for (const u of state.units) {
      if (u.faction !== this.playerFaction) continue;
      if (u.alive) {
        this.prevUnitIds.add(u.id);
        if (u.kind === 'worker' && isInChargeMode(u)) this.prevChargeMode.add(u.id);
      }
      // Snapshot HP for *every* friendly unit, alive or dead, so a unit
      // that dies this tick from full → 0 still triggers attackHit on
      // the tick it dies. A dead unit hp = 0 by convention.
      this.prevUnitHp.set(u.id, u.alive ? toFloat(u.hp) : 0);
    }
    this.prevStructureBuilding.clear();
    for (const s of state.structures) {
      if (s.faction === this.playerFaction && s.alive && s.buildTicksRemaining > 0) {
        this.prevStructureBuilding.add(s.id);
      }
    }
    this.prevHqHp = toFloat(state.factions[this.playerFaction].hqHp);
    const fs = state.factions[this.playerFaction];
    this.prevResearching = fs.researchingKind !== null;
    this.prevAutoResume = fs.autoResumeResearched;
  }
}
