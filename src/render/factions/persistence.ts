// Phase 3.11a — Persist the player's faction pick across visits.
//
// Single key in localStorage. Read once at app boot, written when
// the menu commits a selection. Fail-soft: localStorage can be
// blocked (private mode, storage quota), in which case we treat the
// player as a first-visit Pulse picker rather than crashing the boot.

import type { FactionId } from './theme';

const STORAGE_KEY = 'vylux.faction';
const DEFAULT: FactionId = 'pulse';

export function loadFactionId(): FactionId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'pulse' || raw === 'forge') return raw;
    return DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveFactionId(id: FactionId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked — selection still works in-session, just doesn't survive reload.
  }
}
