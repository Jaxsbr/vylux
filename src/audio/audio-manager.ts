// Phase 3.9.5 — Minimal audio layer.
//
// Synthesised via Web Audio API — no external assets, no loader, no
// asset-bundle. Each sound is a short oscillator + envelope, tuned to
// the Tron-grid aesthetic (clean tones, no realism). Five cues:
//
//   click        — UI button press; short high tick
//   trainComplete — unit spawned at HQ / Forge; rising chime
//   buildComplete — structure operational; double tick
//   attackHit    — combat damage taken / dealt; short noise burst
//   alertHqHit   — friendly HQ taking damage; pulsing low tone
//
// Web Audio requires a user gesture before its context can play. The
// AudioContext starts suspended; the first call to ensureContext()
// during a user-initiated event (click, keydown) resumes it. Cues
// fired before the first gesture are silently dropped — that's
// acceptable for an opening match.
//
// Mute toggle: setMuted(true) silences future cues without tearing
// down the context. The HUD wires a small button to flip this.

const FACTION_FREQ_BASE = 440; // A4 — neutral tonal centre

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private noiseBuffer: AudioBuffer | null = null;

  // Lazy: the AudioContext can only start under a user gesture, so we
  // construct it on the first call from a real event handler.
  private ensureContext(): AudioContext | null {
    if (this.context !== null) {
      // If we already constructed but the context suspended (e.g.
      // first call was outside a gesture in some browsers), try to
      // resume on each subsequent call. resume() returns a promise —
      // we don't await; the next sound after resume succeeds will play.
      if (this.context.state === 'suspended') {
        void this.context.resume();
      }
      return this.context;
    }
    try {
      // Some older browsers expose webkitAudioContext only.
      const Ctx = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const master = ctx.createGain();
      master.gain.value = 0.35; // overall volume cap — keeps the mix below "loud"
      master.connect(ctx.destination);
      this.context = ctx;
      this.master = master;
      this.noiseBuffer = buildNoiseBuffer(ctx);
      return ctx;
    } catch {
      // Fail-soft: a browser that refuses AudioContext gets a silent
      // game, not a crash. Same posture as the renderer's fallback
      // for missing 2D contexts.
      return null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  click(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.tone(ctx, this.master, {
      frequency: 1100,
      durationSec: 0.05,
      attackSec: 0.005,
      releaseSec: 0.04,
      gain: 0.18,
      type: 'square',
    });
  }

  trainComplete(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    // Two-note rising chime — 660 → 990 Hz over ~200ms.
    const t0 = ctx.currentTime;
    this.tone(ctx, this.master, {
      frequency: 660,
      durationSec: 0.10,
      attackSec: 0.005,
      releaseSec: 0.08,
      gain: 0.22,
      type: 'triangle',
      startAt: t0,
    });
    this.tone(ctx, this.master, {
      frequency: 990,
      durationSec: 0.14,
      attackSec: 0.005,
      releaseSec: 0.10,
      gain: 0.22,
      type: 'triangle',
      startAt: t0 + 0.07,
    });
  }

  buildComplete(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    // Tron-y double tick at 500 Hz.
    const t0 = ctx.currentTime;
    this.tone(ctx, this.master, {
      frequency: 520,
      durationSec: 0.06,
      attackSec: 0.005,
      releaseSec: 0.04,
      gain: 0.20,
      type: 'square',
      startAt: t0,
    });
    this.tone(ctx, this.master, {
      frequency: 520,
      durationSec: 0.06,
      attackSec: 0.005,
      releaseSec: 0.04,
      gain: 0.20,
      type: 'square',
      startAt: t0 + 0.09,
    });
  }

  attackHit(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master || !this.noiseBuffer) return;
    // Short white-noise burst, lowpass-filtered for "thump."
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.Q.value = 1.0;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.12);
  }

  alertHqHit(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    // Pulsing low tone — three quick beeps.
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.tone(ctx, this.master, {
        frequency: 220,
        durationSec: 0.08,
        attackSec: 0.005,
        releaseSec: 0.06,
        gain: 0.28,
        type: 'sawtooth',
        startAt: t0 + i * 0.11,
      });
    }
  }

  // Phase 3.11a — main-menu faction-switch. Low thump (impact) layered
  // with a faction-coloured chime that arrives ~120ms later, matching
  // the handover timeline (TRIGGER → WASH PEAK).
  factionSwitch(towardId: 'swarm' | 'siege'): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    // Low impact thump — sub frequency, square envelope.
    this.tone(ctx, this.master, {
      frequency: 90,
      durationSec: 0.18,
      attackSec: 0.005,
      releaseSec: 0.16,
      gain: 0.32,
      type: 'sawtooth',
      startAt: t0,
    });
    // Arrival chime — Pulse pings high + bright; Forge tolls low + heavy.
    const arrivalFreq = towardId === 'swarm' ? 1180 : 330;
    this.tone(ctx, this.master, {
      frequency: arrivalFreq,
      durationSec: 0.30,
      attackSec: 0.01,
      releaseSec: 0.26,
      gain: 0.20,
      type: towardId === 'swarm' ? 'triangle' : 'sawtooth',
      startAt: t0 + 0.12,
    });
  }

  // Generic envelope-shaped tone. Centralised so each cue above stays
  // a one-line param list and the envelope shape is consistent.
  private tone(ctx: AudioContext, dest: GainNode, opts: {
    frequency: number;
    durationSec: number;
    attackSec: number;
    releaseSec: number;
    gain: number;
    type: OscillatorType;
    startAt?: number;
  }): void {
    const now = opts.startAt ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.value = opts.frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(opts.gain, now + opts.attackSec);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + opts.attackSec + opts.releaseSec,
    );
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + opts.durationSec + 0.02);
  }
}

// Suppress the unused-base reference if any TS rules reach here. The
// constant is reserved for a future faction-pitched cue (cyan vs red
// mix) that 3.9.5 doesn't ship yet.
void FACTION_FREQ_BASE;

function buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
  // 0.2 seconds of white noise — long enough to source any short
  // burst without re-allocating per fire.
  const len = Math.floor(ctx.sampleRate * 0.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buf;
}
