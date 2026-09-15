import { listMediaComments, resolveMediaComment, type MediaComment } from "../client";
import { CliError } from "../io";
import type { CommandDeps } from "./push";

/**
 * `waypoint resolve <publication-id> <comment>` (decision C-6): mark a review
 * note acted on, which is what an agent runs after making the change the note
 * asked for.
 *
 * The note can be named the way the digest names it (`c3`), by its full id, or
 * by a unique id prefix — the digest is what the agent just read, and the id is
 * what a human copies out of the UI. The list is fetched first either way, so
 * the ordinal is resolved against the notes as they are right now rather than
 * against a stale pull.
 */
export async function runResolve(
  publicationId: string,
  commentRef: string,
  deps: CommandDeps,
): Promise<void> {
  const { config, io } = deps;
  const comments = await listMediaComments(config, publicationId);
  const comment = findComment(comments, commentRef);

  if (comment.resolved) {
    io.log(`c${comment.ordinal} is already resolved.`);
    return;
  }

  const resolved = await resolveMediaComment(config, publicationId, comment.id);
  io.log(`Resolved c${comment.ordinal} (${resolved.authorName}): ${firstLine(resolved.body)}`);
}

/** Match a `c<n>` ordinal, a full id, or an unambiguous id prefix. */
export function findComment(comments: MediaComment[], ref: string): MediaComment {
  const trimmed = ref.trim();
  if (trimmed.length === 0) throw new CliError("Which note? Pass its digest number (c1) or its id.");

  const ordinal = /^c(\d+)$/i.exec(trimmed);
  if (ordinal) {
    const n = Number(ordinal[1]);
    const match = comments.find((c) => c.ordinal === n);
    if (!match) {
      throw new CliError(
        `No note ${trimmed} on this publication (it has ${comments.length}). Pull the digest again — numbers shift as notes are added.`,
      );
    }
    return match;
  }

  const exact = comments.find((c) => c.id === trimmed);
  if (exact) return exact;

  const prefixed = comments.filter((c) => c.id.startsWith(trimmed));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) {
    throw new CliError(`"${trimmed}" matches ${prefixed.length} notes. Use more of the id.`);
  }
  throw new CliError(`No note "${trimmed}" on this publication.`);
}

function firstLine(body: string): string {
  const line = body.split("\n", 1)[0].trim();
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}
