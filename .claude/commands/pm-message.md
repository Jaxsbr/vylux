---
description: Draft a new Vylux PM inbox message from natural-language direction.
---

You are drafting an inbox message **from the Project Owner (Jaco) to the
Vylux Project Manager**. This is a top-down directive, not a peer note and
not a request. Jaco owns the product; the PM serves the owner's vision and
executes against it. Every word you write should read from that lens:

- **Voice:** first-person as Jaco — "I want…", "I'm seeing…", "reopen…",
  "pivot to…". Never "we", never "could you", never "please".
- **Stance:** directive and decisive. The owner states observations,
  direction, and constraints; the PM figures out the how.
- **Audience:** the PM only. Don't address the engineer, don't address
  future readers, don't explain context the PM already has from
  `pm/mvp.md` / `pm/persona.md` / prior inbox messages.

Your job is to turn Jaco's free-form direction (in `$ARGUMENTS`) into a
well-formed inbox file under `pm/inbox/`, following the template exactly.
You replace `pm/new-message.sh` — do not shell out to it.

## Preflight

Verify you're in the vylux repo:

```
test -f pm/inbox/_template.md || { echo "pm-message: not in vylux/ — aborting"; exit 0; }
```

If the template is missing, print the message and stop. Do not invent a
template.

## Inputs

- `$ARGUMENTS` — Jaco's direction, as typed. May be a one-liner ("mvp not met,
  nodes still look like cubes") or a paragraph. Treat it as raw source to
  distill, not as final prose.
- If `$ARGUMENTS` is empty, ask Jaco for a one-line subject + what he wants
  the PM to do differently, then proceed. Do not invent direction.

## Steps

1. **Distill a subject** — headline form, ≤ 80 chars, mirrors the slug.
   Examples: "MVP not met — energy nodes still look like cubes",
   "Pivot: drop combat polish for this sprint".
2. **Derive the slug** — lowercase, alphanumerics and hyphens only, collapse
   runs of non-alnum to a single `-`, strip leading/trailing `-`. Match the
   sanitization the old script did.
3. **Compute the filename** — `pm/inbox/<YYYY-MM-DD>-<slug>.md` using **UTC**
   date (`date -u +%Y-%m-%d`). If the file already exists, append `-2`, `-3`,
   … to the slug until free. Do not overwrite.
4. **Fill the template sections** from `$ARGUMENTS`, in Jaco's voice as
   owner-to-PM:
   - **Context** — 2–4 sentences in first person: what the owner observed
     that prompted this message. "I played a match and X looked wrong."
   - **Direction** — concrete owner-level asks, bullets where natural.
     Mirror Jaco's wording where he was specific; don't soften it into
     suggestions. Imperatives are fine ("Reopen MVP.", "Drop Y.",
     "Reprioritise the backlog around visual quality."). If he was
     directional ("focus on visual quality"), leave it directional — the
     PM is paid to figure out the how.
   - **Constraints** — only include if Jaco gave or implied non-negotiables
     from the owner's side. Otherwise omit the section entirely (don't
     leave an empty heading).
   - **What 'resolved' looks like** — only include if Jaco described an
     end-state, or if the direction is concrete enough that you can state
     one without inventing scope. Written as owner acceptance ("I can
     watch a worker walk to a node…"), not PM deliverables.
5. **Frontmatter**:
   - `draft: true` — **always**. Jaco flips it when the wording is right.
   - `processed: false`
   - `from: Jaco`
   - `priority` — default `normal`. Escalate to `high` or `urgent` only if
     Jaco's wording signals urgency ("urgent", "blocker", "stop the line",
     "reopen MVP", etc.). When in doubt, `normal`.
   - `subject` — the headline from step 1.
6. **Write the file** using the Write tool. Do not run the old script.
7. **Report** — print exactly:
   - the path written,
   - the subject + priority,
   - a one-line reminder: "Review, then flip `draft: true` → `false` to hand
     to the PM."

   Keep total output ≤ 8 lines.

## Safety rails

- Never modify existing inbox files — this command only creates new ones.
- Never flip `draft: false` yourself. That gate is Jaco's.
- Never invent constraints or acceptance criteria that Jaco didn't say or
  clearly imply. Leaving a section out is better than fabricating scope.
- Never touch `pm/mvp.md`, `pm/backlog.yaml`, `pm/active-task.md`, or
  anything under `src/` / `tests/`. Those belong to the PM and engineer.
- If `$ARGUMENTS` looks like it belongs somewhere else (e.g. a code change
  request for the engineer, or a direct edit to `pm/mvp.md`), say so and
  stop — don't force it into an inbox message.

Begin.
