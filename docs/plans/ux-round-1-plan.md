# Waypoint UX Round 1 — Implementation Plan

**Status:** Ready for autonomous execution · **Source:** [ux-round-1.md](ux-round-1.md) + its ratified digest ([ux-round-1.digest.md](ux-round-1.digest.md))

Six review-view improvements, all decisions baked. Executed one phase at a time
through the executor/reviewer pipeline: execute → gate → adversarial review →
commit. Standing gates after every phase: `pnpm typecheck && pnpm lint && pnpm
test && pnpm build`. The spec-package byte-fidelity invariant
(`applyReview(raw, {}) === raw`; round-trip recovers state) is the #1
non-negotiable and must stay green — Phase 4 touches `@waypoint/spec`, so it gets
the most scrutiny.

## Ratified decisions (from the review)

| # | Note | Decision |
|---|---|---|
| 1 | Chat autoscroll fights you | Auto-scroll only when already pinned to bottom (~50px). No decision needed. |
| 2 | One-click use of a suggested answer | Agent wraps its proposed answer in a fenced block; a **"Use this answer"** button on that block replaces the focused answer with just the fence contents. |
| 3 | De-select a single choice | Explicit **"Clear selection"** link under the group when something is picked (multi already clears by toggling). |
| 4 | Attach a file by path | **"Attach file"** affordance opens a native picker; the chosen path is inserted at the cursor, normalized to `~/…`. Picker only (no filesystem type-ahead this round). |
| 5 | Elaboration prefill is mapped wrong | **Split at the SPEC level:** a new `wp:rationale` block carries the agent's "why this pick", rendered read-only under the pre-checked option; the elaboration box (`wp:answer`) defaults **empty**. |
| 6 | Paste an image for context | Reframed: an **attachment on the response**, not chat. Pasting an image while the answer/elaboration field is focused adds a **removable thumbnail** under the box. Persisted; exported alongside the review. |

## Baked technical decisions (lead-resolved; the non-obvious calls)

These were open after the review; resolved here so execution needs no further input.

- **B-1 (suggestion fence, #2):** the agent marks a suggested answer with a
  ` ```wpsuggest ` fenced code block. The chat renderer detects that language and
  renders the block with a **"Use this answer"** button that calls the existing
  `insertIntoAnswer(focusedId, contents, "replace")`. Requires a one-line
  addition to the sidebar system prompt teaching the fence. Falls back to normal
  code rendering when no item is focused.
- **B-2 (rationale block, #5):** new optional block **nested inside a choice
  question**: `<!-- wp:rationale -->…<!-- /wp:rationale -->`, placed after the
  options and before `wp:answer`. It is **author input, never review state** —
  `parseDocument` surfaces it as `item.rationale` (markdown); `applyReview` never
  rewrites it, so byte-fidelity is unaffected. The digest gains a `**Why:**`
  field distinct from the reviewer's `**Note:**`. Authoring guidance in the
  skill is updated to teach it. SPEC bumps to **1.1.0** (additive, back-compatible
  — `waypoint: 1` docs without a rationale block parse unchanged).
- **B-3 (attachment storage, #6):** bytes live in
  `WAYPOINT_DATA_DIR/attachments/<attachmentId>` (never the DB, mirroring the raw
  upload store). New `attachments` table: `id · item_id (fk) · filename · mime ·
  bytes_len · created_at`. Images only (`image/png|jpeg|gif|webp`), 10 MB cap.
- **B-4 (attachment export, #6):** attachments are **additive to export, never
  spliced into the immutable body** — the byte-fidelity invariant is untouched.
  On `waypoint pull` (and the web export), attachments materialize into a
  sibling **`<name>.attachments/`** folder, and each answer that has attachments
  gets a reference line appended **inside its `wp:answer` interior** on export
  (e.g. `\n\n_Attachment: ![screenshot](<name>.attachments/<file>.png)_`) — this
  is reviewer-authored answer content, so it is legitimately part of the answer,
  not a body mutation. The digest lists each response's attachment relative
  paths under a `**Attachments:**` field. A document with no attachments exports
  byte-identically as before.
- **B-5 (path normalization, #4):** a picked absolute path under the user's home
  is rewritten to `~/…`; paths outside home stay absolute. Home comes from a
  small `GET /api/env/home` (server-side `os.homedir()`, auth-covered) since the
  browser can't know it. Insertion is at the textarea caret; no file is read or
  uploaded — it is literally text.

## Phase map

| Phase | Scope | Touches | Ends usable as |
|---|---|---|---|
| 1 | Quick wins: chat autoscroll (#1) + Clear-selection link (#3) | review components | scroll stays put; single choices clear |
| 2 | "Use this answer" suggestion fence (#2) | agent panel + sidebar prompt | one-click suggestion → focused answer |
| 3 | Attach file (#4) | answer/choice cards + tiny home endpoint | pick a file → `~/` path at the caret |
| 4 | Elaboration split (#5) — SPEC 1.1.0 | `@waypoint/spec`, render, digest, skill | rationale read-only; elaboration blank |
| 5 | Image attachments on responses (#6) | schema, attachments API, cards, export/CLI | paste image → removable thumbnail, exported |

Order matches the reviewer's default (quick wins first; SPEC change before the
attachment work that also touches export). Each phase ends shippable.

---

## Phase 1 — Quick wins (#1 autoscroll, #3 clear-selection)

**Objective:** Two independent, low-risk fixes to the review view.

### Tasks
- [ ] **Autoscroll (#1):** in `agent-panel.tsx`, track whether the scroll
  container is pinned to the bottom (`scrollHeight - scrollTop - clientHeight <
  50`) via an `onScroll` handler into a ref. In the message/stream effect,
  auto-scroll **only when pinned**. Scrolling up frees you; scrolling back to the
  bottom re-arms it. Keep the jsdom-safe `scrollTo?.` guard.
- [ ] **Clear selection (#3):** in `choice-group.tsx`, when `selected.length > 0`,
  render a small **"Clear selection"** text button under the options that calls
  `commitSelection([])`. Applies to both single and multi (multi can already
  toggle each off, but the link is a convenient "reset"). A tiny helper caption
  clarifies that clearing means "none of these — answer below instead."
- [ ] Tests: a unit for the pinned-to-bottom predicate; a choice-group test that
  clearing empties the selection and leaves elaboration untouched.

### Exit criteria
- Scrolling up in a streaming chat is no longer yanked down; returning to the
  bottom resumes follow. Single-select group can be fully cleared. Gates green.

### Verification notes
- Confirm the autoscroll predicate isn't fooled by sub-pixel rounding; test the
  boundary. Confirm clearing a selection does not clear the elaboration text and
  reverts item status to untouched (unless elaboration has content).

---

## Phase 2 — "Use this answer" suggestion fence (#2)

**Objective:** A suggested answer from the agent becomes a one-click drop into
the focused answer (decision B-1).

### Tasks
- [ ] **Sidebar prompt:** add one line to the chat system prompt (in the chat
  route / `lib/ai`) instructing the model, when it proposes a concrete answer for
  the focused item, to put *only that answer* in a ` ```wpsuggest ` fenced block,
  with its explanation outside the fence.
- [ ] **Render:** in the agent panel's markdown rendering, detect a `wpsuggest`
  code block and render it as a distinct card with the fence contents shown and a
  prominent **"Use this answer"** button. Clicking calls
  `insertIntoAnswer(focusedId, contents, "replace")` and flashes a confirmation.
  When no item is focused, show the same "focus a question" hint used by the
  existing insert controls.
- [ ] Keep the existing whole-message Append/Replace controls as the general
  fallback; `wpsuggest` is the precise path.
- [ ] Tests: rendering detects the fence and wires the button to a replace on the
  focused id; no-focus disables it; a message with no fence is unaffected.

### Exit criteria
- Ask the sidebar for a suggested answer, get a fenced block with **Use this
  answer**, click it, and only the suggestion lands in the focused answer. Gates
  green.

### Verification notes
- The fence contents must be inserted raw (answers are markdown), not
  HTML-rendered. Confirm a fence with no focused item can't silently no-op
  without telling the user.

---

## Phase 3 — Attach file (#4)

**Objective:** Insert a filesystem path (normalized to `~/…`) at the caret of an
answer/elaboration box, via a picker (decisions B-5).

### Tasks
- [ ] **Home endpoint:** `GET /api/env/home` → `{ home }` from `os.homedir()`,
  auth-covered, server-only. Used to normalize picked paths.
- [ ] **Attach affordance:** a small **"Attach file"** button on each answer
  surface (text `QuestionCard` and the `ChoiceGroup` elaboration). It opens a
  native file input (`<input type="file">`); on pick, take the file's path where
  available, normalize (strip a leading `home` → `~/`), and insert at the
  textarea caret, then trigger the existing autosave.
- [ ] **Reality check + fallback:** browsers expose only the base filename on an
  `<input type="file">`, not the absolute path (security). So the picker alone
  can't produce `~/prj/foo.ts`. Fallback baked in: the affordance opens a **small
  prompt pre-seeded with `~/`** where the path is typed/pasted (this is the
  honest, working version); a picker is offered where a real path is obtainable
  (e.g. drag-drop with a path, or a future desktop shell). Document this clearly
  — the note asked for "attach file," and inserting a normalized path string is
  the deliverable regardless of picker vs. prompt.
- [ ] Tests: normalization (home→`~/`, outside-home stays absolute, no double
  slashes); caret insertion into an existing value; autosave fires.

### Exit criteria
- From an answer box, invoke Attach file, produce a `~/…` path inserted at the
  caret, and see it autosave. Gates green.

### Verification notes
- Verify the home-strip is anchored (only a leading home prefix, not a substring)
  and case/trailing-slash correct. Confirm no filesystem read happens — it is
  text insertion only.

---

## Phase 4 — Elaboration split, SPEC 1.1.0 (#5)

**Objective:** Separate the agent's choice rationale from the reviewer's
elaboration at the convention level (decision B-2). The highest-care phase — it
edits `@waypoint/spec`.

### Tasks
- [ ] **SPEC:** add `wp:rationale` to `docs/SPEC.md` as an optional block nested
  in a choice question (after options, before `wp:answer`), authored by the doc
  producer, carrying "why this option". Bump `SPEC_VERSION`/doc to **1.1.0**;
  note back-compatibility (absence changes nothing).
- [ ] **Parser:** `parseDocument` captures `item.rationale` (markdown + spans).
  `applyReview` treats it as immutable input — never rewritten — so
  `applyReview(raw, {}) === raw` holds. Add fixtures: a choice with a rationale
  block; a choice with rationale **and** a reviewer answer; ensure round-trip and
  byte-fidelity across all fixtures (forced-flip invariant still applies).
- [ ] **UI:** render `item.rationale` as a read-only **"Why I suggested this"**
  note under the pre-checked option in `ChoiceGroup`; the elaboration textarea
  now defaults **empty** (stop seeding it from `wp:answer` for choice items —
  text questions keep their draft prefill from SPEC §5.2).
- [ ] **Digest:** add a `**Why:**` field (the rationale) distinct from the
  reviewer's `**Note:**`; update SPEC §9 grammar + the digest tests.
- [ ] **Skill:** update `references/authoring.md` to teach `wp:rationale` — when an
  agent pre-checks an option it puts its reasoning in `wp:rationale`, and leaves
  `wp:answer` empty for the reviewer.
- [ ] Tests: parser (rationale captured, byte-fidelity, round-trip), digest
  snapshot with Why vs Note, UI defaults-empty.

### Exit criteria
- A choice doc authored with `wp:rationale` shows the reason read-only, an empty
  elaboration box, and a digest that separates Why from Note. All spec invariants
  green. Gates green.

### Verification notes
- Adversarial byte-fidelity probes on the new block (rationale-only doc; rationale
  + answer; no-rationale doc unchanged). Confirm no existing fixture regresses and
  the `waypoint: 1` docs still parse (major version unchanged; 1.1.0 is additive).

---

## Phase 5 — Image attachments on responses (#6)

**Objective:** Paste an image into a focused answer/elaboration field → a
removable thumbnail attachment under the box, persisted and exported (decisions
B-3, B-4). Biggest lift; last so it builds on the settled review view.

### Tasks
- [ ] **Schema:** `attachments` table (B-3) + migration (raw-SQL for any FTS-free
  additions is unnecessary here; a normal drizzle migration). Bytes in
  `WAYPOINT_DATA_DIR/attachments/<id>`.
- [ ] **API (auth-covered):** `POST /api/items/:id/attachments` (multipart, image
  MIME allowlist, 10 MB cap) → `{id, filename, mime}`; `GET /api/attachments/:id`
  (streams bytes for the thumbnail); `DELETE /api/attachments/:id`. Include
  attachments in `GET /api/documents/:id` item payloads.
- [ ] **Paste UI:** on the answer/elaboration textarea, a `paste` handler detects
  image items in the clipboard, uploads them, and renders a **removable thumbnail
  chip row under the box** (not inline in the text). Chips show the image and an
  × to delete. Non-image pastes fall through to normal text paste.
- [ ] **Export (B-4):** `applyReview` stays untouched. The export/pull layer
  materializes a document's attachments into `<name>.attachments/` and appends a
  reference line inside each relevant `wp:answer` interior; the digest gains an
  `**Attachments:**` field listing relative paths. `waypoint pull` writes the
  attachments folder beside the review file. A no-attachment doc still exports
  byte-identically.
- [ ] **Degradation:** attachments need no API key; they work whenever the app
  runs. (Independent of the AI capability gate.)
- [ ] Tests: upload/mime-reject/size-cap; thumbnail fetch; delete; paste handler
  extracts an image blob and ignores text; export materializes files + digest
  field; **byte-fidelity: a doc with attachments still yields `applyReview(raw,
  {}) === raw` for the body**, attachments being additive.

### Exit criteria
- Focus an elaboration field, paste a screenshot, see a removable thumbnail;
  export/pull writes the image into `<name>.attachments/` and references it; the
  digest lists it. Spec invariants + gates green.

### Verification notes
- The trust/size boundary: reject non-image and oversize uploads server-side.
  Confirm attachments never enter the splice writer's body paths (the invariant
  is the guard). Confirm delete removes both the row and the bytes. Browser-only:
  the actual clipboard-paste event → thumbnail is a manual/e2e check; cover the
  upload/render/delete logic in unit + API tests and list the paste gesture for
  the smoke.

---

## Deferred / notes
- File-path **type-ahead** autocomplete (#4 alternative) — needs a filesystem
  endpoint + allowlist; revisit if the picker/prompt proves clumsy.
- Image paste **into the AI chat** as vision context (the original #6 reading) is
  a separate feature from response attachments; not built here.
