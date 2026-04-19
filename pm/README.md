# Vylux PM loop

A self-driving product-manager → engineer loop that builds the Vylux MVP
incrementally. Runs continuously via `/loop 2m /vylux-pm` from inside the
`vylux/` repo.

## What is here

```
pm/
  mvp.md              Frozen MVP spec. Flip `status: complete` to stop the loop.
  persona.md          The PM's instructions (read by the /vylux-pm command).
  rubric.md           Visual-eval rubric. The PM evolves this over time.
  backlog.yaml        Task queue.
  active-task.md      Current task the engineer is building (absent when idle).
  .lock               Loop lock (gitignored). Stale after 30 min.
  inbox/              Messages from Jaco to the PM (see "Directing the PM").
  history/            Completed tasks + tick-log.md.
  scores/             JSON per visual-eval run.
  screenshots/        PNG scenes the PM scores against docs/concepts/.
  learnings/          Failure/experiment notes (PM + engineer).
```

## Running the loop

From `/Users/jacobusbrink/Jaxs/projects/vylux/`, inside a Claude Code session:

```
/loop 2m /vylux-pm
```

Leave it running. Stop it (Ctrl-C in the loop terminal) when:

- `pm/mvp.md` flips to `status: complete` and you want to review, or
- you want to change the MVP scope, or
- something is off.

## Kill switch

Edit `pm/mvp.md`:

```yaml
status: complete
```

Every subsequent tick exits immediately. Flip back to `in-progress` to resume.

## Reset the loop after a crash

If a tick hard-crashed and left a stale lock **and** you don't want to wait
30 minutes for auto-recovery:

```
rm pm/.lock
```

## Changing the MVP

Edit `pm/mvp.md` directly. The PM re-reads it every tick, so changes land
immediately. If you've already shipped features that a newly-added MVP item
implicitly covers, tick them off yourself — the PM will trust the file.

## Directing the PM (inbox messages)

When you want to redirect the PM without editing `pm/mvp.md` by hand — e.g.
you're unhappy with quality, you want to pivot, you want to tighten the
rubric — drop a message in `pm/inbox/`.

### How it works

- Every tick, **before** the completion gate, the PM lists `pm/inbox/*.md`.
- Each message's frontmatter has two flags: `draft` and `processed`.

| `draft` | `processed` | PM behaviour                                        |
| ------- | ----------- | --------------------------------------------------- |
| `true`  | `false`     | **Ignored.** PM does not read the body. Safe to keep editing. |
| `false` | `false`     | **Active directive.** PM reads, acts, flips `processed: true`, writes a `## Response` block. |
| `false` | `true`      | **Historical.** PM skips. Kept in-place for audit.  |
| `true`  | `true`      | (Shouldn't happen; treated as draft.)               |

- Messages outrank the completion gate — a boss directive can reopen a
  `status: complete` MVP.
- Multiple active directives are processed in filename-sort order. Use a
  date prefix (e.g. `2026-04-19-visual-quality.md`) to order your messages
  by intent.

### Writing a message

Use the helper script — it copies the template to a date-prefixed,
slug-sanitised filename:

```
pm/new-message.sh <slug>
# e.g.
pm/new-message.sh visual-quality
pm/new-message.sh "rubric too lenient"     # spaces get dashed automatically
```

This creates `pm/inbox/YYYY-MM-DD-<slug>.md` (UTC date) and prints the path.

Then:

1. Open the new file and fill in `## Context`, `## Direction`, and
   optionally `## Constraints` + `## What 'resolved' looks like`.
2. While `draft: true`, the PM ignores the file — safe to keep editing.
3. Flip frontmatter to `draft: false` when ready.
4. On the next tick (up to ~2 min later), the PM reads, mutates the
   relevant files (`pm/mvp.md`, `pm/rubric.md`, `pm/backlog.yaml`, or
   abandons `pm/active-task.md`), then writes a `## Response` block back
   into your message and sets `processed: true`.

(If you'd rather not use the script, you can `cp pm/inbox/_template.md
pm/inbox/YYYY-MM-DD-<slug>.md` by hand — same result.)

### Retracting a message

If you want to pull a message back before the PM sees it, just edit it
back to `draft: true` (or delete the file). Once `processed: true`,
retracting is a no-op — send a follow-up message instead.

### Reading what the PM did

- The `## Response` section at the bottom of each processed message.
- The corresponding line in `pm/history/tick-log.md`
  (`<timestamp> <tick_id> inbox:<filename> → <short action>`).

## Reading what happened

- **`pm/history/tick-log.md`** — one-liner per tick.
- **`pm/history/<task-id>.md`** — full task spec + engineer handoff + commit SHA.
- **`pm/scores/`** — JSON scores. Latest file = latest state.
- **`pm/learnings/`** — why things didn't work first try.

## Two roles, enforced

- **PM (`pm/persona.md`)** — specs, reviews, scores. **Never touches `src/`.**
- **Engineer (`.claude/agents/vylux-engineer.md`)** — builds. May touch any
  file in the repo. Commits to local `main` when the verify command passes.
  Never pushes.

Jaco pushes when he's happy with what landed.

## Refreshing screenshots

Scene screenshots in `pm/screenshots/` are generated by Playwright against the
dev server. The three scenes are: `idle-start`, `early-economy`, `mid-combat`.

To regenerate all three PNGs:

```
npm run scenes
```

This runs `playwright test --project=scenes`, which starts the dev server on
port 5180 (reusing an existing one if already running) and writes:

```
pm/screenshots/idle-start.png
pm/screenshots/early-economy.png
pm/screenshots/mid-combat.png
```

The scenes use a `?e2e=1` query param to activate the test hook
(`window.__vylux.setScene` / `window.__vylux.ready`). This hook is **not**
present in production builds — it only activates when `?e2e=1` is in the URL
on the dev server. Placeholder meshes (HQs, workers, raiders, energy nodes) are
seeded via the hook for scenes whose gameplay is not yet implemented.
