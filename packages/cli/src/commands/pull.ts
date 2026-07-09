import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  exportAnnotated,
  exportDigest,
  getAttachmentBytes,
  getDocument,
  listDocuments,
  markPulled,
  type DocumentDetail,
} from "../client";
import { handshake } from "../handshake";
import { CliError } from "../io";
import { clearPointer, readPointer } from "../pointer";
import type { CommandDeps } from "./push";

export interface PullOptions {
  latest?: boolean;
  /** Also fetch the compact digest export beside the annotated file (§12, SPEC §9). */
  digest?: boolean;
}

/**
 * Choose where the annotated review lands. With a source path, it sits beside the
 * source as `<name>.review.md` (§11, §12); without one (e.g. a pasted doc) it
 * falls back to the current directory using the server-supplied filename.
 */
export function reviewTargetPath(
  projectRoot: string,
  sourcePath: string | null,
  serverFilename: string,
  id: string,
): string {
  const filename = serverFilename || `${id}.review.md`;
  if (sourcePath) {
    return path.resolve(projectRoot, path.dirname(sourcePath), filename);
  }
  return path.resolve(process.cwd(), filename);
}

/**
 * `waypoint pull [id|--latest] [--digest]` (§12). Resolves the target document
 * (explicit id → --latest for this project → the pending pointer), writes the
 * annotated markdown beside its source, optionally writes the compact digest
 * beside it too (`--digest`, SPEC §9), then clears the pointer and marks the
 * document `pulled`. The digest is fetched before the pointer/`pulled` side
 * effects, so a digest fetch failure never leaves the pull half-applied.
 */
export async function runPull(
  idArg: string | undefined,
  options: PullOptions,
  deps: CommandDeps,
): Promise<void> {
  const { config, io } = deps;
  await handshake(config, io);

  const pointer = readPointer(config.projectRoot);
  let id = idArg;

  if (!id && options.latest) {
    const all = await listDocuments(config);
    const scoped = config.project ? all.filter((d) => d.projectName === config.project) : all;
    if (scoped.length === 0) throw new CliError("No documents to pull.");
    id = scoped[0].id; // listing is newest-first.
  }
  if (!id && pointer) id = pointer.id;
  if (!id) {
    throw new CliError("Nothing to pull. Specify an id, use --latest, or push a document first.");
  }

  const detail = await getDocument(config, id);
  const annotated = await exportAnnotated(config, id);
  // Fetch the digest up front (before any writes/side effects) so a failure here
  // fails the whole pull cleanly rather than half-writing.
  const digest = options.digest ? await exportDigest(config, id) : null;

  const target = reviewTargetPath(config.projectRoot, detail.sourcePath, annotated.filename, id);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, annotated.body, "utf8");
  io.log(`Wrote ${path.relative(process.cwd(), target)}`);

  // Materialize any image attachments into a sibling <name>.attachments/ folder
  // (§6, B-4). The annotated body already references them from the answer
  // interiors; here we write the bytes beside the review file so those relative
  // links resolve. A doc with no attachments writes nothing.
  await writeAttachments(config, detail, attachmentFolderBase(annotated.filename, id), path.dirname(target), io);

  if (digest) {
    // Land the digest in the same directory as the annotated file.
    const digestTarget = reviewTargetPath(config.projectRoot, detail.sourcePath, digest.filename, id);
    writeFileSync(digestTarget, digest.body, "utf8");
    io.log(`Wrote ${path.relative(process.cwd(), digestTarget)}`);
  }

  await markPulled(config, id);
  if (pointer && pointer.id === id) {
    clearPointer(config.projectRoot);
  }
  io.log(`Marked ${id.slice(0, 8)} pulled.`);
}

/** The `<name>` for the attachments folder, derived from the annotated filename. */
function attachmentFolderBase(annotatedFilename: string, id: string): string {
  const stripped = annotatedFilename.replace(/\.review\.md$/, "");
  return stripped.length > 0 ? stripped : id;
}

/**
 * Write every attachment on the document into `<base>.attachments/` beside the
 * review file (§6, B-4). Uses each attachment's server-supplied `exportName` so
 * the on-disk filenames match the reference paths already spliced into the
 * answer interiors. No-op when the document has no attachments.
 */
async function writeAttachments(
  config: CommandDeps["config"],
  detail: DocumentDetail,
  folderBase: string,
  reviewDir: string,
  io: CommandDeps["io"],
): Promise<void> {
  const all = detail.items.flatMap((it) => it.attachments ?? []);
  if (all.length === 0) return;

  const folderDir = path.join(reviewDir, `${folderBase}.attachments`);
  mkdirSync(folderDir, { recursive: true });
  for (const att of all) {
    const bytes = await getAttachmentBytes(config, att.id);
    writeFileSync(path.join(folderDir, att.exportName), bytes);
  }
  io.log(`Wrote ${all.length} attachment(s) to ${path.relative(process.cwd(), folderDir)}`);
}
