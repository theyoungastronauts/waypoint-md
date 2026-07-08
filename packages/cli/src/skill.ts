import { cpSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Installing the bundled Claude Code skill (§13). `waypoint init` copies the
 * `skills/waypoint/` folder into a Claude Code skills directory so the review
 * loop (authoring + push/pull) is available to any agent in the repo — the
 * vanilla onboarding path, no Polaris required.
 */

/** Skill directory name; the slash command becomes `/waypoint`. */
export const SKILL_NAME = "waypoint";

/**
 * Locate the bundled skill source. Two layouts, resolved relative to this
 * compiled file (`dist/skill.js` → `..` is the package root):
 *   - published tarball: `<pkgRoot>/skills/waypoint` — copied in at build/pack
 *     time and shipped via the package `files` list, so `npx` installs work;
 *   - monorepo dev/test: `<repoRoot>/skills/waypoint`, two levels up from the
 *     package root (the source of truth).
 * Returns null when neither exists (a broken install) so `init` can degrade to a
 * clear message instead of failing.
 */
export function skillSourceDir(): string | null {
  const pkgRoot = path.resolve(__dirname, "..");
  const candidates = [
    path.join(pkgRoot, "skills", SKILL_NAME),
    path.join(pkgRoot, "..", "..", "skills", SKILL_NAME),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "SKILL.md"))) ?? null;
}

export interface SkillInstallResult {
  installed: boolean;
  /** Absolute destination the skill was (or would be) written to. */
  dest: string;
  /** When `installed` is false, why. */
  reason?: string;
}

/**
 * Install the bundled Waypoint skill into a Claude Code skills directory:
 *   - project-local (default): `<cwd>/.claude/skills/waypoint/`
 *   - global (`global: true`): `~/.claude/skills/waypoint/`
 * Overwrites the destination folder so a re-run picks up an updated skill. `~`
 * resolves via `os.homedir()` (honors `$HOME`), so tests can redirect it.
 */
export function installSkill(opts: { global?: boolean; cwd?: string } = {}): SkillInstallResult {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.global
    ? path.join(os.homedir(), ".claude", "skills")
    : path.join(cwd, ".claude", "skills");
  const dest = path.join(base, SKILL_NAME);

  const src = skillSourceDir();
  if (!src) {
    return { installed: false, dest, reason: "bundled skill files were not found in this install" };
  }
  mkdirSync(base, { recursive: true });
  cpSync(src, dest, { recursive: true });
  return { installed: true, dest };
}
