import { CliError, type IO } from "../io";
import { installSkill } from "../skill";

export interface SkillInstallOptions {
  /** Install to `~/.claude/skills/` instead of the project-local `.claude/skills/`. */
  global?: boolean;
}

/**
 * `waypoint skill install [--global]`: install the bundled Claude Code skill
 * (§13) without touching project config — the standalone counterpart to the
 * install `waypoint init` performs. Useful for putting the skill in
 * `~/.claude/skills/` once, so `/waypoint` exists in every project, without
 * initializing the current directory as a Waypoint project.
 *
 * Unlike init's best-effort step, a failed install here is a hard error —
 * installing the skill is the command's entire job.
 */
export function runSkillInstall(options: SkillInstallOptions, io: IO, cwd: string = process.cwd()): void {
  const result = installSkill({ global: options.global ?? false, cwd });
  if (!result.installed) {
    throw new CliError(`Could not install the skill: ${result.reason}.`);
  }
  const where = options.global ? "globally" : "in this project";
  io.log(`Installed the Waypoint skill ${where} at ${result.dest} (use /waypoint in Claude Code).`);
  if (!options.global) {
    io.log("Tip: `waypoint skill install --global` makes it available in every project.");
  }
}
