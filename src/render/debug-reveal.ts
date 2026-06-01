// Debug-only full-map reveal. Toggled by a dev keybind (backtick — see
// input-controller). When on, the renderer reveals all fog, all enemy
// entities, and every resource node — the same view observer mode gets.
//
// RENDER-ONLY: this never touches the deterministic sim state (SimState.explored
// / node.discoveredBy stay as they are), so it can't move a hash or desync a
// lockstep match. It only changes what THIS client draws.
export const debugReveal = { all: false };

/** Flip the reveal and return the new state (for a status log). */
export function toggleDebugReveal(): boolean {
  debugReveal.all = !debugReveal.all;
  return debugReveal.all;
}
