// Phase D.2 — hybrid node blocking. A resource node blocks A* pathfinding ONLY
// when it's a true standalone single (no Chebyshev-1 node neighbour). Clustered
// nodes are walk-through, so the dense interior of an organic blob stays
// harvestable instead of being walled off. This proves nodeIsStandalone, the
// predicate collectBlockers uses to decide which nodes go in the blocker list.

import { describe, expect, it } from 'vitest';
import { fromInt } from './fixed';
import { nodeIsStandalone } from './step';
import type { ResourceNode } from './types';

function node(id: number, x: number, y: number, alive = true): ResourceNode {
  return {
    id,
    alive,
    kind: 'energy',
    x: fromInt(x),
    y: fromInt(y),
    remaining: fromInt(100),
    discoveredBy: [false, false],
  };
}

describe('nodeIsStandalone (D.2 hybrid blocking)', () => {
  it('flags a lone node as standalone (it blocks)', () => {
    const nodes = [node(1, 10, 10), node(2, 30, 30)];
    expect(nodeIsStandalone(nodes, 0)).toBe(true);
    expect(nodeIsStandalone(nodes, 1)).toBe(true);
  });

  it('does NOT flag any node in a packed 3×3 blob (interior stays reachable)', () => {
    // 3×3 block centred on (10,10): index 4 is the fully-enclosed centre.
    const nodes: ResourceNode[] = [];
    let id = 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        nodes.push(node(id++, 10 + dx, 10 + dy));
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      expect(nodeIsStandalone(nodes, i)).toBe(false); // all have neighbours → walk-through
    }
  });

  it('treats diagonally-adjacent nodes as a cluster (non-blocking)', () => {
    const nodes = [node(1, 10, 10), node(2, 11, 11)];
    expect(nodeIsStandalone(nodes, 0)).toBe(false);
    expect(nodeIsStandalone(nodes, 1)).toBe(false);
  });

  it('treats nodes two tiles apart as separate singles (both block)', () => {
    const nodes = [node(1, 10, 10), node(2, 12, 10)];
    expect(nodeIsStandalone(nodes, 0)).toBe(true);
    expect(nodeIsStandalone(nodes, 1)).toBe(true);
  });

  it('only counts ALIVE neighbours — a depleted cluster\'s last survivor becomes solid', () => {
    // A 1×3 line; kill the two flanking nodes, the middle survivor is now alone.
    const nodes = [node(1, 9, 10, false), node(2, 10, 10, true), node(3, 11, 10, false)];
    expect(nodeIsStandalone(nodes, 1)).toBe(true);
    // With a live neighbour it would be clustered:
    nodes[0].alive = true;
    expect(nodeIsStandalone(nodes, 1)).toBe(false);
  });
});
