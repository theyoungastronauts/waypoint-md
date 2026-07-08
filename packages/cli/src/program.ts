import { Command } from "commander";

import { resolveConfig, type ConfigFlags } from "./config";
import { consoleIo, type IO } from "./io";
import type { CommandDeps } from "./commands/push";
import { runInit } from "./commands/init";
import { runPush } from "./commands/push";
import { runStatus } from "./commands/status";
import { runPull } from "./commands/pull";
import { runOpen } from "./commands/open";
import { runConfigGet, runConfigSet } from "./commands/config";

/** Build resolved command deps from the shared `--url` / `--project` options. */
function deps(flags: ConfigFlags, io: IO): CommandDeps {
  return { config: resolveConfig(flags), io };
}

interface CommonOpts {
  url?: string;
  project?: string;
}

/**
 * Build the root `waypoint` command with every subcommand wired (§12). Command
 * bodies live in `./commands`; this file only maps CLI options to them, so the
 * logic stays unit-testable without commander.
 */
export function createProgram(version: string, io: IO = consoleIo): Command {
  const program = new Command();

  program
    .name("waypoint")
    .description("Push and pull agent-generated markdown reviews to a Waypoint server.")
    .version(version, "-v, --version", "output the current version");

  program
    .command("init")
    .description("Write .waypoint.json and ignore the pointer dir")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "default project name")
    .option("--no-gitignore", "do not touch .gitignore")
    .option("--force", "overwrite an existing .waypoint.json")
    .action((opts: { url?: string; project?: string; gitignore?: boolean; force?: boolean }) => {
      runInit(
        { url: opts.url, project: opts.project, noGitignore: opts.gitignore === false, force: opts.force },
        io,
      );
    });

  program
    .command("push")
    .description("Push a markdown file for review")
    .argument("[file]", "path to the markdown file")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "project name")
    .option("-t, --title <title>", "document title")
    .option("--flush", "retry any queued (offline) pushes")
    .action(async (file: string | undefined, opts: CommonOpts & { title?: string; flush?: boolean }) => {
      await runPush(file, { title: opts.title, flush: opts.flush }, deps(opts, io));
    });

  program
    .command("status")
    .description("List this project's documents and their review states")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "project name")
    .action(async (opts: CommonOpts) => {
      await runStatus(deps(opts, io));
    });

  program
    .command("pull")
    .description("Fetch an annotated review beside its source and mark it pulled")
    .argument("[id]", "document id to pull")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "project name")
    .option("--latest", "pull the most recent document for this project")
    .option("--digest", "also write the compact digest (<name>.digest.md)")
    .action(async (id: string | undefined, opts: CommonOpts & { latest?: boolean; digest?: boolean }) => {
      await runPull(id, { latest: opts.latest, digest: opts.digest }, deps(opts, io));
    });

  program
    .command("open")
    .description("Open a document's review URL in a browser")
    .argument("[id]", "document id to open")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "project name")
    .action(async (id: string | undefined, opts: CommonOpts) => {
      await runOpen(id, deps(opts, io));
    });

  const config = program.command("config").description("Get or set CLI configuration");
  config
    .command("get")
    .description("Print resolved configuration")
    .argument("[key]", "url | token | project | publicUrl")
    .action((key: string | undefined) => runConfigGet(key, io));
  config
    .command("set")
    .description("Set a config value in ~/.waypoint/config.json")
    .argument("<key>", "url | token | project | publicUrl")
    .argument("<value>", "the value to store")
    .action((key: string, value: string) => runConfigSet(key, value, io));

  return program;
}
