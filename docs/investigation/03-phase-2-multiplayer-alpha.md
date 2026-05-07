# Investigation 03 — Phase 2 Multiplayer Alpha

> **Status:** Open — sub-phases 2.0–2.5 closed (architecture complete); 2.6 parked pending alpha-launch operational decisions
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

### 2.0 — Two-tab same-browser lockstep ✅ closed

Before involving any network, prove the model on a single machine. Open two browser tabs, connect them via `BroadcastChannel` (each tab is one faction). Each tab sends its commands; both tabs run the same sim against the merged input stream. Hashes must match every tick.

This is the cheapest possible determinism check across "two clients" and the natural place to find any sim-vs-sim drift before adding real network noise. Step 5 of investigation 00 was originally this — deferred then for in-process reasons, picked up here properly.

**Exit:** two tabs play a full match end-to-end, hashes match, no desync. ✅

**What landed:**
- `src/net/lockstep-channel.ts` — typed transport over `BroadcastChannel` (or any `BroadcastChannelLike`). Three message kinds: `hello` (with auto-echo so late-join works), `frame` (per-tick, per-faction commands), `hash` (per-tick `stateHash()` for cross-tab desync detection).
- `src/render/sim-driver.ts` — `commandsForTick` may now return `null` to mean "wait, peer frame not in yet." The driver doesn't step, doesn't advance the schedule, and doesn't count a dropped step. Stalls release naturally on the next rAF.
- `src/main.ts` — URL-param mode gate: `?lockstep=host` runs faction 0, `?lockstep=join` runs faction 1, no params keeps the existing PvAI mode. HUD reports peer + last-resolved hash status.
- Canonical merge order — both peers consume frames in faction-0-then-faction-1 order. `TrainUnit` allocates entity IDs in apply order, so a different merge order would diverge by tick 1 of any tick where both factions queued a command. Caught immediately by the new gate.

**Gates added:**
- `src/net/lockstep-channel.test.ts` — protocol unit tests + a 600-tick two-sim same-state gate that drives two `Match`es over paired channels and asserts identical per-tick hashes throughout.
- `tests/e2e/lockstep.spec.ts` — Playwright opens both tabs, lets ~3s of sim run, asserts both HUDs show `peer connected` + `hash@N match`, no desync, no console errors.

**Lessons:**
- Within-frame command order is determinism-load-bearing because `applyCommand` mutates `state.nextEntityId`. Any future transport that splices peer commands into the local frame must preserve the same canonical order on both sides — sort by faction id, not by arrival.
- BroadcastChannel delivery is async on a microtask boundary, so the just-submitted hash for tick T is "pending" at the moment of render. The HUD shows the highest *resolved* tick instead. Same idea will apply across WebRTC in 2.1 (with much higher latency), so the API is already set up for it.
- The driver's `null = wait` extension is small and didn't disturb the AI / replay paths. It also means a deliberately-stalled callback can be used in 2.3 to test desync recovery without adding a separate code path.

### 2.1 — Signaling server + WebRTC datachannel ✅ closed (loopback)

Minimal Node.js server that relays SDP offer/answer + ICE candidates between two clients. Deploy to a free tier (Render / Fly / Railway). Client opens a WebRTC datachannel to its peer; lobby creates a room code that the server uses to pair connections.

Once the datachannel is up, the signaling server is unused for the duration of the match. Bandwidth target: <2 KB/s sustained per client (commands are tiny — empty frames are 4 bytes of tick number).

**Exit:** two clients on different networks (e.g. dev laptop + a phone on cellular) connect and exchange test messages.

**What landed:**
- `src/net/signaling-protocol.ts` — wire types (client + server messages, opaque `SignalPayload` for SDP / ICE). 6-character confusable-free room codes (alphabet excludes `I`, `L`, `O`, `0`, `1` for read-aloud safety).
- `src/net/signaling-server.ts` — `ws`-based WebSocket server. Pairs clients by room + role, blindly relays signal payloads, fires `peer-left` on disconnect. Stateless beyond the room map; goes dormant once the datachannel is open.
- `tools/signaling-server.ts` — CLI entrypoint (`npm run signaling`). PORT/HOST env override; clean SIGINT/SIGTERM shutdown.
- `src/net/webrtc-transport.ts` — client-side adapter implementing `BroadcastChannelLike`. Host creates the datachannel before the offer (lands in SDP, no renegotiation). Both sides trickle ICE through the relay. Outbound queue drains on datachannel-open so callers don't have to await readiness.
- `src/main.ts` — third run mode: `?lockstep=host&room=ABCDEF` / `?lockstep=join&room=ABCDEF`. Connecting overlay is shown until the datachannel opens; failures display the error and instruct reload. The signaling URL defaults to `ws://<host>:5182`, override with `?signaling=...` or `VITE_SIGNALING_URL` at build time.

**Gates added:**
- `src/net/signaling-server.test.ts` — 8 vitest cases against real `ws` clients on a random port: room pairing, bidirectional relay, peer-left notification, error paths (bad code, duplicate role, signaling without join, malformed JSON, no peer).
- `tests/e2e/lockstep-webrtc.spec.ts` — Playwright opens two pages, the host first then the joiner; full WebRTC handshake completes on loopback; both HUDs report `peer connected` + `hash@N match` within 4 s.
- `playwright.config.ts` — signaling server is registered as a third `webServer`, so `npm run test:e2e` auto-boots it on port 5182.

**Lessons:**
- Keeping the substrate behind `BroadcastChannelLike` was decisive. The `LockstepChannel`, the per-tick desync gate, and the canonical-merge-order rule all carry forward unchanged from 2.0; only the bytes-on-the-wire layer changed. Future substrates (WebTransport, QUIC datachannels) drop into the same socket.
- Confusable-free room codes paid off in tests: `ROOM23` failed 2.0 unit tests because the alphabet excludes `O`. Easier to enforce the constraint in a `isValidRoomCode` helper than to argue about every code at the call site.
- WebRTC's host-creates-datachannel-before-offer pattern avoids a renegotiation that would otherwise be the natural-feeling first step. Worth documenting at the call site so a later refactor doesn't accidentally invert it.
- Loopback ICE is fast (host candidates only); the 4 s test wait covers WebSocket connect + SDP exchange + ICE + datachannel open + a few seconds of sim. Cross-network ICE will take longer; the 15 s `openTimeoutMs` default in `WebRtcTransport` should hold for cellular peers but is a real tuning point in alpha.

**Operational follow-ups (out of code scope):**
- Deploy `tools/signaling-server.ts` to Render / Fly / Railway free tier. ~80 LOC, no DB, no auth — should fit a 1-CPU 256 MB instance trivially.
- Set `VITE_SIGNALING_URL` for the production build to point at the deployed signaling URL.
- Decide on TURN posture once cross-network failure rates are measured. Phase 2 deferred this; reopen only if alpha tells us we need it.

### 2.2 — Input-frame protocol + lockstep loop ✅ closed

Replace the current driver's `commandsForTick` callback with a network-aware version: send local commands for tick `T`, wait for opponent's commands for tick `T`, advance sim. Default 6-tick input delay (300ms at 20 Hz) so most RTTs don't stall the loop.

Both clients run identical sim code with identical input → identical state. The match doesn't need a server to validate anything — divergence is impossible if the code is deterministic, which Phase 0/1 proved.

**Exit:** a full match runs to completion between two real clients with no manual intervention. Both clients reach the same final hash. ✅

**What landed:**
- `src/net/lockstep-loop.ts` — `LockstepLoop` class + `INPUT_DELAY_TICKS = 6`. Owns the per-tick orchestration: pre-seed empty frames for ticks 0..D-1 on first `next()`, schedule local commands for tick `T+D`, submit hash for `T-1`, consume merged frame for `T`. Sim-pure (no DOM, no Three.js); main.ts and the unit gate share the same code.
- `src/main.ts` — replaced the inline lockstep callback with `lockstepLoop.next(match)`. PvAI path is unchanged. `collectLocalCommands` for the player is `input.takeQueued() ++ autoAssignIdleWorkers(state, playerFaction)`.
- HUD now shows `delay 6t (300 ms)` alongside peer + hash status, so a future tuning pass (or alpha playtester) can see the value at a glance.
- One delay constant covers both 2.0 (BroadcastChannel) and 2.1 (WebRTC) modes — same loop, different substrate. The local determinism gate doesn't care about the delay, and a single code path keeps the mental model simple.

**Gates added:**
- `src/net/lockstep-loop.test.ts` — 5 vitest cases including: pre-seed-stalls-then-resolves, two paired sims at D=6 reach identical per-tick hashes for 600 ticks, D=0 still works (back-compat for the 2.0-style direct callback), peer-not-connected returns null, default constant is 6.
- Existing 2.0 + 2.1 E2E (`lockstep.spec.ts`, `lockstep-webrtc.spec.ts`) carry across to D=6 unchanged — the HUD reports `peer connected · hash@N match · delay 6t` and ticks advance past 20 within 3–4 s of warm-up, exactly as before.

**Lessons:**
- Pre-seed timing matters. The first peer's `next()` runs before the second peer has pre-seeded, so its consume returns null one rAF early. Real drivers retry on the next animation frame, so this is invisible in production; tests have to mirror it (5-iteration retry budget, never reached in practice past iteration 0). Worth a comment at the loop call site so a future test author doesn't think it's a bug.
- Stale-state in `collectLocalCommands` is harmless for the current commands but worth flagging. Auto-assign-workers reads sim state at tick `T` but the resulting commands apply at `T+D=T+6` — by then the worker may be doing something else. The sim handles this gracefully (re-target is a no-op if the worker isn't idle anymore), but anything more decision-heavy added here in the future has to be aware of the staleness.
- The `LockstepChannel.tryConsumeOrderedFrame` API stayed identical from 2.0. Only the orchestration around it changed. That's the architectural property paying off: the substrate-and-loop boundary held firm across three sub-phases of additions.

### 2.3 — Desync detection + recovery (recovery = "show error and quit") ✅ closed

Periodically (every ~1 second) clients exchange the current `stateHash()`. Mismatch → log both clients' input logs, show a "Desync detected" screen, end the match. Don't try to recover; just surface the bug fast.

This is the production version of the in-process gate from Phase 0 — same idea, applied across the network.

**Exit:** a deliberately-corrupted client (test harness only) is detected within ~1 second of its first divergent tick. ✅

**What landed:**
- Hash exchange was already per-tick from 2.0 (better than the doc's "~1 second" cadence — every tick is ~50 ms at 20 Hz). The 2.3 work was the surface, the halt, and the test harness, not the detection itself.
- `DesyncOverlay` in `src/render/player-input.ts` — full-screen, red-orange `DESYNC DETECTED` heading, divergent tick, both faction hashes in monospace, `DOWNLOAD REPLAY` + `RELOAD` buttons. Mirrors the shape of `MatchEndOverlay`; once shown, persistent until reload (no continue path — desync is a bug).
- `src/main.ts` — `onDesync` callback now: ignores subsequent mismatches (first divergence wins), calls `driver.stop()` to halt the sim, and shows the overlay. The replay-download path uses the existing `Match.toReplay()` + `serialiseReplay()` and triggers a `<a download>` click — naming `vylux-desync-tick{T}-{role}.json` so a bug report is self-describing.
- `?desync-test=N` URL param — TEST-ONLY. The first rAF after the sim crosses tick `N`, `state.factions[0].points += 1` is mutated once. Production play with no param is unaffected. Lives in `tickHud` rather than the sim loop because the sim itself is purposely free of test hooks.

**Gates added:**
- `tests/e2e/lockstep-desync.spec.ts` — opens two tabs (one with `?desync-test=25`), waits up to 6 s, asserts:
  - `DESYNC DETECTED` heading visible on **both** tabs (the protocol fires onDesync on whichever side observes the mismatch first; in practice both sides exchange hashes per tick so both surface within the same exchange round).
  - Divergent tick falls in the `[N, N+20]` window — i.e. <1 s detection latency.
  - The `DOWNLOAD REPLAY` button is clickable (trial click; we don't capture the file because Playwright's download capture varies by browser).

**Lessons:**
- The 2.3 detection contract was *already met* by 2.0's per-tick hash exchange; this sub-phase was almost entirely UI + test harness. That's the value of the substrate-vs-loop boundary: each sub-phase only adds the layer of value that's actually missing.
- TEST-ONLY hooks need to be loud at the call site. The `?desync-test=N` injection sits in `tickHud` with a comment headed "TEST-ONLY" so a future code-archaeology pass doesn't mistake it for production behavior. The alternative — exposing a sim-level test hook — would have leaked test scaffolding into the determinism contract, which is exactly what Phase 0 fought for.
- Strict-mode locator gotcha for the E2E: `locator('div').filter({ hasText: 'DESYNC DETECTED' })` matches both the heading element and its container (which contains the heading text). Use `getByText('DESYNC DETECTED', { exact: true })` for unambiguous targeting.
- Chromium leaks GPU-driver `GL Driver Message` lines as `console.warning`. They're unrelated to game code; the test's console-error filter explicitly allows them through.

### 2.4 — Replay save / download from live matches ✅ closed

Wire `Match.toReplay()` to the match-end overlay: a "Download Replay" button writes a `.json` file (later `.bin` once we have a binary format). Replay can be loaded into the existing `tools/replay.ts` headless runner.

This makes match data shareable for bug reports + community use, with the `version: 1` format already locked in Phase 1.3.

**Exit:** save a replay from a live multiplayer match; replay it via the CLI; final hashes match the live match. ✅

**What landed:**
- `MatchEndOverlay` now takes a `downloadReplay` callback in its constructor and renders a `DOWNLOAD REPLAY` button alongside `PLAY AGAIN` on VICTORY/DEFEAT. Same shape as `DesyncOverlay`'s download button — both flows go through the same helper.
- `R` key during play triggers an immediate replay download. Useful for bug-report capture before a match has ended (a desync bug is the obvious case, but anything weird in the sim — a soft-lock, an oddly-stuck unit — can be snapshotted with one keystroke).
- `downloadReplay()` helper generalised: takes a `label` (`'replay'` or `'desync'`) so the saved filename is self-describing in either context. `vylux-replay-tick123-host.json` vs `vylux-desync-tick45-join.json`.

**Gates added:**
- `tests/e2e/lockstep-replay.spec.ts` — opens two tabs in lockstep, lets the loop run past the input-delay warm-up + ~50 ticks of paired play, presses R on host, captures the download with `page.waitForEvent('download')`, parses + plays via the in-process `playReplay()` from `src/sim/replay.ts`. `playReplay` itself throws on `finalHash` mismatch — passing it IS the round-trip assertion.

**Lessons:**
- `playReplay()` already does the round-trip assertion built-in (it throws on `finalHash` mismatch), so the E2E gate is just "load the file and call it." Same property the cross-OS CI workflow validates against committed golden fixtures, applied here to live-match-derived replays.
- Filename context matters for bug-report ergonomics. `vylux-desync-tick{T}-{role}.json` reads as "this was captured because the gate fired." `vylux-replay-tick{T}-{role}.json` reads as "this was a manual snapshot." Same JSON shape, different breadcrumb. Cheap to maintain via a `label` parameter; expensive to recover the context if the filename is generic.
- `R` is the only single-letter key in use; ESC is owned by selection clear, all letter keys are otherwise free. Document the binding in the README so a player doesn't have to read the source to find it.

### 2.5 — Observer mode prototype ✅ closed (local prototype)

A third client connects to a match-in-progress. The two players each forward their input frames to the observer via the signaling channel; the observer runs sim locally, read-only. Realtime (no broadcast delay yet — that's Phase 5).

This isn't a feature for the alpha audience as much as the **prototype of the technical pattern** — proves a third client can replay live state in real-time, which the eventual broadcast tooling needs.

**Exit:** one observer can attach to a 2-player match and watch it through to completion in sync. ✅

**What landed:**
- `src/net/observer-channel.ts` — `ObserverChannel`. Receive-only sibling of `LockstepChannel`. Listens on any `BroadcastChannelLike`, accumulates `frame` messages by `(tick, faction)`, exposes `tryConsumeMergedFrame(tick)` in canonical faction-id order. Ignores `hello` and `hash` messages — the observer doesn't participate in the handshake, it only consumes the frames the players are already sending.
- `src/net/observer-loop.ts` — `ObserverLoop`. Drives the sim from `ObserverChannel`. No input delay (the player-side delay is already baked into the frames being relayed; `frame{tick: T}` means "apply at sim tick T"). No hash submit (no local faction → no canonical local hash to emit; the desync gate is a player-side property).
- `src/main.ts` — `?lockstep=observe` mode. SimRenderer is read-only, no `InputController`, no `BuildablesPanel`. HUD shows `observer (local) · watching both`, both factions' state under `host` / `join` labels rather than `you` / `opp`. The DOWNLOAD REPLAY path still works — an observer can save its own replay log too.
- The local-BroadcastChannel substrate satisfies the 2.5 exit: three same-origin tabs on `BroadcastChannel('vylux-lockstep')`, the third one observes. WebRTC observer over signaling-relay is flagged as a follow-up (item 7 in the Follow-ups table) — same `ObserverChannel` API, different transport, same progression as 2.0→2.1.

**Gates added:**
- `src/net/observer-channel.test.ts` — 4 vitest cases: three-sim 600-tick same-state gate (host + join + observer must agree on per-tick hashes throughout, observer's merged frame must equal the players'), `bothFactionsSeen` semantics, `forgetBefore` pruning, observer ignores hello/hash.
- `tests/e2e/lockstep-observer.spec.ts` — three browser tabs (observer first, then host, then join). Within 3 s, observer reports `both factions live` and ticks within 5 of the slowest player (BroadcastChannel delivery is fast; the budget absorbs rAF jitter across three tabs).

**Lessons:**
- Mid-match attach is *not* free. The observer can only step tick T once both players' frames for T have arrived, and BroadcastChannel doesn't replay history. So an observer that joins late stalls forever waiting for the early frames it missed. Documented as follow-up (item 8); fix is straightforward (players replay their `localFrames` map on a hello-style notification) but out of scope for the prototype.
- Three-sim same-state property is the strongest correctness check Phase 2 has produced so far. Two-sim agreement could in principle hide a bug where both peers were *consistently* wrong. A third sim driven only from frames-on-the-wire is a "no shared mutable state can possibly explain agreement" check.
- The HUD-label refactor regressed `mouse.spec.ts`'s regex (which was hard-coded against `you  hp`). Lesson: renaming HUD labels is a load-bearing edit. Reverted to keep `you` / `opp` for player views, only changed the labels for the observer view. Worth flagging if the HUD ever gets a proper structured-display refactor.

### 2.6 — Closed alpha logistics ⏸ parked (operations, not engineering)

Discord channel, friend-invite mechanism, telemetry uplink (anonymous match-end stats), a basic "report desync" form. ~20 invited players. Goal: 100 ranked-quality 1v1 matches without desyncs.

If a desync happens in the wild: input log + final hash from both clients gets uploaded; we replay locally to find the divergence.

**Exit:** 100 matches played, observer mode used at least once, no unresolved desyncs.

**Why parked:** the architectural Phase 2 work (2.0–2.5) is complete. The engine is multiplayer-ready: deterministic sim, lockstep over WebRTC, input delay, desync detection + reporting surface, replay round-trip, observer prototype. 2.6 is a *launch* sub-phase — running an alpha against real players — and what it asks for is operational, not architectural:

- **Discord channel** — needs a real Discord server + Jaco's social network of alpha-testers.
- **Friend-invite mechanism** — already have URL-driven room codes (`?lockstep=host&room=ABCDEF`); the "invite" is sharing a URL. No code change required for the alpha shape; a polished lobby is item 6 in the Follow-ups table.
- **Telemetry uplink** — a five-line `fetch()` to a configurable endpoint on match-end. Premature without knowing what backend receives it (a Cloudflare Worker, a tiny Node service, a third-party analytics service). Decision unblocks the code.
- **Report desync form** — same shape: known endpoint receives the saved replay JSON. The DOWNLOAD REPLAY button on `DesyncOverlay` already produces the artifact; the missing piece is a destination.

**Resume conditions:**
- Discord server stood up + invitee list drafted.
- Telemetry endpoint chosen (and a write-key / URL provided as `VITE_TELEMETRY_URL` or similar).
- Report-desync destination chosen (could be the same endpoint or just an email address — even `mailto:bugs@example.com?subject=...` with the replay attached manually works for an alpha of 20).

When those land, 2.6 is a small engineering pass plus the playtest itself. None of it needs another architectural decision.

**Phase 2 in the meantime:** the architectural sub-phases close cleanly. The cross-OS determinism gate (Phase 0 contract) is still green; sim is untouched; the same `LockstepChannel` + canonical merge order has carried four substrates and three loop variants without moving. Phase 3 (faction + map depth) can begin against this stack at any time — multiplayer is a property of the engine now, not a feature gated by 2.6.

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

## Follow-ups

These are the loose ends accumulated across the closed sub-phases. None are blockers for the next sub-phase, but each should land before Phase 2 closes (or be explicitly de-scoped here). No scheduled agents — these are checkpoints to walk in-session.

| # | Item | From | Status | Notes |
|---|---|---|---|---|
| 1 | **HUD + desync-surface re-review.** After a few real two-tab play sessions, revisit whether the HUD's `peer connected · hash@N match` line and the desync overlay still feel right. The protocol-shape contract (`hello` / `frame` / `hash`) will travel onto every later transport, so any wording / placement / size changes are cheapest to make now. | 2.0 | open | Walk before 2.3 closes the desync-recovery surface. |
| 2 | **Deploy `tools/signaling-server.ts` to a free tier.** Render / Fly / Railway all fit; ~80 LOC, no DB, no auth, single port. Add a `Dockerfile` if the chosen platform wants one. | 2.1 | open | Required before any cross-network smoke. Not a code gate; the loopback E2E covers protocol correctness. |
| 3 | **Wire `VITE_SIGNALING_URL` for the production build.** Once (2) is deployed, set the env var on the production build pipeline so `npm run build` bakes the right URL into the bundle. Override path (`?signaling=...`) stays for emergency redirection. | 2.1 | open | Tied to (2). |
| 4 | **Decide TURN posture.** Default 2.1 ships with a single Google STUN entry; no TURN. If alpha telemetry reports >X% of pairings fail to establish (number TBD during 2.6), add a TURN relay — free tier or self-hosted `coturn`. Don't pre-build for a problem we may not have. | 2.1 | open | Alpha-data-driven decision. Risks list item #1. |
| 5 | **Vite / esbuild advisories.** `npm audit` flags 5 moderate dev-server CVEs (pre-existing, unrelated to `ws`); fix is a breaking Vite 5→6→8 upgrade. Triage as part of Phase 2's exit checklist or defer to a Phase 3 dependency-bump pass. | 2.1 | open | Dev-only blast radius; production bundle is unaffected. |
| 6 | **Lobby UI for room codes.** 2.1 ships URL-only (`?lockstep=host&room=ABCDEF`). A title-screen lobby with "create room" / "join room" makes the WebRTC mode usable for non-developers. Keep it minimal — copy room code to clipboard, paste-to-join. | 2.1 | open | Non-blocking for 2.2 / 2.3 plumbing. Lands well alongside 2.6 alpha logistics. |
| 7 | **WebRTC observer through the signaling relay.** 2.5 ships the local-BroadcastChannel observer (proves the technical pattern + closes the exit). For a network observer, extend the signaling protocol with an `observe` role and a "forward to observers" message kind; players multicast their `frame` messages through signaling. Same `ObserverChannel` listens, different substrate. | 2.5 | open | Required before "tournament caster joins remotely" is possible. Same shape as the 2.0→2.1 BroadcastChannel→WebRTC progression — the cheap version proves the pattern, the network version is a transport extension. |
| 8 | **Mid-match observer attach.** 2.5 requires the observer to be present at tick 0; if it joins later, it stalls forever waiting for frames it missed. Players already retain submitted frames in `LockstepChannel.localFrames` — on observer-joined notification, they could replay the backlog. | 2.5 | open | Nice-to-have for tournament use; orthogonal to (7). |

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
| 2026-04-26 | Sub-phase 2.0 closed. | Two-tab `BroadcastChannel` lockstep ships with unit + E2E gates; sim untouched (Phase 1 golden hashes still match). Canonical merge order locked in as a load-bearing rule. |
| 2026-04-26 | Sub-phase 2.1 closed (loopback). | Signaling server (`ws`) + `WebRtcTransport` (browser RTCPeerConnection) ship behind the same `BroadcastChannelLike` substrate, so `LockstepChannel` and the desync gate carry forward unchanged. Cross-network smoke is a manual deploy step — not a code gate. |
| 2026-04-26 | Sub-phase 2.2 closed. | `LockstepLoop` introduces 6-tick input delay (300 ms at 20 Hz) for both 2.0 and 2.1 modes. Pre-seeded warm-up frames keep the first D ticks deterministic and empty. The `LockstepChannel` API didn't move — substrate-and-loop boundary continues to hold. |
| 2026-04-26 | Sub-phase 2.3 closed. | DesyncOverlay + driver-halt + replay download + `?desync-test=N` test harness. Detection itself was already met by per-tick hash exchange from 2.0; this sub-phase only added the surface and the gate. |
| 2026-04-26 | Sub-phase 2.4 closed. | DOWNLOAD REPLAY button on MatchEndOverlay + R-key for mid-match save. Round-trip gate uses `playReplay()`'s built-in finalHash assertion — same property the cross-OS CI gate validates against golden fixtures. |
| 2026-04-26 | Sub-phase 2.5 closed (local prototype). | `ObserverChannel` + `ObserverLoop` ship behind the same `BroadcastChannelLike` substrate. Three-sim 600-tick gate proves observer reaches the same hashes as the players from frames-on-the-wire alone. WebRTC observer + mid-match attach are 2.5 follow-ups (items 7 + 8). |
| 2026-04-26 | Phase 2 architecture complete; 2.6 parked. | All sub-phases that produced engine-level changes (2.0–2.5) are closed with green gates. 2.6 is alpha-launch logistics (Discord, telemetry destination, invitee list) — no architectural unblock needed; resumes when the operational shape is decided. Phase 3 may begin against the current stack at any time. |

## Next investigation

Phase 3 (faction + map depth) gets its own doc when Phase 2 closes. Until then, the PRD §8 paragraph is sufficient for long-range orientation.
