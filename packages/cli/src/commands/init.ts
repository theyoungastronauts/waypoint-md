import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_URL, loadProjectConfig, saveProjectConfig, type ProjectConfig } from "../config";
import { POINTER_DIR, PROJECT_CONFIG_FILE } from "../paths";
import { CliError, type IO } from "../io";

export interface InitOptions {
  url?: string;
  project?: string;
  /** Skip the `.gitignore` update. */
  noGitignore?: boolean;
  /** Overwrite an existing `.waypoint.json`. */
  force?: boolean;
}

/**
 * `waypoint init` (§12): write a project-local `.waypoint.json` (server URL,
 * project, defaults — never a token) and add the `.waypoint/` pointer dir to
 * `.gitignore`. Runs at the current directory.
 *
 * Skill installation is intentionally NOT done here — it lands in Phase 10, once
 * the skill artifact exists (see the marked seam below). `init` must not claim to
 * install a skill.
 */
export function runInit(options: InitOptions, io: IO, cwd: string = process.cwd()): void {
  const configPath = path.join(cwd, PROJECT_CONFIG_FILE);
  if (existsSync(configPath) && !options.force) {
    throw new CliError(
      `${PROJECT_CONFIG_FILE} already exists. Re-run with --force to overwrite, or edit it directly.`,
    );
  }

  const existing = options.force ? {} : loadProjectConfig(cwd);
  const config: ProjectConfig = {
    url: options.url ?? existing.url ?? DEFAULT_URL,
  };
  if (options.project ?? existing.project) config.project = options.project ?? existing.project;
  saveProjectConfig(cwd, config);
  io.log(`Wrote ${PROJECT_CONFIG_FILE} (server ${config.url}${config.project ? `, project ${config.project}` : ""}).`);
  io.log("Set your token out-of-band: `waypoint config set token <token>` or export WAYPOINT_TOKEN.");

  if (!options.noGitignore) {
    updateGitignore(cwd, io);
  }

  // --- Phase 10 seam: skill installation ---------------------------------
  // `waypoint init` will also install the Claude Code skill into
  // `.claude/skills/waypoint/` (or `~/.claude/skills/` with --global) once the
  // skill artifact exists (§13). Deliberately deferred; do not announce a skill
  // install until this is implemented.
  // -----------------------------------------------------------------------
}

/** Idempotently add `.waypoint/` to `.gitignore` at `cwd`. */
function updateGitignore(cwd: string, io: IO): void {
  const gitignorePath = path.join(cwd, ".gitignore");
  const entry = `${POINTER_DIR}/`;
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";

  const alreadyIgnored = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === entry || line === POINTER_DIR);
  if (alreadyIgnored) {
    io.log(`.gitignore already ignores ${entry}.`);
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, `${existing}${prefix}${entry}\n`, "utf8");
  io.log(`Added ${entry} to .gitignore.`);
}
