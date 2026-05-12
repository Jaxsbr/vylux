// Phase 3.9.5 — Sim-event detector for audio cues.
//
// Polls sim state once per tick, compares against a snapshot, fires
// audio cues for player-relevant events. Lives renderer-side (no sim
// shape change, no event-system in the deterministic sim).
//
// Throttled at most one cue per *type* per tick — a tick where four
// raiders all hit a worker fires one attackHit, not four. Keeps the
// mix sane during late-game combat without losing the "I just got
// hit" feedback.
//
// Detected events (player-faction perspective):
//   - new alive friendly unit (id not seen last tick)   → trainComplete
//   - friendly structure transitions buildTicks > 0 → 0  → buildComplete
//   - any friendly unit's HP decreased                  → attackHit
//   - friendly HQ HP decreased                          → alertHqHit

import { toFloat } from '../sim/fixed';
import type { Sim } from '../sim/sim';
import type { Faction } from '../sim/types';
import type { AudioManager } from '../audio/audio-manager';

export class GameEventDetector {
  private readonly prevUnitIds = new Set<number>();
  private readonly prevUnitHp = new Map<number, number>();
  private readonly prevStructureBuilding = new Set<number>();
  private prevHqHp = 0;
  private lastTick = -1;
  private primed = false;

  constructor(
    private readonly sim: Sim,
    private readonly playerFaction: Faction,
    private readonly audio: AudioManager,
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
    let alertFired = false;

    // Train complete — friendly unit ID we haven't seen.
    for (const u of this.sim.state.units) {
      if (!u.alive) continue;
      if (u.faction !== this.playerFaction) continue;
      if (this.prevUnitIds.has(u.id)) continue;
      if (!trainFired) {
        this.audio.trainComplete();
        trainFired = true;
      }
      // No break — still need to walk for HP snapshot below.
    }

    // Build complete — no structures in the Phase A surface; pass.
    void buildFired;

    // Attack hit — any friendly unit's HP decreased since last tick.
    for (const u of this.sim.state.units) {
      if (u.faction !== this.playerFaction) continue;
      const hp = u.alive ? toFloat(u.hp) : 0;
      const prev = this.prevUnitHp.get(u.id);
      if (prev !== undefined && hp < prev) {
        if (!attackFired) {
          this.audio.attackHit();
          attackFired = true;
        }
      }
    }

    // Alert — friendly HQ HP decreased.
    const hqHp = toFloat(this.sim.state.factions[this.playerFaction].hqHp);
    if (hqHp < this.prevHqHp) {
      if (!alertFired) {
        this.audio.alertHqHit();
        alertFired = true;
      }
    }

    this.snapshot();
  }

  private snapshot(): void {
    this.prevUnitIds.clear();
    this.prevUnitHp.clear();
    for (const u of this.sim.state.units) {
      if (u.alive && u.faction === this.playerFaction) {
        this.prevUnitIds.add(u.id);
      }
      // Snapshot HP for *every* friendly unit, alive or dead, so a unit
      // that dies this tick from full → 0 still triggers attackHit on
      // the tick it dies. A dead unit hp = 0 by convention.
      if (u.faction === this.playerFaction) {
        this.prevUnitHp.set(u.id, u.alive ? toFloat(u.hp) : 0);
      }
    }
    this.prevStructureBuilding.clear();
    this.prevHqHp = toFloat(this.sim.state.factions[this.playerFaction].hqHp);
  }
}
