import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getDocumentDetail } from "@/lib/documents";
import { getOpenAiKey, voiceEnabled } from "@/lib/voice/config";
import { getOrCreateBrief } from "@/lib/voice/make-brief";
import { mintClientSecret, REALTIME_CALLS_URL, REALTIME_MODEL } from "@/lib/voice/realtime";
import { createVoiceSession } from "@/lib/voice/sessions";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/documents/:id/voice/session — start a voice call. Takes the
 * document's voice brief (cached, or made now), mints a short-lived OpenAI
 * Realtime key with the interviewer's instructions and tools baked in, and opens
 * a `voice_sessions` record for the transcript.
 *
 * Returns the short-lived key, never `OPENAI_API_KEY`. The browser uses it once,
 * to POST its WebRTC offer to `callsUrl`.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const apiKey = getOpenAiKey();
    if (!voiceEnabled() || !apiKey) {
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

    const { brief } = await getOrCreateBrief(detail);
    const secret = await mintClientSecret(apiKey, brief);
    const session = createVoiceSession(detail.id, REALTIME_MODEL);
    console.info(`[voice-session] doc=${detail.id} session=${session.id} model=${REALTIME_MODEL}`);

    return NextResponse.json({
      sessionId: session.id,
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      model: REALTIME_MODEL,
      callsUrl: REALTIME_CALLS_URL,
      brief,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
