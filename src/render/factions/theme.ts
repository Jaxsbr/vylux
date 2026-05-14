// Phase 3.11a — Per-faction theme.
// Phase 3.11b (2026-05-08 rename) — `'pulse' | 'forge'` faction-id
// strings retired; the canonical IDs now match the display names:
// `'swarm' | 'siege'`. The Forge production-structure kind in the sim
// is unrelated and untouched.
//
// Single source of truth for the faction-identity layer that landed
// from `tmp-handover-design/` (Claude Design output): palette, type
// weights + tracking, voice copy, victory / defeat strings.
//
// Read by: main menu (selector), in-game HUD (action bar + resource
// bar tints), end-of-match overlay. The deterministic sim now also
// stores `factionId` on FactionState (3.11b) so per-faction stat
// overrides can be looked up; presentation still owns the palette.
//
// Faction id mapping (sim ↔ menu):
//   Faction 0 (cyan / `blue` colour pool) ↔ 'swarm'
//   Faction 1 (red  / `red`  colour pool) ↔ 'siege'

import type { Faction, FactionId } from '../../sim/types';

// Re-exported here so the menu / HUD layers don't have to reach into
// `sim/types` directly — keeps the "render reads from sim, sim doesn't
// reach into render" dependency direction clean.
export type { FactionId } from '../../sim/types';

export interface FactionTheme {
  readonly id: FactionId;
  readonly faction: Faction;          // sim-side discriminator
  readonly name: string;              // display name in menu / end-screen
  readonly primary: string;           // main faction colour (CSS / hex)
  readonly bright: string;            // accent brighten
  readonly dim: string;               // muted faction colour
  readonly deep: string;              // deep colour for backgrounds / fades
  readonly glow: string;              // mid-strength rgba glow
  readonly glowSoft: string;          // low-strength rgba glow
  readonly glowHard: string;          // high-strength rgba glow
  readonly resC: string;              // colour-resource pool tint (HUD `C` glyph)
  readonly titleWeight: number;       // wordmark weight
  readonly titleTrack: string;        // wordmark letter-spacing
  readonly cardWeight: number;        // action-card label weight
  readonly cardTrack: string;         // action-card label letter-spacing
  readonly bodyTrack: string;         // body / voice copy letter-spacing
  readonly radius: number;            // shared card / panel border-radius
  readonly strokeW: number;           // primary border thickness
  readonly cardPad: string;           // action-card padding
  readonly voice: string;             // one-line personality descriptor
  readonly phrases: readonly string[]; // menu / HUD voice copy candidates
  readonly victory: string;           // end-screen tagline on win
  readonly defeat: string;            // end-screen tagline on loss
}

export const VY_BG = '#04070a';
export const VY_INK = '#dfe8ee';
export const VY_PANEL = 'rgba(7,9,12,0.78)';

// Resource info colours stay constant across factions for legibility.
export const RESOURCE_COLOR = {
  energy: '#ffd34a',
  hp:     '#cfd8dc',
  supply: '#b6e8ff',
} as const;

export const SWARM_THEME: FactionTheme = {
  id: 'swarm',
  faction: 0,
  name: 'SWARM',
  primary:   '#00e5ff',
  bright:    '#9ff6ff',
  dim:       '#1a4a55',
  deep:      '#072430',
  glow:      'rgba(0,229,255,0.55)',
  glowSoft:  'rgba(0,229,255,0.18)',
  glowHard:  'rgba(0,229,255,0.85)',
  resC:      '#00e5ff',
  titleWeight: 200,
  titleTrack:  '0.42em',
  cardWeight:  300,
  cardTrack:   '0.30em',
  bodyTrack:   '0.20em',
  radius:      4,
  strokeW:     1,
  cardPad:     '14px 18px',
  voice: 'plural · electric · restless',
  phrases: [
    'WE ARE MANY',
    'FLOW FORWARD',
    'NEVER STILL',
    'THE CURRENT HOLDS',
    'BREAK · REFORM · PUSH',
  ],
  victory: 'THE CURRENT HOLDS',
  defeat:  'THE CURRENT BREAKS',
};

export const SIEGE_THEME: FactionTheme = {
  id: 'siege',
  faction: 1,
  name: 'SIEGE',
  primary:   '#ff4a1a',
  bright:    '#ffb38a',
  dim:       '#5a2a1a',
  deep:      '#2a0e06',
  glow:      'rgba(255,74,26,0.50)',
  glowSoft:  'rgba(255,74,26,0.16)',
  glowHard:  'rgba(255,90,30,0.85)',
  resC:      '#ff6a33',
  titleWeight: 800,
  titleTrack:  '0.18em',
  cardWeight:  700,
  cardTrack:   '0.16em',
  bodyTrack:   '0.16em',
  radius:      1,
  strokeW:     2,
  cardPad:     '18px 18px',
  voice: 'singular · weighted · declarative',
  phrases: [
    'WE DO NOT MOVE',
    'STRENGTH HOLDS',
    'BURN. STAND.',
    'NO STEP BACK',
    'THE ANVIL ANSWERS',
  ],
  victory: 'THE ANVIL HOLDS',
  defeat:  'THE FORGE GOES COLD',
};

export const FACTION_THEMES: Record<FactionId, FactionTheme> = {
  swarm: SWARM_THEME,
  siege: SIEGE_THEME,
};

export function themeForId(id: FactionId): FactionTheme {
  return FACTION_THEMES[id];
}

export function themeForFaction(f: Faction): FactionTheme {
  return f === 0 ? SWARM_THEME : SIEGE_THEME;
}

export function opposingTheme(of: FactionTheme): FactionTheme {
  return of.id === 'swarm' ? SIEGE_THEME : SWARM_THEME;
}

export function factionFromId(id: FactionId): Faction {
  return id === 'swarm' ? 0 : 1;
}

export function opposingId(id: FactionId): FactionId {
  return id === 'swarm' ? 'siege' : 'swarm';
}
