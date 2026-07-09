import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getPublication, toPublicationDetail } from "@/lib/publications";
import { assertPublishEnabled } from "@/lib/publish/guard";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/publications/:id — the full registry row, including source markdown. */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    assertPublishEnabled();
    const { id } = await ctx.params;
    const row = getPublication(id);
    if (!row) {
      throw new HttpError(404, "not_found", "No publication with that id.");
    }
    return NextResponse.json({ publication: toPublicationDetail(row) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
