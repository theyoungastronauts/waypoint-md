import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { toPublicationDetail } from "@/lib/publications";
import { assertPublishEnabled } from "@/lib/publish/guard";
import { revoke } from "@/lib/publish/service";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/publications/:id/revoke — delete the three R2 objects and stamp
 * `revoked_at`. Idempotent: revoking an already-revoked publication succeeds and
 * changes nothing. The registry row always survives.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    assertPublishEnabled();
    const { id } = await ctx.params;
    const row = await revoke(id);
    if (!row) {
      throw new HttpError(404, "not_found", "No publication with that id.");
    }
    return NextResponse.json({ publication: toPublicationDetail(row) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
