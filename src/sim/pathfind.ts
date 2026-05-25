// Phase C.6.6 — deterministic grid A* pathfinding for worker navigation.
//
// Workers route around static blockers by following a tile-grid A* path:
// compute a waypoint route once when the destination changes, cache it on the
// worker, and walk it leg by leg with a plain straight step (no steering). The
// earlier hybrid (A* + per-tick local steering) was reverted — the steering
// layer oscillated in concave pockets and cost too much per tick. Pure A* has
// no mechanism that can oscillate: it returns a sequence of open tiles or
// nothing, and the caller's straight fallback degrades to "clip through" (the
// old cosmetic gap), never "stuck".
//
// Determinism (load-bearing — see AGENTS.md):
//   - Integer tile coords + integer costs (octile 10 / 14). No floats, no Math.*
//     in the cost/search path (only Math.abs / |0 on integer tile indices).
//   - The open set is a binary min-heap tie-broken by (f, tile index) so the
//     expansion order is identical on every machine.
//   - "tiles" are unit cells centred on the sim's integer coordinates (an
//     entity at fromInt(8) sits at the centre of tile 8); tile boundaries fall
//     on the half-integers, so tileAxis rounds to nearest.
//
// The sim is otherwise grid-size agnostic, so the grid extent is passed in
// (sourced from the render's GRID_CONSTANTS via the match spec → SimState).

import { add, distSq, FIXED_HALF, fromInt, toInt, type Fixed } from './fixed';

// Minimal blocker shape A* consumes: a centre, an inflated "path radius²"
// (footprint + a clearance margin) used to mark tiles unwalkable, and a stable
// `key` identifying the blocker. The worker's *own target* blocker is exempt
// BY KEY (not by proximity), so a pod sitting right next to the target node is
// still treated as solid — A* routes around it instead of through it.
export interface PathBlocker {
  x: Fixed;
  y: Fixed;
  pathRadiusSq: Fixed;
  key: number;
}

// `exemptKey` value meaning "exempt nothing" (no blocker uses key 0 — HQ keys
// are negative, entity ids are ≥ 1).
export const NO_EXEMPT = 0;

const COST_ORTHO = 10;
const COST_DIAG = 14;

// 8-connected neighbour offsets, fixed order. Corner-cutting past a blocked
// orthogonal neighbour is disallowed in the expansion below.
const NEIGHBOURS: ReadonlyArray<{ dx: number; dy: number; cost: number }> = [
  { dx: 1, dy: 0, cost: COST_ORTHO },
  { dx: -1, dy: 0, cost: COST_ORTHO },
  { dx: 0, dy: 1, cost: COST_ORTHO },
  { dx: 0, dy: -1, cost: COST_ORTHO },
  { dx: 1, dy: 1, cost: COST_DIAG },
  { dx: 1, dy: -1, cost: COST_DIAG },
  { dx: -1, dy: 1, cost: COST_DIAG },
  { dx: -1, dy: -1, cost: COST_DIAG },
];

// Round a Fixed coordinate to its tile index, clamped in-bounds.
export function tileAxis(coord: Fixed, gridSize: number): number {
  let t = toInt(add(coord, FIXED_HALF));
  if (t < 0) t = 0;
  if (t >= gridSize) t = gridSize - 1;
  return t;
}

export function packTile(tx: number, ty: number, gridSize: number): number {
  return ty * gridSize + tx;
}

// World-space (Fixed) centre of a packed tile — the point the worker walks to.
export function tileCenter(tile: number, gridSize: number): { x: Fixed; y: Fixed } {
  return { x: fromInt(tile % gridSize), y: fromInt((tile / gridSize) | 0) };
}

// Is tile (tx,ty) unwalkable? Blocked when its centre falls within any
// blocker's path radius — except the blocker whose key matches `exemptKey`
// (the worker's destination, which must stay reachable).
function tileBlocked(
  tx: number, ty: number,
  exemptKey: number,
  blockers: ReadonlyArray<PathBlocker>,
): boolean {
  const cx = fromInt(tx);
  const cy = fromInt(ty);
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    if (b.key === exemptKey) continue;
    if (distSq(cx, cy, b.x, b.y) <= b.pathRadiusSq) return true;
  }
  return false;
}

// Corner-conservative tile line-of-sight: does the straight line from (ax,ay)
// to (bx,by) stay clear of blocked tiles (endpoints excluded)? Integer
// Bresenham, but at every DIAGONAL crossing it also rejects if either tile
// sharing that corner is blocked — so the line can never graze a blocked
// tile's corner. This matches A*'s no-corner-cutting rule; plain Bresenham
// (one tile per step) would slip past a pod at its corner and wrongly report
// "clear", which let the clear-shot short-circuit + string-pull route a worker
// diagonally THROUGH a pod. Used for the clear-shot check and string-pulling.
function losClear(
  ax: number, ay: number,
  bx: number, by: number,
  exemptKey: number,
  blockers: ReadonlyArray<PathBlocker>,
): boolean {
  let x = ax;
  let y = ay;
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx - dy;
  let guard = dx + dy + 2; // bound against any pathological loop
  while (guard-- > 0) {
    if (!(x === ax && y === ay) && !(x === bx && y === by)) {
      if (tileBlocked(x, y, exemptKey, blockers)) return false;
    }
    if (x === bx && y === by) return true;
    const e2 = 2 * err;
    const stepX = e2 > -dy;
    const stepY = e2 < dx;
    if (stepX && stepY) {
      // Diagonal crossing — the segment also clips the two tiles sharing this
      // corner. Block if either is solid (no corner-cutting).
      if (tileBlocked(x + sx, y, exemptKey, blockers)) return false;
      if (tileBlocked(x, y + sy, exemptKey, blockers)) return false;
      err -= dy; x += sx;
      err += dx; y += sy;
    } else if (stepX) {
      err -= dy; x += sx;
    } else {
      err += dx; y += sy;
    }
  }
  return true;
}

// Admissible octile heuristic, integer.
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const lo = dx < dy ? dx : dy;
  const hi = dx < dy ? dy : dx;
  return COST_ORTHO * hi + (COST_DIAG - COST_ORTHO) * lo;
}

// A* over the tile grid. Returns the full packed-tile path start→goal, or null
// if unreachable. Deterministic: a binary heap ordered by (f, tile).
function aStar(
  startTile: number,
  goalTile: number,
  gridSize: number,
  exemptKey: number,
  blockers: ReadonlyArray<PathBlocker>,
): number[] | null {
  const n = gridSize * gridSize;
  const INF = 0x7fffffff;
  const g = new Int32Array(n).fill(INF);
  const f = new Int32Array(n).fill(INF);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const heap: number[] = [];
  const less = (a: number, b: number): boolean => (f[a] !== f[b] ? f[a] < f[b] : a < b);
  const push = (t: number): void => {
    heap.push(t);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(heap[i], heap[p])) { const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p; }
      else break;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m;
      }
    }
    return top;
  };

  const gtx = goalTile % gridSize;
  const gty = (goalTile / gridSize) | 0;

  g[startTile] = 0;
  f[startTile] = heuristic(startTile % gridSize, (startTile / gridSize) | 0, gtx, gty);
  push(startTile);

  while (heap.length > 0) {
    const cur = pop();
    if (cur === goalTile) {
      const path: number[] = [];
      let t = cur;
      while (t !== -1) { path.push(t); t = cameFrom[t]; }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % gridSize;
    const cy = (cur / gridSize) | 0;
    for (let k = 0; k < NEIGHBOURS.length; k++) {
      const nb = NEIGHBOURS[k];
      const nx = cx + nb.dx;
      const ny = cy + nb.dy;
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      const nTile = ny * gridSize + nx;
      // The start tile is always walkable (a worker may begin inside a
      // footprint and must be able to leave it); other tiles honour the test.
      if (nTile !== startTile && tileBlocked(nx, ny, exemptKey, blockers)) continue;
      // No corner-cutting: a diagonal needs both shared orthogonal neighbours
      // open, so the path never clips a blocked corner.
      if (nb.dx !== 0 && nb.dy !== 0) {
        if (tileBlocked(cx + nb.dx, cy, exemptKey, blockers)) continue;
        if (tileBlocked(cx, cy + nb.dy, exemptKey, blockers)) continue;
      }
      if (closed[nTile]) continue;
      const tentative = g[cur] + nb.cost;
      if (tentative < g[nTile]) {
        cameFrom[nTile] = cur;
        g[nTile] = tentative;
        f[nTile] = tentative + heuristic(nx, ny, gtx, gty);
        push(nTile);
      }
    }
  }
  return null;
}

// String-pull a raw tile path down to its turning points: keep a waypoint only
// where the straight line from the last anchor to the tile *after* it is
// blocked. Endpoints are dropped — the start is where the worker already is,
// and the goal tile is replaced by the real sub-tile target on the final leg.
function stringPull(
  path: number[],
  gridSize: number,
  exemptKey: number,
  blockers: ReadonlyArray<PathBlocker>,
): number[] {
  if (path.length <= 2) return [];
  const out: number[] = [];
  let anchor = path[0];
  for (let i = 1; i < path.length - 1; i++) {
    const ax = anchor % gridSize;
    const ay = (anchor / gridSize) | 0;
    const nextTile = path[i + 1];
    const nx = nextTile % gridSize;
    const ny = (nextTile / gridSize) | 0;
    if (!losClear(ax, ay, nx, ny, exemptKey, blockers)) {
      out.push(path[i]);
      anchor = path[i];
    }
  }
  return out;
}

// Public entry: plan a route from (sx,sy) toward (gx,gy). `exemptKey` is the
// blocker the worker is heading to (its node / pod / HQ / charge spot); that
// blocker alone is passable so the destination stays reachable — every other
// blocker is solid. Returns the smoothed intermediate waypoint tiles (packed,
// endpoints excluded). An empty result means "go straight" — the route is
// already clear, or no path exists (caller falls back to a direct step, which
// may clip but never stalls).
export function findPath(
  sx: Fixed, sy: Fixed,
  gx: Fixed, gy: Fixed,
  gridSize: number,
  blockers: ReadonlyArray<PathBlocker>,
  exemptKey: number,
): number[] {
  const stx = tileAxis(sx, gridSize);
  const sty = tileAxis(sy, gridSize);
  const gtx = tileAxis(gx, gridSize);
  const gty = tileAxis(gy, gridSize);
  if (stx === gtx && sty === gty) return []; // same tile — straight in
  if (losClear(stx, sty, gtx, gty, exemptKey, blockers)) return []; // clear shot
  const raw = aStar(packTile(stx, sty, gridSize), packTile(gtx, gty, gridSize), gridSize, exemptKey, blockers);
  if (raw === null) return []; // unreachable — fall back to direct
  return stringPull(raw, gridSize, exemptKey, blockers);
}
