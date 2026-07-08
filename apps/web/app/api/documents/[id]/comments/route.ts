import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { createComment } from "@/lib/comments";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * A selection comment (§5.4, §10). The anchor is quote-based: `exact` is the
 * selected source text, `prefix`/`suffix` are short context strings, and
 * `exactHash` carries the hash of an over-long selection. A comment must say
 * something — a body, a suggested replacement, or both.
 */
const anchorSchema = z.object({
  exact: z.string().min(1, "anchor.exact is required"),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  exactHash: z.string().optional(),
});

const bodySchema = z
  .object({
    anchor: anchorSchema,
    bodyMd: z.string().default(""),
    suggestionMd: z.string().nullish(),
  })
  .refine(
    (v) => v.bodyMd.trim().length > 0 || (v.suggestionMd?.trim().length ?? 0) > 0,
    { message: "a comment needs a body or a suggestion", path: ["bodyMd"] },
  );

/** POST /api/documents/:id/comments — create a selection comment (§8). */
export async function POST(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const raw = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = bodySchema.parse(raw);

    const created = createComment(id, {
      anchor: input.anchor,
      bodyMd: input.bodyMd,
      suggestionMd: input.suggestionMd ?? null,
    });
    if (!created) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }
    return NextResponse.json({ comment: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
