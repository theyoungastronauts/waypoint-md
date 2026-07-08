import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api/http";
import { aiEnabled } from "@/lib/ai/config";
import { isKnownModel, MODEL_CHOICES, MODEL_SETTING_KEY, resolveModelDetail } from "@/lib/ai/models";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The settings payload the `/settings` page reads and writes. */
function settingsPayload() {
  const { model, source } = resolveModelDetail();
  return { model, source, choices: MODEL_CHOICES, aiEnabled: aiEnabled() };
}

/** GET /api/settings — current resolved model, its source, and the offerable set. */
export function GET(): NextResponse {
  return NextResponse.json(settingsPayload());
}

const bodySchema = z.object({
  // Only the three ratified choices are accepted — the offer set is closed (§14).
  model: z.string().refine(isKnownModel, "Unknown model."),
});

/** POST /api/settings — set the sidebar model (settings value wins over env, §14). */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const raw = await req.json().catch(() => ({}));
    const { model } = bodySchema.parse(raw);
    setSetting(MODEL_SETTING_KEY, model);
    return NextResponse.json(settingsPayload());
  } catch (err) {
    return toErrorResponse(err);
  }
}
