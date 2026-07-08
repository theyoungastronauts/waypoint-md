import { listDocuments } from "../client";
import { handshake } from "../handshake";
import { readPointer } from "../pointer";
import type { CommandDeps } from "./push";

/**
 * `waypoint status` (§12): list this project's documents and their review states.
 * The queue endpoint filters by project id, but the CLI only knows the project
 * name, so it fetches the queue and filters client-side by `projectName`. The
 * pending-pull pointer (if any) is flagged.
 */
export async function runStatus(deps: CommandDeps): Promise<void> {
  const { config, io } = deps;
  await handshake(config, io);

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
