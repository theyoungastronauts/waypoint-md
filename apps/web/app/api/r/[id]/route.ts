import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api/http";
import { resolveReviewAccess, touchLastSeen } from "@/lib/review/links";
import { notFoundError } from "@/lib/review/errors";
import { toPublicReviewPayload } from "@/lib/review/public-view";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/r/:id?k= — the render a review link opens, the versions of the same
 * material, and the reviewer's bound name (§ media spec Phase C, decision C-3).
 *
 * Public: this route and its comments sibling are the only two `/api/*` paths
 * the middleware lets through without a token, and the only ones the tunnel's
 * ingress forwards. The `?k=` link is the entire capability — a missing, wrong,
 * revoked, or out-of-group token is a flat 404, indistinguishable from an id
 * that does not exist.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const token = new URL(req.url).searchParams.get("k");
    const access = resolveReviewAccess(token, id);
    if (!access) throw notFoundError();

    touchLastSeen(access.link.id);
    return NextResponse.json(toPublicReviewPayload(access.publication, access.link));
  } catch (err) {
    return toErrorResponse(err);
  }
}
