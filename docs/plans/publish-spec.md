---
waypoint: 1
title: "Waypoint publish — Phase A spec"
project: waypoint
---

# Waypoint `publish` — Phase A spec

Waypoint grows a second verb. **`push`** stays what it is: interactive,
revocable, server-backed review. **`publish`** is the opposite contract:
permanent static artifacts — markdown rendered to styled HTML + PDF, uploaded
to Cloudflare R2, served from the bucket forever with Waypoint never in the
serving path. It absorbs the existing `share` CLI from the Smitty repo
(port-and-index, not invention) and adds the genuinely new part: a
**publications registry** — every publish recorded, browsable, and full-text
searchable in the Waypoint UI.

Pipeline behaviors preserved exactly from `share`: first-`#`-heading title
extraction, sanitized filenames, GitHub-style HTML template with the share bar
(Download PDF / View Markdown / theme toggle), clean-bar-free HTML for the PDF
(puppeteer, A4), relative sibling links, objects at
`<prefix>/<uuid>/<name>.{md,html,pdf}`, and the one-command → three-URLs-printed
UX. Existing R2 objects are immutable history — never moved or re-keyed.

## Schema (new migration)

```
publications  id (uuid, pk) · title · sanitized_name · source_md
              r2_folder ("smitty/shares/<uuid>") · public_base (domain at publish time)
              origin (cli|api|backfill) · source_host?
              created_at · revoked_at?
```

`publications_fts` — SQLite FTS5 virtual table over `(title, source_md)`,
content-synced to `publications` by triggers; raw-SQL drizzle migration (the
house pattern). The DB stores source markdown + metadata only — HTML/PDF bytes
live on R2, never duplicated. The three object keys and public URLs derive from
`r2_folder + sanitized_name + public_base`.

## API (all behind the central auth middleware)

| Route | Behavior |
|---|---|
| `POST /api/publications` | `{markdown, filename?, title?}` → render + upload + index → `{id, title, urls{md,html,pdf}}` |
| `GET /api/publications?q=` | list, newest first; `q` = FTS5 search over title+body |
| `GET /api/publications/:id` | full row incl. source markdown |
| `POST /api/publications/:id/revoke` | delete the three R2 objects, stamp `revoked_at` (row stays — the registry remembers) |
| `POST /api/publications/backfill` | list `smitty/shares/` prefix, pull each `.md`, index rows that aren't already present (`created_at` from object LastModified, origin `backfill`). Idempotent, read-only against the bucket. |

**Capability gating mirrors the AI degradation contract:** R2 env vars absent →
publish endpoints return `publish_unavailable`, the CLI verb says so plainly,
and the Publications UI section doesn't render. Env (server-side only, from the
same `.env`/compose mechanics as the Anthropic key): `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`,
`R2_PUBLIC_DOMAIN`.

## CLI

`waypoint publish <file.md> [--title t]` — thin client: POSTs the markdown,
prints the three URLs in the exact `share` output shape. `waypoint publish
--backfill` triggers the backfill endpoint. After cutover (last step of Phase
C): `~/.zshrc` line 179 becomes `alias share="waypoint publish"` — same muscle
memory, same output.

## Implementation notes

- Pipeline port lands as `apps/web/lib/publish/` (template/render/upload),
  server-side. New deps in the web app: `marked`, `puppeteer`,
  `@aws-sdk/client-s3`. The review renderer (unified + rehype-sanitize) is
  untouched — published output keeps byte-level fidelity with today's `share`
  styling, which is why the port keeps `marked` rather than unifying renderers.
- **Containerization flag:** puppeteer needs Chrome on the host. Fine natively
  on the Mini; a future Docker image must add a Chromium layer (~150 MB) or
  swap to `puppeteer-core` + system Chrome. Noted, not solved here.
- Build phases after this sign-off: **B1** pipeline port + endpoint + CLI verb
  + tests · **B2** registry UI + FTS search · **C** backfill run + alias
  cutover + docs. Small commits, standing gates throughout.
- Explicitly out of scope (per brief): respondent/read-only review links,
  ingress/tunnel work, Dockerizing Waypoint, AI auto-tagging of publications
  (v2 hook: the registry row is where tags would hang).

## Decisions to ratify

<!-- wp:question id="q1" type="choice" select="single" -->
**Q1 — R2 key prefix for new publishes.** Old objects never move either way;
this only affects where new publishes land and how many prefixes backfill/list
must scan forever.
- [x] Keep `smitty/shares/` — one namespace, one prefix to list, zero migration surface
- [ ] New neutral prefix `shares/` — cleaner identity, but every listing scans two prefixes forever
<!-- wp:answer -->
Keep the prefix. The name is cosmetic; a second namespace is a real cost.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Where rendering happens.** Server-side keeps puppeteer/Chrome in exactly
one place and lets any HTTP caller publish (Smitty in a container later needs
only a POST).
- [x] Server-side only; the CLI verb is a thin client
- [ ] Server-side + CLI local-render fallback when the server is down
<!-- wp:answer -->
One path. The server is on the same machine; if it's down, `share` today would
be broken too. A fallback doubles the surface for a failure mode that hasn't
happened.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q3" type="choice" select="single" -->
**Q3 — Registry placement in the UI.**
- [x] Separate "Publications" section (own nav link, list + search + detail)
- [ ] Merged into the review queue with a type filter
<!-- wp:answer -->
Different lifecycle (permanent vs pending→pulled), different mental model —
merging would make the queue lie about what it is.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q4" type="choice" select="single" -->
**Q4 — Revocation in v1.** The brief names deleting the R2 objects as the
revocation story. Building it now is one endpoint + three DeleteObject calls +
a button; the registry row survives either way with `revoked_at` stamped.
- [x] Include revoke in v1
- [ ] Defer to v2 — schema column only, delete by hand if ever needed
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q5" type="text" -->
**Q5 — Scope check.** Anything to add or cut before B1 starts? (Schema columns,
API shape, the `--backfill` CLI placement, the marked-vs-unified renderer call,
anything the brief missed.)
<!-- wp:answer -->
Ship it as specced.
<!-- /wp:answer -->
<!-- /wp:question -->
