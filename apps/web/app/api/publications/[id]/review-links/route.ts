import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getPublication } from "@/lib/publications";
import { createReviewLink, listReviewLinks, toReviewLinkView } from "@/lib/review/links";
import { reviewLinkUrl, reviewPublicBase } from "@/lib/review/public-url";

export const dynamic = "force-dynamic";

/**
 * Review links live entirely in SQLite — no R2 call, no object, no credential —
 * so unlike the publish doors these routes do **not** gate on `publishEnabled`.
 * A server with no bucket configured can still mint, list, and revoke links for
 * publications it already holds, which is what makes the whole review half of
 * the feature exercisable without touching storage.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

const createSchema = z.object({
  name: z.string().trim().min(1, "A reviewer name is required.").max(80),
});

/** GET /api/publications/:id/review-links — every link minted for this render. */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    requirePublication(id);
    return NextResponse.json({
      links: listReviewLinks(id).map((row) => ({
        ...toReviewLinkView(row),
        url: reviewLinkUrl(id, row.token),
      })),
      publicBase: reviewPublicBase(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/publications/:id/review-links — mint one link for one named
 * reviewer (decision Q4). The name is bound to the token here and copied onto
 * every comment that arrives through it, so this is the only place a reviewer's
 * identity is ever set.
 */
export async function POST(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    requirePublication(id);

    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = createSchema.parse(body);

    const row = createReviewLink(id, input.name);
    return NextResponse.json(
      { link: { ...toReviewLinkView(row), url: reviewLinkUrl(id, row.token) } },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

function requirePublication(id: string): void {
  const row = getPublication(id);
  if (!row) throw new HttpError(404, "not_found", "No publication with that id.");
  if (row.kind !== "media") {
    throw new HttpError(400, "not_media", "Review links are only for media publications.");
  }
}
