import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { getVoiceSession, updateVoiceSession } from "@/lib/voice/sessions";
import { transcriptEntrySchema } from "@/lib/voice/transcript";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/voice-sessions/:id — one call with its full transcript. */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const session = getVoiceSession(id);
    if (!session) throw new HttpError(404, "not_found", "No voice call with that id.");
    return NextResponse.json({ session });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const patchSchema = z
  .object({
    append: z.array(transcriptEntrySchema).max(500).optional(),
    mode: z.enum(["brief", "thorough"]).optional(),
    status: z.enum(["ended", "submitted"]).optional(),
  })
  .strict();

/**
 * PATCH /api/voice-sessions/:id — the browser saves the transcript as the call
 * goes (so a dropped call keeps what was said), records the chosen style, and
 * marks the call ended or submitted.
 */
export async function PATCH(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = patchSchema.parse(body);
    const updated = updateVoiceSession(id, input);
    if (!updated) throw new HttpError(404, "not_found", "No voice call with that id.");
    return NextResponse.json({
      session: { id: updated.id, status: updated.status, mode: updated.mode, entries: updated.transcript.length },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
