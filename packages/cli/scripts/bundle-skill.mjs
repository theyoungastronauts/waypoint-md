#!/usr/bin/env node
// Copy the repo-root `skills/` tree into this package so `waypoint init` can
// install it from a published tarball and `npm publish` ships it (see the
// `files` list in package.json). The source of truth is `<repoRoot>/skills`;
// this copy under `packages/cli/skills` is a build artifact (gitignored) and is
// regenerated on every build and pack.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const src = join(pkgRoot, "..", "..", "skills");
const dest = join(pkgRoot, "skills");

if (!existsSync(src)) {
  console.error(`bundle-skill: source not found at ${src}`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`bundle-skill: copied ${src} -> ${dest}`);
