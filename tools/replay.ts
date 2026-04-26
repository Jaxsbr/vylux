// Headless replay runner.
//
// Usage:
//   npx vite-node tools/replay.ts <replay.json>
//   npx vite-node tools/replay.ts <replay.json> --hashes-out <hashes.json>
//
// Loads a JSON replay produced by Match.toReplay() (see
// src/sim/replay.ts), runs the sim deterministically against the
// recorded input log, and prints the final tick/winner/hash.
//
// The optional --hashes-out flag dumps the per-tick hash stream as
// JSON. Useful for cross-OS comparison: produce on macOS, produce on
// Windows, `diff` the files.

import fs from 'node:fs';
import path from 'node:path';
import { parseReplay, playReplay } from '../src/sim/replay';

function usage(): never {
  console.error('usage: vite-node tools/replay.ts <replay.json> [--hashes-out <file>]');
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
  }

  const replayPath = args[0];
  if (!replayPath || replayPath.startsWith('--')) usage();

  const hashesOutIdx = args.indexOf('--hashes-out');
  const hashesOut = hashesOutIdx >= 0 ? args[hashesOutIdx + 1] : null;
  if (hashesOutIdx >= 0 && (!hashesOut || hashesOut.startsWith('--'))) usage();

  const json = fs.readFileSync(path.resolve(replayPath), 'utf-8');
  const replay = parseReplay(json);
  const result = playReplay(replay);

  console.log(`replay:        ${replayPath}`);
  console.log(`version:       ${replay.version}`);
  console.log(`frames:        ${replay.frames.length}`);
  console.log(`final tick:    ${result.tick}`);
  console.log(`winner:        ${result.winner}`);
  console.log(`final hash:    ${result.finalHash}`);
  if (replay.finalHash !== undefined) {
    console.log(`expected hash: ${replay.finalHash} (matched)`);
  }

  if (hashesOut) {
    const out = path.resolve(hashesOut);
    fs.writeFileSync(out, JSON.stringify(result.hashes, null, 2) + '\n');
    console.log(`hashes:        wrote ${result.hashes.length} entries to ${out}`);
  }
}

main();
