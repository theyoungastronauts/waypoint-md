import { Command } from "commander";

import { resolveConfig, type ConfigFlags } from "./config";
import { CliError, consoleIo, type IO } from "./io";
import type { CommandDeps } from "./commands/push";
import { runInit } from "./commands/init";
import { runPush } from "./commands/push";
import { runPublish, runBackfill } from "./commands/publish";
import { runStatus } from "./commands/status";
import { runLinks } from "./commands/links";
import { runResolve } from "./commands/resolve";
import { runPull } from "./commands/pull";
import { runOpen } from "./commands/open";
import { runConfigGet, runConfigSet } from "./commands/config";
import { runSkillInstall } from "./commands/skill";

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
    .description("Write .waypoint.json, ignore the pointer dir, and install the skill")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "default project name")
    .option("--no-gitignore", "do not touch .gitignore")
    .option("--force", "overwrite an existing .waypoint.json")
    .option("--global", "install the skill globally (~/.claude/skills) instead of project-local")
    .option("--no-skill", "do not install the Claude Code skill")
    .action(
      (opts: {
        url?: string;
        project?: string;
        gitignore?: boolean;
        force?: boolean;
        global?: boolean;
        skill?: boolean;
      }) => {
        runInit(
          {
            url: opts.url,
            project: opts.project,
            noGitignore: opts.gitignore === false,
            force: opts.force,
            global: opts.global,
            noSkill: opts.skill === false,
          },
          io,
        );
      },
    );

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
    .command("publish")
    .description("Publish a markdown file (rendered to HTML + PDF) or a media file to R2")
    .argument("[file]", "path to the markdown, video, image, or PDF file")
    .option("-u, --url <url>", "server URL")
    .option("-t, --title <title>", "document title")
    .option("-g, --group <group>", "media: the material slug a version stack shares")
    .option("-l, --label <label>", "media: the version label within the group (v1, draft, …)")
    .option("--manifest <path>", "media: render manifest JSON (default: <file>.manifest.json)")
    .option("--json", "print the result as one JSON object and nothing else on stdout")
    .option("--backfill", "index existing R2 objects into the registry instead of publishing")
    .action(
      async (
        file: string | undefined,
        opts: CommonOpts & {
          title?: string;
          group?: string;
          label?: string;
          manifest?: string;
          json?: boolean;
          backfill?: boolean;
        },
      ) => {
        if (opts.backfill) {
          await runBackfill(deps(opts, io));
          return;
        }
        if (!file) {
          throw new CliError("Nothing to publish. Provide a <file>, or use --backfill.");
        }
        await runPublish(
          file,
          {
            title: opts.title,
            group: opts.group,
            label: opts.label,
            manifest: opts.manifest,
            json: opts.json,
          },
          deps(opts, io),
        );
      },
    );

  program
    .command("status")
    .description("List this project's documents and their review states")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "project name")
    .option("--publications", "list publications and their open review notes instead")
    .action(async (opts: CommonOpts & { publications?: boolean }) => {
      await runStatus(deps(opts, io), { publications: opts.publications });
    });

  program
    .command("pull")
    .description("Fetch an annotated review beside its source and mark it pulled")
    .argument("[id]", "document id, or a publication id with --digest")
    .option("-u, --url <url>", "server URL")
    .option("-p, --project <project>", "project name")
    .option("--latest", "pull the most recent document for this project")
    .option("--digest", "also write the compact digest (<name>.digest.md)")
    .action(async (id: string | undefined, opts: CommonOpts & { latest?: boolean; digest?: boolean }) => {
      await runPull(id, { latest: opts.latest, digest: opts.digest }, deps(opts, io));
    });

  program
    .command("links")
    .description("Create, list, or revoke per-reviewer links for a media publication")
    .argument("<publication-id>", "publication id")
    .option("-u, --url <url>", "server URL")
    .option("--add <name>", "mint a link bound to this reviewer's name")
    .option("--revoke <linkId>", "revoke this link id")
    .action(
      async (publicationId: string, opts: CommonOpts & { add?: string; revoke?: string }) => {
        await runLinks(publicationId, { add: opts.add, revoke: opts.revoke }, deps(opts, io));
      },
    );

  program
    .command("resolve")
    .description("Mark a review note on a media publication as acted on")
    .argument("<publication-id>", "publication id")
    .argument("<comment>", "the note's digest number (c1) or its id")
    .option("-u, --url <url>", "server URL")
    .action(async (publicationId: string, comment: string, opts: CommonOpts) => {
      await runResolve(publicationId, comment, deps(opts, io));
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

  const skill = program.command("skill").description("Manage the bundled Claude Code skill");
  skill
    .command("install")
    .description("Install the /waypoint skill (project-local by default) without initializing a project")
    .option("--global", "install to ~/.claude/skills instead of ./.claude/skills")
    .action((opts: { global?: boolean }) => runSkillInstall({ global: opts.global }, io));

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
