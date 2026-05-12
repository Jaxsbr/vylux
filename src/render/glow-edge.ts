// Thick "fat-line" edge trim. Wraps three's LineSegments2 + LineMaterial
// so the bloom pass has enough pixel mass to halo. Replaces the
// 1-pixel LineBasicMaterial idiom across entity builders.
//
// Materials are registered in a module-level Set so the scene resize
// handler can keep their `resolution` uniform in sync — without it
// LineMaterial renders at zero width.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export const DEFAULT_GLOW_LINEWIDTH = 2.0;

const REGISTERED_MATERIALS = new Set<LineMaterial>();

export interface GlowEdgeOptions {
  linewidth?: number;
  opacity?: number;
  transparent?: boolean;
}

/**
 * Build a thick-line LineSegments2 from an EdgesGeometry (or any
 * BufferGeometry whose positions describe paired endpoints). The
 * returned object behaves like a Mesh; mutate `.material.color`,
 * `.material.opacity`, etc. just as you would with LineBasicMaterial.
 */
export function buildGlowEdges(
  geo: THREE.BufferGeometry,
  color: number,
  name: string,
  opts: GlowEdgeOptions = {},
): LineSegments2 {
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(geo as THREE.EdgesGeometry);
  const material = new LineMaterial({
    color,
    linewidth: opts.linewidth ?? DEFAULT_GLOW_LINEWIDTH,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    dashed: false,
  });
  // Seeded with the current window size; scene.ts replays the actual
  // canvas size after construction and on every resize.
  material.resolution.set(window.innerWidth, window.innerHeight);
  REGISTERED_MATERIALS.add(material);

  const line = new LineSegments2(lineGeo, material);
  line.name = name;
  // LineSegments2 needs computeLineDistances only when dashed; we
  // skip it for the default solid trim.
  return line;
}

/** Update every registered LineMaterial's resolution uniform. Called on canvas resize. */
export function applyGlowEdgeResolution(width: number, height: number): void {
  for (const mat of REGISTERED_MATERIALS) {
    mat.resolution.set(width, height);
  }
}
