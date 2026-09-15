import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { setCommentResolved, toCommentViews } from "@/lib/review/comments";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; commentId: string }>;
}

/**
 * POST /api/publications/:id/comments/:commentId/unresolve — reopen a note
 * (decision C-2), when it turns out the change did not land.
 * Idempotent. The comment id is scoped to the publication, so an id from another
 * render cannot be resolved through this path.
 *
 * The returned `ordinal` is positional within this publication's current notes,
 * so it is only meaningful next to the list it came from.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id, commentId } = await ctx.params;
    const row = setCommentResolved(id, commentId, false);
    if (!row) throw new HttpError(404, "not_found", "No comment with that id.");
    const [comment] = toCommentViews([row]);
    return NextResponse.json({ comment });
  } catch (err) {
    return toErrorResponse(err);
  }
}
