import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { revokeReviewLink, toReviewLinkView } from "@/lib/review/links";
import { reviewLinkUrl } from "@/lib/review/public-url";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; linkId: string }>;
}

/**
 * POST /api/publications/:id/review-links/:linkId/revoke — kill one link
 * (decision Q5). Idempotent, and deliberately cheap: the publication keeps its
 * objects and every comment made through the link keeps its attribution, so
 * revoking a leaked URL costs nothing but the URL.
 *
 * Note the ordering when the render itself must also go: revoking the
 * *publication* deletes the R2 objects, but `dropzone.tylersavery.com` is
 * Cloudflare-fronted with a four-hour edge cache, so the file URL can keep
 * answering 200 until the cache is purged (`docs/ops/review-tunnel.md`).
 * Revoking the link is the immediate kill switch; the purge is the follow-up.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id, linkId } = await ctx.params;
    const row = revokeReviewLink(id, linkId);
    if (!row) throw new HttpError(404, "not_found", "No review link with that id.");
    return NextResponse.json({
      link: { ...toReviewLinkView(row), url: reviewLinkUrl(id, row.token) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
