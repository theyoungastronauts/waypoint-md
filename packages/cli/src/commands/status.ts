import { listDocuments, listPublications, type PublicationSummary } from "../client";
import { handshake } from "../handshake";
import { readPointer } from "../pointer";
import type { CommandDeps } from "./push";

export interface StatusOptions {
  /** List published renders and their open review notes instead of documents. */
  publications?: boolean;
}

/**
 * `waypoint status` (§12): list this project's documents and their review states.
 * The queue endpoint filters by project id, but the CLI only knows the project
 * name, so it fetches the queue and filters client-side by `projectName`. The
 * pending-pull pointer (if any) is flagged.
 *
 * `--publications` switches to the registry (decision C-6): every publication
 * with its kind, group, label, and — for a render — how many review notes are
 * still open, which is the poll half of the v1 notification story (Q7). The
 * default output is untouched, so the skill's pull loop keeps working.
 */
export async function runStatus(deps: CommandDeps, options: StatusOptions = {}): Promise<void> {
  const { config, io } = deps;
  await handshake(config, io);

  if (options.publications) {
    await printPublications(deps);
    return;
  }

  const all = await listDocuments(config);
  const docs = config.project ? all.filter((d) => d.projectName === config.project) : all;

  if (docs.length === 0) {
    io.log(config.project ? `No documents for project "${config.project}".` : "No documents yet.");
    return;
  }

  const pointer = readPointer(config.projectRoot);
  io.log(`${docs.length} document(s)${config.project ? ` in "${config.project}"` : ""}:`);
  for (const d of docs) {
    const pending = pointer && pointer.id === d.id ? " *" : "";
    io.log(`  ${d.id.slice(0, 8)}  ${d.status.padEnd(10)}  ${d.title ?? "(untitled)"}${pending}`);
  }
  if (pointer) {
    io.log(`\n* pending pull — run \`waypoint pull\` to fetch ${pointer.source}`);
  }
}

async function printPublications(deps: CommandDeps): Promise<void> {
  const { config, io } = deps;
  const publications = await listPublications(config);

  if (publications.length === 0) {
    io.log("No publications yet.");
    return;
  }

  io.log(`${publications.length} publication(s):`);
  for (const publication of publications) io.log(`  ${publicationLine(publication)}`);

  const open = publications.reduce((sum, p) => sum + (p.unresolved ?? 0), 0);
  if (open > 0) {
    io.log(`\n${open} unresolved review note(s) — \`waypoint pull <id> --digest\` to read them.`);
  }
}

/** One registry row: id, kind, group/label, date, state, and open notes. */
export function publicationLine(publication: PublicationSummary): string {
  const stack = [publication.group, publication.label].filter(Boolean).join("/");
  const state = publication.revoked
    ? "revoked"
    : publication.unresolved
      ? `${publication.unresolved} open`
      : "";
  return [
    publication.id.slice(0, 8),
    publication.kind.padEnd(8),
    (stack || "—").padEnd(20),
    publication.createdAt.slice(0, 10),
    publication.title,
    state && `(${state})`,
  ]
    .filter(Boolean)
    .join("  ");
}
