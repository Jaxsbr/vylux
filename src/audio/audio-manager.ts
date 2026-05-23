// Synthesised audio layer — no external assets, no loader, no bundle.
//
// Every sound is built live from Web Audio oscillators + envelopes,
// tuned to the Tron-grid aesthetic (clean tones, no realism). Two
// families:
//
//   Ambient bed (Phase C.3)
//     A low, slowly-pulsing drone that starts on match begin and runs
//     for the life of the match. Faction-tinted off FACTION_FREQ_BASE
//     (cyan sits a whole tone above red) so the bed alone tells you
//     which side you're on. Sits well under the SFX in the mix and
//     ducks briefly each time a cue fires.
//
//   One-shot cues
//     click          — UI button press; short high tick
//     select         — in-world entity selected; soft rising ping
//     moveAssign     — move order issued; quick downward swish
//     harvestAssign  — workers routed to a node; quick upward chirp
//     chargeStart    — worker enters charge mode; low descending sweep
//     chargeComplete — worker leaves charge mode full; bright rise
//     researchStart  — research begins at a pod; mid two-step
//     researchComplete — upgrade lands; rising unlock arpeggio
//     trainComplete  — worker spawned at HQ; rising chime
//     buildComplete  — structure operational; double tick
//     attackHit      — combat damage; short noise burst
//     alertHqHit     — friendly HQ taking damage; pulsing low tone
//     factionSwitch  — main-menu faction pick; thump + arrival chime
//
// Web Audio requires a user gesture before its context can play. The
// AudioContext starts suspended; the first call to ensureContext()
// during a user-initiated event (click, keydown) resumes it. Cues and
// the bed fired before the first gesture are silently dropped — that's
// acceptable, and the unit tests lean on it to run headless.
//
// Mute toggle: setMuted(true) silences future cues and ramps the
// ambient bed to zero without tearing down the context. The HUD wires
// the M key to flip it.

import type { Faction } from '../sim/types';

// Tonal centre the faction tint is derived from. Cyan (faction 0) plays
// at the base; red (faction 1) sits a whole tone below it.
const FACTION_FREQ_BASE = 440; // A4

// Ambient drone level — deliberately well under the SFX gains
// (0.15–0.32) so cues always cut through.
const BED_LEVEL = 0.08;

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private noiseBuffer: AudioBuffer | null = null;
  // Phase C.3: the running ambient bed. We only retain its level gain —
  // the oscillators + LFO are kept alive by the running audio graph, so
  // mute/duck just need this one knob. null until the bed actually
  // starts.
  private ambient: { bedGain: GainNode } | null = null;
  // Faction the bed should play once a context is live. startAmbientBed()
  // records this rather than force-creating a context, so the bed can't
  // spawn a suspended AudioContext (and its autoplay warning) on a page
  // that hasn't had a user gesture yet.
  private pendingBedFaction: Faction | null = null;

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
      this.flushPendingBed();
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
      // If the context starts suspended (created outside a gesture) and
      // resumes later, flush any pending ambient bed the instant it goes
      // live — so the bed starts on its own rather than waiting for some
      // later cue's ensureContext() to happen to observe 'running'.
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'running') this.flushPendingBed();
      });
      this.flushPendingBed();
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
    // Phase C.3: muting must silence the running bed too, not just
    // future one-shots. Ramp rather than cut so the drone doesn't pop.
    if (this.ambient && this.context) {
      const g = this.ambient.bedGain.gain;
      const now = this.context.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(muted ? 0 : BED_LEVEL, now + 0.15);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  // Phase C.3 — ambient bed. A faction-tinted low drone with a slow LFO
  // swell. Records the intent and starts immediately if a context is
  // already live (PvAI: the menu unlocked audio); otherwise the bed
  // starts the moment the first gesture-driven cue brings the context up
  // (flushPendingBed in ensureContext). It never force-creates a context
  // itself, so a gesture-less page (lockstep / observer / ?menu=skip
  // e2e) stays silent — no suspended context, no autoplay warning.
  // Idempotent: a no-op once a bed is already running.
  startAmbientBed(faction: Faction): void {
    if (this.ambient) return;
    this.pendingBedFaction = faction;
    this.flushPendingBed();
  }

  // Start the deferred bed iff one is pending and the context is truly
  // running (a started oscillator on a merely-suspended context is what
  // emits Chrome's autoplay warning, so we wait for 'running').
  private flushPendingBed(): void {
    if (this.pendingBedFaction === null || this.ambient) return;
    if (!this.context || this.context.state !== 'running') return;
    this.startBedNow(this.pendingBedFaction);
  }

  private startBedNow(faction: Faction): void {
    const ctx = this.context;
    if (!ctx || !this.master || this.ambient) return;
    this.pendingBedFaction = null;

    // Fundamental two octaves below the tonal centre for a low rumble;
    // red (faction 1) drops a whole tone under cyan (faction 0).
    const fundamental = (FACTION_FREQ_BASE / 8) * (faction === 0 ? 1 : 0.89);
    const now = ctx.currentTime;

    // bedGain is the master level knob mute + duck drive.
    const bedGain = ctx.createGain();
    bedGain.gain.value = this.muted ? 0 : BED_LEVEL;
    bedGain.connect(this.master);

    // The LFO swells a gain the voices pass through, on a ~12 s cycle, so
    // the bed breathes instead of sitting flat. pulse.gain oscillates
    // around 0.55 ± 0.4 → roughly 0.15..0.95.
    const pulse = ctx.createGain();
    pulse.gain.value = 0.55;
    pulse.connect(bedGain);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth);
    lfoDepth.connect(pulse.gain);

    // Warm lowpass tames the saw/triangle stack into a drone, not a buzz.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 360;
    filter.Q.value = 0.6;
    filter.connect(pulse);

    // Voice stack: fundamental + a (slightly detuned) fifth + a soft
    // octave for air. Per-voice gains are summed under the lowpass.
    const voices: Array<{ freq: number; type: OscillatorType; gain: number; detune: number }> = [
      { freq: fundamental, type: 'sawtooth', gain: 0.5, detune: 0 },
      { freq: fundamental * 1.5, type: 'triangle', gain: 0.32, detune: 6 },
      { freq: fundamental * 2, type: 'sine', gain: 0.22, detune: 0 },
    ];
    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = v.freq;
      osc.detune.value = v.detune;
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
    }
    lfo.start(now);

    this.ambient = { bedGain };
  }

  click(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    this.tone(ctx, this.master, {
      frequency: 1100,
      durationSec: 0.05,
      attackSec: 0.005,
      releaseSec: 0.04,
      gain: 0.18,
      type: 'square',
    });
  }

  // Phase C.3 — in-world entity selected (unit / HQ / pod / node).
  // Softer + lower than the UI `click`, with a small upward glide so a
  // selection reads as "this is now yours" rather than a button press.
  select(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    this.tone(ctx, this.master, {
      frequency: 480,
      endFrequency: 660,
      durationSec: 0.09,
      attackSec: 0.005,
      releaseSec: 0.07,
      gain: 0.16,
      type: 'triangle',
    });
  }

  // Phase C.3 — move order issued. Quick downward swish ("go there").
  // Pairs with harvestAssign's upward chirp so move vs harvest read as
  // opposite gestures.
  moveAssign(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    this.tone(ctx, this.master, {
      frequency: 760,
      endFrequency: 500,
      durationSec: 0.08,
      attackSec: 0.004,
      releaseSec: 0.06,
      gain: 0.16,
      type: 'triangle',
    });
  }

  // Phase C.3 — workers routed to a harvest node. Upward chirp ("locked
  // on"), a touch longer + brighter than moveAssign.
  harvestAssign(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    this.tone(ctx, this.master, {
      frequency: 480,
      endFrequency: 760,
      durationSec: 0.12,
      attackSec: 0.005,
      releaseSec: 0.09,
      gain: 0.18,
      type: 'triangle',
    });
  }

  // Phase C.3 — worker drops into charge mode. Low descending sweep that
  // reads as "powering down to recharge."
  chargeStart(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    this.tone(ctx, this.master, {
      frequency: 330,
      endFrequency: 200,
      durationSec: 0.18,
      attackSec: 0.005,
      releaseSec: 0.15,
      gain: 0.18,
      type: 'sawtooth',
    });
  }

  // Phase C.3 — worker leaves charge mode at full tank. Bright rising
  // sweep ("energised, back to work").
  chargeComplete(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    this.tone(ctx, this.master, {
      frequency: 560,
      endFrequency: 980,
      durationSec: 0.18,
      attackSec: 0.005,
      releaseSec: 0.14,
      gain: 0.2,
      type: 'triangle',
    });
  }

  // Phase C.3 — research begins at a pod. A mid two-step ("work begun")
  // that's clearly the front half of researchComplete's fuller chime.
  researchStart(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    const t0 = ctx.currentTime;
    this.tone(ctx, this.master, {
      frequency: 440,
      durationSec: 0.10,
      attackSec: 0.005,
      releaseSec: 0.08,
      gain: 0.18,
      type: 'triangle',
      startAt: t0,
    });
    this.tone(ctx, this.master, {
      frequency: 587,
      durationSec: 0.12,
      attackSec: 0.005,
      releaseSec: 0.10,
      gain: 0.18,
      type: 'triangle',
      startAt: t0 + 0.08,
    });
  }

  // Phase C.3 — upgrade lands. A rising three-note "unlock" arpeggio,
  // brighter + taller than trainComplete so a completed research feels
  // like an event, not just another spawn.
  researchComplete(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
    const t0 = ctx.currentTime;
    const notes = [660, 880, 1320];
    for (let i = 0; i < notes.length; i++) {
      this.tone(ctx, this.master, {
        frequency: notes[i],
        durationSec: 0.16,
        attackSec: 0.005,
        releaseSec: 0.13,
        gain: 0.2,
        type: 'triangle',
        startAt: t0 + i * 0.08,
      });
    }
  }

  trainComplete(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.duckAmbient();
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
    this.duckAmbient();
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
    this.duckAmbient();
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
    this.duckAmbient();
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
    this.duckAmbient();
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

  // Phase C.3 — momentarily dip the ambient bed when a one-shot fires so
  // the cue reads clearly over the drone, then ramp it back. No-op when
  // no bed is running (before match start / headless tests) or muted.
  private duckAmbient(): void {
    if (!this.ambient || !this.context || this.muted) return;
    const g = this.ambient.bedGain.gain;
    const now = this.context.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(BED_LEVEL * 0.35, now + 0.04);
    g.linearRampToValueAtTime(BED_LEVEL, now + 0.5);
  }

  // Generic envelope-shaped tone. Centralised so each cue above stays
  // a one-line param list and the envelope shape is consistent. An
  // optional endFrequency glides the pitch across the duration (used by
  // the C.3 sweep cues).
  private tone(ctx: AudioContext, dest: GainNode, opts: {
    frequency: number;
    endFrequency?: number;
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
    osc.frequency.setValueAtTime(opts.frequency, now);
    if (opts.endFrequency !== undefined) {
      osc.frequency.linearRampToValueAtTime(opts.endFrequency, now + opts.durationSec);
    }
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
