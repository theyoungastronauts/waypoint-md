import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_URL, loadProjectConfig, saveProjectConfig, type ProjectConfig } from "../config";
import { POINTER_DIR, PROJECT_CONFIG_FILE } from "../paths";
import { CliError, type IO } from "../io";
import { installSkill } from "../skill";

export interface InitOptions {
  url?: string;
  project?: string;
  /** Skip the `.gitignore` update. */
  noGitignore?: boolean;
  /** Overwrite an existing `.waypoint.json`. */
  force?: boolean;
  /** Install the skill globally (`~/.claude/skills/`) instead of project-local. */
  global?: boolean;
  /** Skip installing the Claude Code skill. */
  noSkill?: boolean;
}

/**
 * `waypoint init` (§12): write a project-local `.waypoint.json` (server URL,
 * project, defaults — never a token), add the `.waypoint/` pointer dir to
 * `.gitignore`, and install the Claude Code skill (§13). Runs at the current
 * directory.
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

  if (!options.noSkill) {
    installSkillStep(options.global ?? false, cwd, io);
  }
}

/** Install the bundled Waypoint skill (§13); a failure is a warning, not fatal. */
function installSkillStep(global: boolean, cwd: string, io: IO): void {
  const result = installSkill({ global, cwd });
  if (result.installed) {
    const where = global ? "globally" : "in this project";
    io.log(`Installed the Waypoint skill ${where} at ${result.dest} (use /waypoint in Claude Code).`);
  } else {
    io.warn(`Skipped skill install: ${result.reason}. Re-run after installing waypoint-md, or pass --no-skill.`);
  }
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
