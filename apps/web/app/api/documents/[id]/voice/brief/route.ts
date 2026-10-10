import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getDocumentDetail } from "@/lib/documents";
import { voiceEnabled } from "@/lib/voice/config";
import { getOrCreateBrief } from "@/lib/voice/make-brief";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/documents/:id/voice/brief — the document's voice brief, made by
 * Claude the first time a call is started and cached against the document
 * version afterwards. `cached` says which happened.
 *
 * Degrades like the other AI features: without both keys it answers 400
 * `voice_unavailable`, and the Talk button never renders in the first place.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    if (!voiceEnabled()) {
      throw new HttpError(
        400,
        "voice_unavailable",
        "Voice requires both OPENAI_API_KEY and ANTHROPIC_API_KEY.",
      );
    }
    const { id } = await ctx.params;
    const detail = getDocumentDetail(id);
    if (!detail) throw new HttpError(404, "not_found", "No document with that id.");
    if (detail.items.length === 0) {
      throw new HttpError(400, "no_questions", "This document has no questions to answer by voice.");
    }

    const result = await getOrCreateBrief(detail);
    return NextResponse.json({ brief: result.brief, model: result.model, cached: result.cached });
  } catch (err) {
    return toErrorResponse(err);
  }
}
