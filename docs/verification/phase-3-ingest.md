# Phase 3 — Ingest doors, queue, read-only doc view (P2a) — Verification

**Verdict:** PASS WITH WARNINGS
**Reviewer:** reviewer agent (fresh session, Node v20.19.5)
**Date:** 2026-07-07
**Scope reviewed:** uncommitted working tree (`apps/web/lib/ingest/*`, `apps/web/lib/render/*`, `apps/web/lib/documents.ts`, `apps/web/lib/projects.ts`, `apps/web/lib/format.ts`, `apps/web/lib/api/http.ts`, `apps/web/app/api/documents/*`, `apps/web/app/api/projects/*`, `apps/web/app/{new,d/[id]}/*`, `apps/web/components/{new,queue,document}/*`) against `plan.md` Phase 3 (tasks, exit criteria, verification notes), the "#1 non-negotiable", "Ratified decisions", and design refs `initial-plan.md` §6, §7, §8, §9, §15.

Nothing was committed or staged (per run rules). All probe artifacts and both test servers were torn down; the repo working tree contains only the Phase 3 implementation files.

> **Summary:** Every Phase 3 verification note passed hands-on against a running server. The security posture of the two dangerous doors (path, URL) is strong and was proven live with adversarial inputs, not just unit mocks. The WARNINGS are one accepted-risk item (DNS-rebinding TOCTOU) that the executor called out and I confirmed proportionate, plus small forward-handoff notes for Phase 4. No blockers.

---

## Standing gates (Node 20 shell) — all green

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass (3 workspaces) |
| `pnpm lint` | pass (eslint clean, all workspaces) |
| `pnpm test` | **132 passed / 132** (13 files) |
| `pnpm build` | pass (Next standalone; 8 routes compiled) |

The engines-mismatch warning (`wanted node >=22, current v20.19.5`) prints but never fails — the ratified `engine-strict=false` posture holds. The `next start` vs `output: standalone` advisory warning appears but the server serves correctly; it does not affect verification (Docker/prod uses `node .next/standalone/server.js`).

**#1 non-negotiable (byte-fidelity + round-trip):** spec suite still green — `invariants.test.ts` 42, `apply.test.ts` 17, `parse.test.ts` 16. Phase 3 touches ingest but stores `raw_md` verbatim and never calls `applyReview`, so the invariant is untouched. Re-confirmed live (see Byte-fidelity below).

---

## Hands-on verification (against a running server)

Two server runs were used: **run B** with `WAYPOINT_ALLOWED_ROOTS` set to a scratch dir (path-enabled + URL + XSS + queue), **run A** with it unset (path-disabled). Data dir was an isolated scratch path; no repo state was written.

### 1. Path door (§15) — arbitrary-file-read is prevented

Roots **set** to a scratch `allowed/` dir containing `plan.md` and a symlink `escape.md → ../outside/secret.md`:

| Probe | Result |
|---|---|
| `{path:"/etc/passwd"}` | **403 `path_not_allowed`** |
| `{path:"<allowed>/../../../../etc/hosts"}` (traversal) | **403 `path_not_allowed`** |
| `{path:"<allowed>/../outside/secret.md"}` | **403 `path_not_allowed`** |
| `{path:"<allowed>/escape.md"}` (symlink escaping the root) | **403 `path_not_allowed`** |
| `{path:"<allowed>/%2e%2e/..."}` (URL-encoded dots) | 404 `file_not_found` (not decoded — treated as a literal dir name; safe) |
| `{path:"<allowed>/plan.md\x00.png"}` (null byte) | **400 `invalid_path`** |
| `{path:"<allowed>/plan.md"}` (legit) | 201 |

Containment is checked against the **realpath** (after symlink + `..` resolution) with a path-separator-aware prefix test (`isWithin`), so both traversal and in-root-symlink-pointing-out are caught. `hasAllowedExtension` and the size cap are also enforced on the resolved path. Roots **unset** (run A): `{path:"/etc/passwd"}` → **403 `path_door_disabled`** with no resolution attempted, and `/new` disables the Path tab with an explanation. This door does not become an arbitrary-file-read under any input I tried.

### 2. URL door (§15) — SSRF hygiene is strong, proven with real network

| Probe | Result |
|---|---|
| >1 MB real `text/plain` body (`norvig.com/big.txt`, ~6 MB) | **413 `response_too_large`** (streaming cap; also honors a lying/short `content-length`) |
| Real non-text body (a `.png`, `image/png`) | **415 `unsupported_content_type`** |
| Public raw markdown happy path (`raw.githubusercontent.com`) | 201, bytes preserved |
| Literal loopback / `0.0.0.0` / `[::1]` / `[::ffff:127.0.0.1]` | **403 `blocked_address`** |
| Cloud metadata `169.254.169.254`, RFC1918 `10/192.168`, CGNAT `100.64` | **403 `blocked_address`** |
| Numeric-encoding bypasses: `http://2130706433/`, `0x7f000001`, `0177.0.0.1`, `127.1` | **all 403 `blocked_address`** |
| Real public DNS name resolving to a private IP (`127.0.0.1.nip.io`, `192.168.0.1.nip.io`) | **403 `blocked_address`** |
| **Real redirect chain to a private IP** (`httpbin.org/redirect-to?url=http://169.254.169.254/`) | **403 `blocked_address`** |
| Real redirect to a DNS-name-resolving-private (`…redirect-to?url=http://127.0.0.1.nip.io/`) | **403 `blocked_address`** |
| `file://`, `gopher://` | **400 `unsupported_protocol`** |

The IPv4/IPv6 classifier (`isPrivateIp`) is comprehensive: RFC1918, loopback, link-local, CGNAT, benchmarking, multicast/reserved, ULA `fc00::/7`, `fe80::/10`, and **IPv4-mapped IPv6** (`::ffff:a.b.c.d` is decoded and re-checked as IPv4). The numeric-encoding cases pass because non-literal hosts go through `dns.lookup`, which normalizes them to `127.0.0.1`, and every resolved address is checked. **Per-hop revalidation is genuine** — I confirmed it against a live redirector, not just the mocked unit test: a 200-response public URL that 302-redirects to a metadata IP is rejected on the second hop before the request is made. (See WARN-1 for the one residual gap.)

### 3. Byte-fidelity (§6 invariant) — confirmed live

Pasted `crlf.md` (exercises CRLF preservation) and `kitchen-sink.md` via the API, then read `raw_md` back via `GET /api/documents/:id`:

- `crlf.md`: input sha256 == stored sha256, and CRLF sequences survive in storage (no newline normalization).
- `kitchen-sink.md`: input sha256 == stored sha256; 3 items parsed and persisted.

### 4. Supersede semantics (§6) — confirmed live via direct DB inspection

Pushed `super.md` through the path door under project `superproj`, changed the file's on-disk bytes to a v2, re-pushed the **same** project + `source_path`, then inspected SQLite read-only:

- Old doc: `status = archived`, `raw_md` still holds the **original v1 bytes** (untouched despite the file changing and the re-push).
- New doc: `status = pending`, `supersedes_id` → old doc's id, `raw_md` = v2.

`raw_md` immutability holds through supersede; the transaction archives the prior live row and links the new one.

### 5. XSS / `rehype-sanitize` (§15) — nothing dangerous reaches the DOM

Ingested a doc packed with vectors in prose, a `wp:` prompt, a draft answer, and a choice-option label, then fetched the rendered `/d/[id]` page and scanned strictly within the `<article>` element:

- **Zero** surviving `<script>`, `on*` handlers (`onerror`/`onload`/`ontoggle`/`onfocus`), `javascript:`/`vbscript:`/`data:` URIs, `<iframe>`/`<object>`/`<embed>`/`<svg>`/`<form>`, `style=` attributes, or `autofocus`.
- `<img onerror>` → `<img src="x">` (handler dropped); `javascript:`/`data:`/`vbscript:`/entity-encoded links → bare `<a>` with the href removed; styled div → `<div>` with no style; the hostile `<form><input onfocus autofocus>` → a benign `<input disabled type="checkbox">`.
- Sanitization is applied identically in prose segments, `wp:` question prompts, draft-answer bodies, and choice-option labels (every `dangerouslySetInnerHTML` site funnels through `renderMarkdownToSafeHtml`).

Pipeline order is correct — `remark-rehype {allowDangerousHtml}` → `rehype-raw` → `rehype-sanitize` — so embedded HTML is parsed into real nodes and then stripped, rather than passed through opaque. The schema (`structuredClone(defaultSchema)`) is the single shared allowlist, cloned so later phases extend it without mutating the library default.

### 6. Queue filters + warnings (§8, §9, §7) — work from the browser-facing pages

- Archived docs are **hidden** from the default queue (API and `/` page); `?status=archived` surfaces them explicitly; `?status=pending|completed` filter correctly; `?project=<id>` filters and joins the project name.
- The `/` page renders the status filter chips, per-project chips, status dots, titles, source badges, and relative times; a superseded doc is marked "revised".
- Ingesting `malformed-pairs.md` returns 201 with **3 warnings** (`duplicate-id`, `orphan-answer-close`, `unclosed-question`) in the API response, and the `/d/[id]` page renders the amber **"3 parse warnings"** banner listing each code + message while still rendering the (degraded) document below. Warnings are surfaced, never fatal.

---

## Executor deviations — judged on the merits

1. **New internal `archived` status (outside the §6 four-value vocabulary).** *Sound.* §6 explicitly says the superseded doc "auto-archives"; the vocabulary list just didn't enumerate the resulting state. Storing it in the existing free-text `status` column (vs. a separate flag) is the minimal choice, and it's handled consistently everywhere (`DOCUMENT_STATUSES`, the PATCH zod enum, `statusMeta`, and the default queue exclusion). See WARN-2 for two small blemishes.

2. **DNS-rebinding TOCTOU left unmitigated.** *Accept as a documented risk* for a Tailscale-fronted single-user tool — but it is a real gap, recorded as WARN-1. Redirects **are** re-validated per hop (proven live), which closes the most common open-redirect SSRF path.

3. **`text/*` strictness (rejects `application/octet-stream` / `application/markdown` `.md`).** *Spec-compliant* — §15 says "text content-types only." Some hosts serve markdown as `application/octet-stream`; those URL imports will 415. Acceptable for v1; a future ergonomic loosening (allow `application/markdown`, or sniff when the extension is `.md`) is worth noting but out of scope.

4. **1 MB cap extended to all doors (not just URL).** *Sound.* A sane memory bound; does not contradict §15, which only mandated it for URL.

5. **No `dayjs` (hand-rolled `relativeTime`).** *Fine.* One fewer dep; the implementation is correct and guards `NaN`.

6. **No `lib/api.ts` client yet (server components read the DB directly).** *Fine for Phase 3.* The read pages are server components; the only client fetch is the import form POST. §9's TanStack Query client is a Phase 4 task.

7. **Parsed draft answers / pre-authored comments NOT seeded into `responses`/`comments` (they stay in `raw_md`, surfaced by the renderer).** *Sound — and it actively protects the #1 invariant.* Seeding drafts into `responses` would make an untouched doc's review state non-empty, so `applyReview` would stamp frontmatter and rewrite answer interiors, **breaking** Phase 4's "untouched-doc export is byte-identical" guarantee. Keeping drafts in `raw_md` and reading `item.response` from the parse (as `InertItemCard` does) is the correct posture. **Phase 4 handoff (WARN-3):** the interactive `QuestionCard`/`ChoiceGroup` must source its *initial* value from the parsed `item.response` (falling back from an absent DB `responses` row), or §5.2 pre-filled drafts will render as empty fields.

---

## Render pipeline — is it a genuine Phase 4 seam? Yes.

- **Segmentation module (`lib/render/document.ts`).** `renderDocument()` walks the parsed items in block-offset order and emits an ordered list of `ProseSegment` (pre-rendered sanitized HTML) and `ItemSegment` (the parsed `Item`). Phase 4 swaps the item renderer (`InertItemCard` → live cards) at exactly one place (`DocumentView`) without touching the walk. This cleanly separates "what/where the pieces are" from "how each is drawn" — the stated seam requirement is met.
- **Shared sanitize schema (`lib/render/schema.ts`).** A single cloned `defaultSchema` object with an explicit comment that Phase 4 interactive nodes and Phase 6 highlights extend it here. Correct extension point.
- **Frozen pipeline (`lib/render/pipeline.ts`).** Compiled once; stays the renderer for surrounding prose.

**Caveat (not a blocker):** the mechanism differs from §9's literal wording ("a custom remark plugin lifts `wp:` blocks into custom mdast nodes"). This implementation instead **slices `raw_md` at item byte offsets and renders each prose run as an independent markdown document.** For Phase 4's scope (interactive cards in place, prose stays prose) this is equivalent and simpler. The one behavioral consequence: a markdown construct that *spans* an item boundary won't resolve across it — most notably a reference-link/image **definition** (`[ref]: url`) in one prose run used by text in another, or a list/blockquote split by an interleaved `wp:` block. `wp:` blocks are normally top-level and blank-line-separated, so this is an edge case, but if Phase 4 (or a fixture) needs cross-boundary references it would require moving to the single-tree remark-plugin approach. Flagged for Phase 4 awareness; no action needed now.

---

## Findings

### WARN-1 — URL door DNS-rebinding TOCTOU (accepted risk, executor-disclosed)
`assertPublicHost()` resolves the hostname and rejects private results, then `fetch(currentUrl)` performs its **own** independent DNS resolution. A rebinding attacker who answers "public" to the first lookup and "private" to fetch's lookup can still reach an internal address. Per-hop redirect revalidation is present (and proven), but the check-then-fetch gap on each single hop remains.
- **File:** `apps/web/lib/ingest/url-door.ts:195` (check) vs `:201` (fetch).
- **Severity:** Low under the stated threat model (single-user, Tailscale-fronted, no untrusted tenants). The attacker must control DNS for a name a user pastes.
- **Disposition:** Accept for v1, as the executor proposed. If the threat model ever widens, the fix is to resolve once and connect by the vetted IP (custom `lookup`/agent, or fetch the literal IP with a `Host:` header), re-checking on each hop.

### WARN-2 — `archived` status: two small blemishes
- **PATCH can set `archived` directly.** `DOCUMENT_STATUSES` includes `archived`, and `PATCH /api/documents/:id` validates `status` against that same enum, so a client can manually move a doc to/from `archived` — a state meant to be reached only automatically via supersede. Harmless in a single-user tool, but it's a semantic leak; consider excluding `archived` from the externally-PATCHable set.
  - **File:** `apps/web/app/api/documents/[id]/route.ts:33` (uses `z.enum(DOCUMENT_STATUSES)`).
- **Stale schema comment.** `apps/web/lib/db/schema.ts:37` still documents the status column as `pending | in_review | completed | pulled`, omitting `archived`. Doc-only; update for accuracy.

### SUGGEST-1 — `getDocumentDetail` loads the entire `responses` table
`db.select().from(responses).all()` fetches every response across all documents into a Map on each doc-detail read, rather than scoping to the current document's item ids. No effect in Phase 3 (responses is empty) and negligible for a personal tool, but it will do unnecessary work as review activity grows. Scope it to the doc's items when Phase 4 starts writing responses.
- **File:** `apps/web/lib/documents.ts:267-271`.

### SUGGEST-2 — URL-door ergonomics (see deviation #3)
Consider accepting `application/markdown` (and optionally sniffing on a `.md`-looking final path) so common raw hosts that mislabel markdown aren't rejected. Out of scope for Phase 3; note for later.

---

## Exit criteria (plan.md Phase 3) — met

- [x] Import via each of the four doors; each lands `pending` in the queue. (upload/paste/path/url all exercised — path + url live, upload/paste via API + unit tests.)
- [x] Opening a doc renders readable prose including question prompts (inert cards). 
- [x] Warnings from a malformed doc are visible, not fatal.
- [x] Path door provably disabled when `WAYPOINT_ALLOWED_ROOTS` is unset (live 403 `path_door_disabled`).
- [x] Standing gates pass; Phase 2 invariants still green.

**Verdict: PASS WITH WARNINGS.** Phase 3 is functionally complete and its security-critical doors are hardened well beyond the minimum. The two dangerous doors resist every traversal/symlink/SSRF/encoding bypass I threw at them live, `raw_md` byte-fidelity and supersede semantics hold, and the sanitizer strips every XSS vector before the DOM. The single genuine gap (WARN-1 DNS-rebinding TOCTOU) is a disclosed, proportionate acceptance for the deployment model; the rest are doc/ergonomic polish and forward-handoff notes. No blockers.
