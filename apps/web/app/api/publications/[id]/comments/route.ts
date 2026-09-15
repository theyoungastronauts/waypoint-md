import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getPublication } from "@/lib/publications";
import { listMediaComments, toCommentViews } from "@/lib/review/comments";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/publications/:id/comments — the author-side view of every note on a
 * render (decision C-4), behind the standard token gate.
 *
 * Richer than the public list by exactly the fields an author acts on: the
 * resolve timestamp, whether the note arrived through a review link, and the
 * `ordinal` that `waypoint resolve <id> c3` and the digest's `### c3` both name.
 * The ordinals come from one ordering function, so the three agree.
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const row = getPublication(id);
    if (!row) throw new HttpError(404, "not_found", "No publication with that id.");

    const comments = toCommentViews(listMediaComments(id));
    return NextResponse.json({
      comments,
      unresolved: comments.filter((c) => !c.resolved).length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
