import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicKey } from "@/lib/ai/config";
import { resolveModel } from "@/lib/ai/models";
import { parseModelJson } from "@/lib/ai/structure";
import { HttpError } from "@/lib/api/http";
import type { DocumentDetail } from "@/lib/documents";
import {
  assembleBrief,
  BRIEF_SYSTEM_PROMPT,
  briefCacheKey,
  briefOutputSchema,
  buildBriefSource,
  buildBriefUserPrompt,
  type VoiceBrief,
} from "./brief";
import { getCachedBrief, saveBrief } from "./briefs";

/** Room for spoken wording and notes on a long review. */
const MAX_TOKENS = 8192;

export interface BriefResult {
  brief: VoiceBrief;
  model: string;
  cached: boolean;
}

/**
 * Return the cached brief for this document version, or make one with Claude
 * (the model chosen in /settings) and cache it. Upstream failures surface as 502
 * `ai_error`; unusable output as 502 `ai_bad_output` — neither is cached, so the
 * next Talk press retries.
 */
export async function getOrCreateBrief(detail: DocumentDetail): Promise<BriefResult> {
  const source = buildBriefSource(detail);
  const cacheKey = briefCacheKey(source);

  const cached = getCachedBrief(detail.id, cacheKey);
  if (cached) return { brief: cached.brief, model: cached.model, cached: true };

  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new HttpError(400, "voice_unavailable", "Voice requires ANTHROPIC_API_KEY.");
  }

  const model = resolveModel();
  const client = new Anthropic({ apiKey });
  let text: string;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: BRIEF_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildBriefUserPrompt(source) }],
    });
    text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  } catch (err) {
    console.error(`[voice-brief] upstream error doc=${detail.id}:`, err);
    throw new HttpError(502, "ai_error", "Preparing the voice brief failed. Please try again.");
  }

  let parsed: unknown;
  try {
    parsed = parseModelJson(text);
  } catch {
    throw new HttpError(502, "ai_bad_output", "The model did not return a usable voice brief.");
  }
  const output = briefOutputSchema.safeParse(parsed);
  if (!output.success) {
    throw new HttpError(502, "ai_bad_output", "The model did not return a usable voice brief.");
  }

  const brief = assembleBrief(source, output.data);
  const stored = saveBrief(detail.id, cacheKey, model, brief);
  console.info(`[voice-brief] doc=${detail.id} questions=${brief.questions.length} model=${model}`);
  return { brief: stored.brief, model: stored.model, cached: false };
}
