import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { deleteComment, updateComment } from "@/lib/comments";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Editing a comment touches only its body and suggestion. The anchor is
 * immutable — moving a comment to different text is a new comment — so it is not
 * accepted here. `suggestionMd: null` clears the suggestion; omitting it leaves
 * it unchanged.
 */
const patchSchema = z
  .object({
    bodyMd: z.string().optional(),
    suggestionMd: z.string().nullish(),
  })
  .refine((v) => v.bodyMd !== undefined || v.suggestionMd !== undefined, {
    message: "nothing to update",
  });

/** PATCH /api/comments/:id — edit a comment's body/suggestion (§8). */
export async function PATCH(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const raw = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const patch = patchSchema.parse(raw);

    const updated = updateComment(id, {
      bodyMd: patch.bodyMd,
      suggestionMd: patch.suggestionMd === undefined ? undefined : patch.suggestionMd ?? null,
    });
    if (!updated) {
      throw new HttpError(404, "not_found", "No comment with that id.");
    }
    return NextResponse.json({ comment: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/comments/:id — remove a comment (§8). */
export async function DELETE(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!deleteComment(id)) {
      throw new HttpError(404, "not_found", "No comment with that id.");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
