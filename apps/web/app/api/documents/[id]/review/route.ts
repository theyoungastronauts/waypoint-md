import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getDocumentDetail } from "@/lib/documents";
import { buildNativeReview } from "@/lib/render/native-review";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id/review — the document already parsed for a native client: prose segments
 * as markdown, and each question with its type, options and pre-checks, rationale, the draft to
 * start from (saved answer or source prefill) and a ready comment anchor. Read only; answers go
 * back through `PUT /api/items/:id/response`, comments through `POST /api/documents/:id/comments`,
 * completion through `PATCH /api/documents/:id`.
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const detail = getDocumentDetail(id);
    if (!detail) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }
    return NextResponse.json(buildNativeReview(detail));
  } catch (err) {
    return toErrorResponse(err);
  }
}
