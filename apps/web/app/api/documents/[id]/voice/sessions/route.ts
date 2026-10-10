import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getDocumentDetail } from "@/lib/documents";
import { listVoiceSessions } from "@/lib/voice/sessions";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id/voice/sessions — every voice call on the document,
 * newest first, each with its full transcript. Available whether or not voice is
 * configured now: a transcript stays readable after the keys are removed.
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!getDocumentDetail(id)) throw new HttpError(404, "not_found", "No document with that id.");
    return NextResponse.json({ sessions: listVoiceSessions(id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
