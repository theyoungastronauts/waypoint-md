---
waypoint: 1
title: "Waypoint UX round 1 — six review-view improvements"
project: waypoint
---

# Waypoint UX round 1

Six notes from using Waypoint for real. I investigated each against the code;
below is what I found, a recommendation, and the decisions I actually need from
you. Three are near-mechanical (I'd just build them); three have a genuine fork.
Once you sign off, this becomes a phased plan.

Complexity tags: 🟢 simple · 🟡 medium · 🔴 design-level.

---

## 1. 🟢 Chat auto-scroll fights you

**Confirmed.** `agent-panel.tsx` scrolls to the bottom on *every* message/stream
tick unconditionally, so scrolling up to re-read yanks you back down. Standard
fix: only auto-scroll when you're already pinned to the bottom (within ~50px);
the moment you scroll up, it leaves you alone until you return. No decision
needed — I'll just do it.

## 2. 🟡 The suggested answer should be one-click copyable

Today an assistant reply gets **Append / Replace** buttons that write the whole
message into the focused answer. Your note: when the agent proposes specific
answer text, *that part* should be grabbable in one obvious click. Two reads of
"copyable" — they're different features, so I need to know which you mean.

<!-- wp:question id="q1" type="choice" select="single" -->
**Q1 — What should the one-click action do, and what does it grab?**
- [x] Agent wraps its proposed answer in a fenced block; a **"Use this answer"** button on that block replaces the focused answer with just those contents (not the whole chat message)
- [ ] A plain **Copy** button that puts the suggested text on the clipboard (you paste it yourself)
- [ ] Both: copy-to-clipboard *and* insert-into-answer on the suggestion block
<!-- wp:answer -->
Leaning to the first: the value is getting the suggestion into the answer with
one click, and a fence lets the agent mark exactly which span is "the answer"
vs. its surrounding explanation. Requires a light convention in the agent's
system prompt ("put the suggested answer in a ```suggestion fence"). If you just
want clipboard, that's simpler but you still hand-paste.
<!-- /wp:answer -->
<!-- /wp:question -->

## 3. 🟡 Every choice should be de-selectable

**Confirmed gap.** Multi-select can already clear itself; single-select radios
can't be un-picked once clicked — so there's no way to say "none of these is a
good starting point" except by ignoring the group. You want that to be explicit.

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — How should "none of these" work for single-select?**
- [x] Clicking the already-selected radio de-selects it (back to no selection); no visual clutter
- [ ] Add an explicit **"Clear selection"** link under the group when something is picked
- [ ] Both
<!-- wp:answer -->
Click-to-deselect is the least intrusive and matches the muscle memory you
already reached for. The always-visible elaboration field is where the "here's
what I'd do instead" text goes, so no options need to change. (One caveat:
click-to-deselect on radios is slightly non-standard, so I'd add a tiny hint.)
<!-- /wp:answer -->
<!-- /wp:question -->

## 4. 🟡 Attach files to a response (by path, inline)

The idea: drop a file **path** into an answer/elaboration box — not an upload,
just the path as text, inserted inline at the cursor, with `~/` preserved (and
redundant absolute prefixes stripped to `~/…`). So an answer can point the agent
at `~/prj/foo/bar.ts` cleanly.

<!-- wp:question id="q3" type="choice" select="single" -->
**Q3 — How does a path get inserted?**
- [x] A small **"Attach path"** affordance on each answer box opens a native file picker; the chosen path is inserted at the cursor, normalized to `~/…`
- [ ] Type-ahead: typing `~/` in a box triggers a path autocomplete against the server's filesystem
- [ ] Both
<!-- wp:answer -->
The picker is simple, needs no server FS access, and matches "attach." Type-ahead
is nicer but needs a filesystem-listing endpoint (and a security boundary like
the path-ingest allowlist) — more surface than the note implies. Recommend the
picker for round 1; note type-ahead as a later add. Flag: a browser file picker
gives a browser path, not necessarily `~/abs` — I may need to reconstruct `~/`
from the home dir, which the picker can't always provide. If that's shaky I'll
fall back to a plain "insert path" text prompt.
<!-- /wp:answer -->
<!-- /wp:question -->

## 5. 🔴 Elaboration prefill — you were right, it's mapped wrong

You asked me to double-check, so here's the finding in full.

On a **choice** question, the `<!-- wp:answer -->` block does double duty. It is
both (a) where an *agent* writes its rationale for the pre-checked option, and
(b) what the UI labels **"Elaboration"** and prefills into an editable box that
is meant for *your* words. So the agent's justification shows up sitting in your
slot — which is exactly why it "doesn't seem like what the user would put there."

(On a **text** question, prefilling `wp:answer` is correct and should stay — that
*is* the suggested draft answer the reviewer edits, per SPEC §5.2. The mismatch
is choice-specific.)

<!-- wp:question id="q4" type="choice" select="single" -->
**Q4 — Where should an agent's rationale for a choice live, and what's the box's default?**
- [x] Split them: agent rationale renders as a read-only **"Why I suggested this"** note under the pre-checked option; the elaboration box defaults **empty**. Needs a small SPEC addition (a rationale block distinct from `wp:answer`).
- [ ] Keep one field but default the box **empty**; show the agent's text as a **clickable suggestion** under it that prefills on click (your idea — no SPEC change, but rationale and reviewer-elaboration still share one slot once clicked)
- [ ] Just default the elaboration **empty**, drop the agent rationale entirely on choice questions
<!-- wp:answer -->
I recommend the split. It fixes the category error at the convention level: an
agent's "why this pick" is prompt-side context, not the reviewer's answer, and
keeping them separate means the digest/export stops conflating them (your q1/q2/q3
"Note:" fields in the publish spec were really *my rationale*, not your
elaboration). The clickable-suggestion option is a fine lighter-weight middle
ground if you'd rather not touch the SPEC yet. This one's your call — it's the
only item here that changes the convention.
<!-- /wp:answer -->
<!-- /wp:question -->

## 6. 🔴 Paste an image for context (like Claude Code)

Paste a screenshot from the clipboard into the AI sidebar as context. This is
the biggest lift: clipboard-image capture, storing the bytes (data dir, not the
DB), threading them into the chat context as image blocks, and it only works on
vision-capable models. Real, but a proper mini-project.

<!-- wp:question id="q5" type="choice" select="single" -->
**Q5 — Scope image paste for this round?**
- [x] Defer to its own round — build the five above first, spec image-paste separately
- [ ] Include a minimal version now (paste → send as context on the *next* chat message only, no persistence, current model must be vision-capable)
- [ ] Full version now (persisted, shown in the thread, re-sent with context)
<!-- wp:answer -->
Recommend deferring. Items 1–5 are a tight, shippable batch touching the review
view; image paste pulls in storage, the chat context assembler, and model-
capability gating, and deserves its own spec pass (it's a natural sibling to the
publish work already queued). If you want a taste sooner, the minimal version is
cheap but throwaway.
<!-- /wp:answer -->
<!-- /wp:question -->

## 7. 🟢 Sequencing

<!-- wp:question id="q6" type="text" -->
**Q7 — Any resequencing or anything I missed?** My default order: ship 1 (scroll)
+ 3 (deselect) first as quick wins, then 2 (suggestion), then 4 (path attach),
then 5 (elaboration) as it may touch the SPEC, with 6 (images) as its own round.
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
