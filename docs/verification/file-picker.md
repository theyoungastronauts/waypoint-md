# Server-side file picker (home-scoped) for "Add file/folder" — Verification

**Verdict: PASS** — no containment probe let a path escape home. Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write). This is the full review after the folder-select + rename change (the first review was cut off by a session limit).

## Gates

The 3 test files under review pass (23 tests); web typecheck clean; eslint clean on all source files. Reviewer authored 18 adversarial probes against a real temp-fs fixture (actual symlinks/fifo/sibling-dir, `os.homedir` stubbed) — all 18 passed, then removed.

## Containment (lib/fs/list-dir.ts) — all secure

- Order is **realpath → isWithin → statSync**, provably. Browsing a symlink whose target is a file outside home returns 403 `path_not_allowed`, not a type error — type is never revealed before the escape check.
- `isWithin` is segment-aware: home basename `tyler` does NOT admit `tyler-evil` (via both `~/../tyler-evil` and an absolute sibling path → 403).
- Every escape vector 403s: `../`, `../../outside`, `~/../../outside`, absolute out-of-home, encoded `..%2f` (URL layer decodes then rejects). Embedded NUL → 400 `invalid_path` (checked before any fs call).
- Symlink inside home → outside home: browsing it → 403; as a listing entry → omitted (verified for dir-target and file-target). Symlink inside home → inside home: listed with correct type; browsing through it stays contained.
- Broken symlinks, fifos, and dotfiles dropped from the default listing; dotfiles only with `?all=1`; fifo/broken never.
- Entry `path` and `cwd` are always the server-built `~/…` form — no resolved absolute base path leaks to the client.

## Auth

`/api/fs/list` absent from OPEN_PATHS, covered by the middleware matcher — 401 without token, passes with bearer.

## Folder-select surface (attach-file.tsx)

Every inserted value is a server-provided `~/…` string — the check affordance uses `entry.path`, "Use this folder" uses `listing.cwd`, file pick uses `entry.path`. No client-built path can bypass containment (the picker never reads files; `onInsert` just splices text at the caret). Folder-name click navigates, check selects without navigating, manual "type a path instead" fallback preserved, no regression to the file flow. Entry names/cwd render as escaped React text nodes — a crafted filename can't XSS.

## Informational (non-blocking, NOT escapes)

1. **Existence oracle:** an authenticated caller can distinguish "exists but outside home" (403) from "does not exist" (404) for arbitrary absolute paths — reveals path existence (never contents). Inherent to the secure realpath-before-containment ordering; mirrors `lib/ingest/path-door.ts` exactly; behind auth. Acceptable and consistent with the ratified model. If ever tightened, collapse 404/403 into one response for out-of-home paths.
2. **TOCTOU:** statSync/readdirSync run on the resolved real path; a component could in principle be swapped for a symlink after realpath resolves. Requires a local FS write racing the request — same surface as path-door, and the app is self-hosted. Not a blocker.
