import {
  createReviewLink,
  listReviewLinks,
  revokeReviewLink,
  type ReviewLink,
} from "../client";
import { CliError, type IO } from "../io";
import type { CommandDeps } from "./push";

export interface LinksOptions {
  /** Mint a link for this reviewer and print its URL. */
  add?: string;
  /** Kill this link id. */
  revoke?: string;
}

/**
 * `waypoint links <publication-id> [--add "<name>"] [--revoke <link-id>]`
 * (§ media spec Phase C, decision C-6).
 *
 * One link per reviewer, because the name on the link is the name on every note
 * left through it — so `--add` takes a name, not a count. With no flags it lists
 * what exists, which is how a leaked URL gets found and revoked.
 */
export async function runLinks(
  publicationId: string,
  options: LinksOptions,
  deps: CommandDeps,
): Promise<void> {
  const { config, io } = deps;

  if (options.add !== undefined && options.revoke !== undefined) {
    throw new CliError("Use --add or --revoke, not both.");
  }

  if (options.add !== undefined) {
    const name = options.add.trim();
    if (!name) throw new CliError("A reviewer name is required: --add \"Jay\".");
    const link = await createReviewLink(config, publicationId, name);
    io.log(`Review link for ${link.reviewerName}:`);
    io.log(`  ${link.url}`);
    return;
  }

  if (options.revoke !== undefined) {
    const link = await revokeReviewLink(config, publicationId, options.revoke);
    io.log(`Revoked ${link.id.slice(0, 8)} (${link.reviewerName}). The notes it carried stay.`);
    return;
  }

  const links = await listReviewLinks(config, publicationId);
  if (links.length === 0) {
    io.log("No review links yet. Create one with --add \"<name>\".");
    return;
  }
  io.log(`${links.length} review link(s):`);
  for (const link of links) printLink(io, link);
}

function printLink(io: IO, link: ReviewLink): void {
  const state = link.revoked ? "revoked" : link.lastSeenAt ? "opened" : "never opened";
  io.log(`  ${link.id.slice(0, 8)}  ${link.reviewerName.padEnd(16)}  ${state}`);
  if (!link.revoked) io.log(`            ${link.url}`);
}
