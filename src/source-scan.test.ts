import { describe, it, expect } from 'vitest';

const rawSources = import.meta.glob('./**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SOURCE_ENTRIES = Object.entries(rawSources).filter(
  ([path]) => !path.endsWith('.test.ts'),
);

const CATCH_MARKER = 'catch (';

/**
 * Walk forward from a `{` to its matching `}`, skipping nested braces,
 * line/block comments, and string literals (', ", `). Returns the substring
 * between (and not including) the outer braces.
 */
function extractBlock(source: string, openBraceIdx: number): string {
  let depth = 0;
  let i = openBraceIdx;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(openBraceIdx + 1, i);
      }
      i++;
      continue;
    }
    i++;
  }
  throw new Error(`extractBlock: unmatched brace starting at index ${openBraceIdx}`);
}

function scanForBareCatches(source: string, path = '<inline>'): string[] {
  const violations: string[] = [];
  let cursor = 0;
  while (true) {
    const idx = source.indexOf(CATCH_MARKER, cursor);
    if (idx === -1) break;
    cursor = idx + CATCH_MARKER.length;
    const brace = source.indexOf('{', cursor);
    if (brace === -1) {
      violations.push(`${path}: catch with no block after index ${idx}`);
      break;
    }
    const body = extractBlock(source, brace);
    const hasThrow = /\bthrow\b/.test(body);
    const hasLog = /\bconsole\.error\b/.test(body);
    if (!hasThrow && !hasLog) {
      const lineNo = source.slice(0, idx).split('\n').length;
      violations.push(`${path}:${lineNo} — catch block has neither throw nor console.error`);
    }
  }
  return violations;
}

describe('phase L93 — no bare catches / silent swallowing in src/**/*.ts', () => {
  it('scans at least one source file (glob regression guard)', () => {
    expect(SOURCE_ENTRIES.length).toBeGreaterThan(0);
  });

  it('detector catches a bare catch block in a synthetic sample (meta-test)', () => {
    const bad = `try { doThing(); } catch (e) { /* ignore */ }`;
    const good1 = `try { doThing(); } catch (e) { throw e; }`;
    const good2 = `try { doThing(); } catch (e) { console.error('x', e); }`;
    expect(scanForBareCatches(bad)).toHaveLength(1);
    expect(scanForBareCatches(good1)).toHaveLength(0);
    expect(scanForBareCatches(good2)).toHaveLength(0);
  });

  it('every catch block either throws or logs via console.error', () => {
    const violations: string[] = [];
    for (const [path, source] of SOURCE_ENTRIES) {
      violations.push(...scanForBareCatches(source, path));
    }
    expect(violations).toEqual([]);
  });
});

// Guardrail: every selectable entity must source its selection ring
// from `entity-chrome.ts`, never roll its own. A raw RingGeometry in
// any render file other than entity-chrome.ts is treated as a drift
// violation — the cyan-body + faction-emissive idiom needs to live in
// exactly one place so new entities can't silently get a non-blooming
// or off-palette ring (see commit history around the work-pod fix).
describe('entity-chrome — selection ring idiom must not drift', () => {
  const RING_GEOMETRY_RE = /new\s+THREE\.RingGeometry\s*\(/;
  // Files allowed to construct RingGeometry directly. Keep this list
  // tight — any new entry needs justification.
  const ALLOWED_RING_FILES = new Set<string>([
    './render/entity-chrome.ts',           // the canonical source
    './render/legacy/energy-node.ts',      // harvest-fill ring (not a selection ring)
    './render/legacy/worker.ts',           // harvest-fill ring (not a selection ring)
    './render/feedback.ts',                // transient click-feedback pings
  ]);

  it('no entity builder rolls its own selection ring', () => {
    const violations: string[] = [];
    for (const [path, source] of SOURCE_ENTRIES) {
      if (!path.startsWith('./render/')) continue;
      if (ALLOWED_RING_FILES.has(path)) continue;
      if (RING_GEOMETRY_RE.test(source)) {
        violations.push(`${path}: uses new THREE.RingGeometry directly; route selection rings through entity-chrome.ts`);
      }
    }
    expect(violations).toEqual([]);
  });
});
