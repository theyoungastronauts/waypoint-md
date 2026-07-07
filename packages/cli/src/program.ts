import { Command } from "commander";

/**
 * Build the root `waypoint` command. Commands (init/push/status/pull/open/config)
 * land in Phase 5; for now the binary only reports its version.
 */
export function createProgram(version: string): Command {
  const program = new Command();

  program
    .name("waypoint")
    .description("Push and pull agent-generated markdown reviews to a Waypoint server.")
    .version(version, "-v, --version", "output the current version");

  return program;
}
