# Investigation 03 — Phase 2 Multiplayer Alpha

> **Status:** Open — not started
> **Phase:** 2 (Multiplayer Alpha)
> **Owner:** Jaco
> **Created:** 2026-04-26
> **Time-box:** target 6–10 weeks of focused work
> **Depends on:** Phase 1 (closed)

---

## Why this exists

PRD §8 Phase 2: _"Lockstep over WebRTC, relay server for NAT, basic lobby. Closed alpha with ~20 invited players. Exit: 100 ranked-quality 1v1 matches played end-to-end without desync; observer mode prototype working."_

Phase 0 proved the sim is bit-deterministic. Phase 1 made it playable single-player against AI. Phase 2 takes the same deterministic sim and runs it on **two machines simultaneously**, with each client only sending its own commands and receiving the opponent's. This is the lockstep model — the same engine StarCraft, AoE2, Brood War, and most of the genre's competitive scene runs on.

The sim is already ready for this — the code path is "given an input frame, advance state deterministically." Phase 2 is **transport, lobby, and observer plumbing**. No sim changes should be required.

## Scope

### In scope

- **WebRTC datachannel transport.** Peer-to-peer input-frame relay between two clients. Default low-latency (unordered, unreliable initially; reliability layered on top).
- **Signaling server.** ~50–100 lines of Node.js, deployed on a free tier (Render / Fly / Railway). Handles SDP exchange + ICE candidate relay only. Once peers are connected, gameplay traffic goes peer-to-peer; the server is dormant.
- **Lobby (room-code style).** Player A creates a match → gets a 6-character code. Player B enters the code → signaling handshake → sim starts. No skill-based matchmaking yet (Phase 4).
- **Input-frame protocol.** Client sends `{ tick, commands }`; server / peer relays to opponent. Sim advances only when both factions' frames for tick `T` are received. Fixed input delay (default 6 frames at 20 Hz = 300ms) hides RTT under typical conditions.
- **Replay capture from live matches.** Already half-done in Phase 1.3 — wire match-end to save the replay locally + add a download button on the VICTORY/DEFEAT overlay.
- **Observer mode prototype.** A third client receives input frames from both players via signaling, runs sim locally read-only. No new sim work — observer is just a client without a player faction.
- **Desync detection at the protocol layer.** Each client periodically sends its `stateHash()` for the current tick; opponent compares. Mismatch → log + show a desync screen so a real bug is reported rather than silently corrupting the match.
- **Telemetry + reporting.** Anonymous match-end uplink: final hash, winner, duration, faction picks. Plus a "report desync" form that uploads the input log.

### Out of scope (deferred)

- **TURN relay servers.** STUN gets us through most NATs; corporate / strict-NAT players are rare in a closed alpha. Add TURN if specific friends report failures.
- **Skill-based matchmaking, ladder, ranks.** Phase 4 territory.
- **Reconnect / mid-match resume.** v1 lockstep with input delay — disconnect = match over. Reconnect is a hard problem (rollback, state resync) and not worth solving for an alpha.
- **Mobile / touch transport.** No.
- **Replay sharing / browsing UI.** Phase 5. Phase 2 just persists replays locally.
- **Spectator delay (broadcast safety).** Phase 5. Observer mode in Phase 2 is realtime + read-only, suitable for friends watching but not for tournament casts.

### Out of scope (forever, unless re-pitched)

- Server-authoritative game state. Lockstep determinism is the contract; central authority is a different game architecture and would invalidate the entire Phase 0/1 stack.
- Network-tick-rate sim. Sim runs at its own fixed tick (20 Hz); transport rate is independent.

## Sub-phases (rough sequence)

Each sub-phase ends with the cross-OS CI gate still green and a commit on `main`. Determinism stays load-bearing — adding multiplayer must not regress single-player or the golden fixtures.

### 2.0 — Two-tab same-browser lockstep

Before involving any network, prove the model on a single machine. Open two browser tabs, connect them via `BroadcastChannel` (each tab is one faction). Each tab sends its commands; both tabs run the same sim against the merged input stream. Hashes must match every tick.

This is the cheapest possible determinism check across "two clients" and the natural place to find any sim-vs-sim drift before adding real network noise. Step 5 of investigation 00 was originally this — deferred then for in-process reasons, picked up here properly.

**Exit:** two tabs play a full match end-to-end, hashes match, no desync.

### 2.1 — Signaling server + WebRTC datachannel

Minimal Node.js server that relays SDP offer/answer + ICE candidates between two clients. Deploy to a free tier (Render / Fly / Railway). Client opens a WebRTC datachannel to its peer; lobby creates a room code that the server uses to pair connections.

Once the datachannel is up, the signaling server is unused for the duration of the match. Bandwidth target: <2 KB/s sustained per client (commands are tiny — empty frames are 4 bytes of tick number).

**Exit:** two clients on different networks (e.g. dev laptop + a phone on cellular) connect and exchange test messages.

### 2.2 — Input-frame protocol + lockstep loop

Replace the current driver's `commandsForTick` callback with a network-aware version: send local commands for tick `T`, wait for opponent's commands for tick `T`, advance sim. Default 6-tick input delay (300ms at 20 Hz) so most RTTs don't stall the loop.

Both clients run identical sim code with identical input → identical state. The match doesn't need a server to validate anything — divergence is impossible if the code is deterministic, which Phase 0/1 proved.

**Exit:** a full match runs to completion between two real clients with no manual intervention. Both clients reach the same final hash.

### 2.3 — Desync detection + recovery (recovery = "show error and quit")

Periodically (every ~1 second) clients exchange the current `stateHash()`. Mismatch → log both clients' input logs, show a "Desync detected" screen, end the match. Don't try to recover; just surface the bug fast.

This is the production version of the in-process gate from Phase 0 — same idea, applied across the network.

**Exit:** a deliberately-corrupted client (test harness only) is detected within ~1 second of its first divergent tick.

### 2.4 — Replay save / download from live matches

Wire `Match.toReplay()` to the match-end overlay: a "Download Replay" button writes a `.json` file (later `.bin` once we have a binary format). Replay can be loaded into the existing `tools/replay.ts` headless runner.

This makes match data shareable for bug reports + community use, with the `version: 1` format already locked in Phase 1.3.

**Exit:** save a replay from a live multiplayer match; replay it via the CLI; final hashes match the live match.

### 2.5 — Observer mode prototype

A third client connects to a match-in-progress. The two players each forward their input frames to the observer via the signaling channel; the observer runs sim locally, read-only. Realtime (no broadcast delay yet — that's Phase 5).

This isn't a feature for the alpha audience as much as the **prototype of the technical pattern** — proves a third client can replay live state in real-time, which the eventual broadcast tooling needs.

**Exit:** one observer can attach to a 2-player match and watch it through to completion in sync.

### 2.6 — Closed alpha logistics

Discord channel, friend-invite mechanism, telemetry uplink (anonymous match-end stats), a basic "report desync" form. ~20 invited players. Goal: 100 ranked-quality 1v1 matches without desyncs.

If a desync happens in the wild: input log + final hash from both clients gets uploaded; we replay locally to find the divergence.

**Exit:** 100 matches played, observer mode used at least once, no unresolved desyncs.

## Success criteria — Phase 2 exit gate

| # | Criterion |
|---|---|
| 1 | Two clients on different networks play a 1v1 match end-to-end with no desyncs. |
| 2 | 100 closed-alpha matches recorded with no unresolved desync reports. |
| 3 | Observer mode prototype works on at least one live match. |
| 4 | Replay format round-trip survives the network path: replay saved from live match validates via `tools/replay.ts`. |
| 5 | Cross-OS determinism gate (Phase 0's contract) stays green throughout. |
| 6 | Bandwidth per client stays under ~2 KB/s sustained on a typical match. |

## Risks — ranked

1. **NAT traversal failures.** Some players will be behind strict / corporate NATs that STUN can't punch through. Mitigation: track failure rate during alpha; add TURN relay (free tier or self-host) only if it's a real blocker. Don't pre-build infrastructure for a problem we may not have.
2. **Latency over ~150 ms RTT feels bad in lockstep.** Input delay of 6 frames hides ~300ms of round-trip; beyond that the player feels every input lag. Mitigation: regional matchmaking is Phase 4; for alpha, friends-list + manual room codes mean players can avoid trans-global matches.
3. **Browser-specific non-determinism we missed.** Phase 0's CI gate validated Linux + macOS + Windows _Node_ V8. The browser V8 is the same engine but with different feature flags (e.g. `--no-fast-math`, GPU paths). Mitigation: Sub-phase 2.0's two-tab gate catches anything browser-specific before networking is added.
4. **Clock-drift / pause-handling pathologies.** A client whose tab goes background pauses its sim catch-up; on resume, MAX_STEPS_PER_FRAME bounds the catch-up rate but the clients can desync if the spec doesn't define what "paused" means. Mitigation: pause = forfeit on the multiplayer path. Single-player keeps the tolerant pause.
5. **Solo-dev throughput on the lobby + signaling glue.** This is the boring infrastructure that's easy to underestimate. Mitigation: deploy on a free tier with as few moving parts as possible. ~50 lines of Node.js per the PRD §3.2 budget.

## Open questions (settled during, not before)

- **WebRTC vs WebSocket as the default transport?** Default WebRTC for low latency. WebSocket fallback only if NAT is impossible. Most casual-friend traffic goes WebRTC just fine.
- **Input-delay cap?** Start at 6 frames (300ms). Tune in alpha; some genres feel okay up to 10 frames, others crack at 4. Playtest-driven.
- **Where does the signaling server live?** Free tier on Render or Fly. Trivial to migrate; this is not a load-bearing infra decision.
- **What does "match starts" look like?** Both clients confirm they're loaded → server/peer broadcasts a "start at wall-clock T+1s" so both clients begin tick 0 at the same moment. Adapt as needed.

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-26 | Phase 2 opens after Phase 1.7 + visual restoration. | Phase 1's sim contract is verified end-to-end; multiplayer is now plumbing on top of a known-good engine. |
| 2026-04-26 | No sim changes expected in Phase 2. | If a sim change is required to land multiplayer, that's a bug or a missed Phase 1 requirement — flag and revisit, don't paper over. |
| 2026-04-26 | Server-authoritative path explicitly rejected. | Lockstep determinism is the architecture; central authority is a different game and would invalidate Phase 0/1. |

## Next investigation

Phase 3 (faction + map depth) gets its own doc when Phase 2 closes. Until then, the PRD §8 paragraph is sufficient for long-range orientation.
