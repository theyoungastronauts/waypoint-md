# Releasing Waypoint

Publishing is a deliberate manual step. This repository is configured so it can
**never publish by accident**: the CLI package (`packages/cli`, npm name
`waypoint-md`) is `private: true`, and the release workflow only runs on a pushed
tag and only publishes when an `NPM_TOKEN` secret is present. Nothing is published
by CI on a push to `main`.

## What gets published

Only the CLI, **`waypoint-md`** (binary: `waypoint`). The web app is self-hosted
(Docker or the standalone build), not an npm package. The `@waypoint/spec` and
`@waypoint/web` packages stay `private: true`.

The published tarball ships:
- `dist/` — the compiled CLI.
- `skills/` — the bundled Claude Code skill (copied from the repo-root
  `skills/` at build/pack time by `packages/cli/scripts/bundle-skill.mjs`), so
  `waypoint init` can install it from an `npx` install.

## The tag contract

A release is a git tag `vX.Y.Z`. The tag is also the stable coordinate skill
consumers (Polaris, or anyone) pin to: `skills/waypoint/` at `vX.Y.Z` ships the
skill and references matching the SPEC version of that release. Keep the tag,
the CLI `version`, and the declared `SPEC_VERSION` consistent for a release.

## Manual release steps

1. **Green gates.** From the repo root on the release commit:
   ```bash
   pnpm install
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```
   Optionally run the e2e smoke: `pnpm test:e2e`.

2. **Bump versions.** Set the release version in `packages/cli/package.json`
   (`version`). If the convention changed, bump `SPEC_VERSION` in
   `packages/spec` and the stamp in `docs/SPEC.md` accordingly.

3. **Flip the publish guard.** In `packages/cli/package.json`, change
   `"private": true` to `"private": false`. This is the one deliberate edit that
   makes the package publishable; it is intentionally not committed in normal
   development. (Remove the `"//private"` note line at the same time.)

4. **Set the npm token.** Add an npm automation token as the `NPM_TOKEN` secret in
   the GitHub repository settings (Settings → Secrets and variables → Actions).
   The workflow reads it as `NODE_AUTH_TOKEN`; without it, the publish step is
   skipped.

5. **Tag and push.**
   ```bash
   git commit -am "release: waypoint-md vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```
   The tag push triggers `.github/workflows/release.yml`: it re-runs the gates,
   builds, and — only if `NPM_TOKEN` is set — runs `npm publish` for
   `waypoint-md`.

### Publishing locally instead of via CI

If you prefer to publish from your machine (no GitHub remote required):

```bash
cd packages/cli
# after steps 2–3 above
npm publish --access public   # prepack re-bundles the skill automatically
```

## After releasing

- Revert `packages/cli/package.json` back to `"private": true` on `main` so the
  next accidental publish is again impossible, unless you intend to keep cutting
  releases from `main`.
- Verify the tag renders the skill at `skills/waypoint/` for consumers pinning to
  it.
