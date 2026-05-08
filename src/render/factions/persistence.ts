// Phase 3.11a — Persist the player's faction pick across visits.
// Phase 3.11b (2026-05-08 rename) — `'pulse' | 'forge'` retired in
// favour of `'swarm' | 'siege'`. Old localStorage values fail the
// validator and silently default to 'swarm'; first-visit pickers
// re-pick. Cheaper than a one-shot migration helper.
//
// Single key in localStorage. Read once at app boot, written when
// the menu commits a selection. Fail-soft: localStorage can be
// blocked (private mode, storage quota), in which case we treat the
// player as a first-visit Swarm picker rather than crashing the boot.

import type { FactionId } from './theme';

const STORAGE_KEY = 'vylux.faction';
const DEFAULT: FactionId = 'swarm';

export function loadFactionId(): FactionId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'swarm' || raw === 'siege') return raw;
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
