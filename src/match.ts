// Match-state module — pure evaluation + in-place reset.
// WIN_POINTS lives in units-config (HQ_MAX_HP=500 is already there; we add WIN_POINTS).
// No Three.js imports — pure logic only.

export const WIN_POINTS = 500;

export type MatchOutcome = 'blue-wins' | 'red-wins';

export type EvaluateMatchArgs = {
  pointsLedger: { get: () => { blue: number; red: number } };
  hqs: { blue: { hp: number }; red: { hp: number } };
};

/**
 * Evaluate win/lose conditions for the current frame.
 * Returns null while the match is ongoing.
 *
 * Priority order:
 *  1. HQ death (hp === 0) — opposite faction wins.
 *  2. Points threshold (>= WIN_POINTS).
 *  3. Tie-break: more points wins. If equal, blue wins (deterministic tiebreaker).
 *
 * Note on simultaneous triggers: if both HQs are at 0 in the same frame (edge
 * case in rapid combat), more points wins; if points also tied, blue wins.
 */
export function evaluateMatch({ pointsLedger, hqs }: EvaluateMatchArgs): MatchOutcome | null {
  const pts = pointsLedger.get();
  const blueHqDead = hqs.blue.hp <= 0;
  const redHqDead = hqs.red.hp <= 0;
  const bluePoints = pts.blue >= WIN_POINTS;
  const redPoints = pts.red >= WIN_POINTS;

  const blueTriggered = bluePoints || redHqDead;
  const redTriggered = redPoints || blueHqDead;

  if (!blueTriggered && !redTriggered) return null;

  if (blueTriggered && !redTriggered) return 'blue-wins';
  if (redTriggered && !blueTriggered) return 'red-wins';

  // Both triggered same frame — tie-break by points (blue wins if truly tied).
  if (pts.blue > pts.red) return 'blue-wins';
  if (pts.red > pts.blue) return 'red-wins';
  // Truly simultaneous with equal points — blue wins (arbitrary but deterministic).
  return 'blue-wins';
}
