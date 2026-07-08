import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { aiEnabled, getAnthropicKey } from "@/lib/ai/config";
import { resolveModel } from "@/lib/ai/models";
import {
  buildStructureUserPrompt,
  parseModelJson,
  proposalEnvelopeSchema,
  STRUCTURE_SYSTEM_PROMPT,
  validateProposals,
  type AcceptedProposal,
} from "@/lib/ai/structure";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { createSyntheticItems, getDocumentDetail, type CreateSyntheticItem } from "@/lib/documents";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** JSON out can be large for a document with many decision points. */
const MAX_TOKENS = 4096;

/**
 * POST /api/documents/:id/structure — adoptive import (§5.7, §14). One
 * server-side model pass proposes structured items for a convention-less
 * document, each anchored by a quote. **Every anchor is validated against the
 * source before acceptance** (the trust boundary — model output is untrusted):
 * proposals whose quotes don't match verbatim are skipped and reported. Accepted
 * items are persisted as synthetic items (DB only; `raw_md` stays immutable).
 *
 * Degrades like the sidebar (§14): no `ANTHROPIC_API_KEY` → 400 `ai_unavailable`
 * and the affordance never renders in the first place.
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    if (!aiEnabled()) {
      throw new HttpError(400, "ai_unavailable", "AI features require ANTHROPIC_API_KEY.");
    }
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      throw new HttpError(400, "ai_unavailable", "AI features require ANTHROPIC_API_KEY.");
    }

    const { id } = await ctx.params;
    const detail = getDocumentDetail(id);
    if (!detail) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }

    // One pass only (v1): a document that already has items is not re-structured.
    if (detail.items.length > 0) {
      const conventioned = detail.items.some((it) => !it.synthetic);
      throw new HttpError(
        400,
        conventioned ? "already_conventioned" : "already_structured",
        conventioned
          ? "This document already uses the Waypoint convention; adoptive import is for unstructured documents."
          : "This document has already been structured.",
      );
    }

    const client = new Anthropic({ apiKey });
    let text: string;
    try {
      const response = await client.messages.create({
        model: resolveModel(),
        max_tokens: MAX_TOKENS,
        system: STRUCTURE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildStructureUserPrompt(detail.rawMd) }],
      });
      text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
    } catch (err) {
      console.error(`[structure] upstream error doc=${id}:`, err);
      throw new HttpError(502, "ai_error", "The structuring request failed. Please try again.");
    }

    // Model output is untrusted: parse defensively, then validate every anchor.
    let parsed: unknown;
    try {
      parsed = parseModelJson(text);
    } catch {
      throw new HttpError(502, "ai_bad_output", "The model did not return a usable proposal.");
    }
    const envelope = proposalEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      throw new HttpError(502, "ai_bad_output", "The model did not return a usable proposal.");
    }

    const { accepted, skipped } = validateProposals(detail.rawMd, envelope.data.items);
    const createdIds = createSyntheticItems(id, accepted.map(toCreateItem));

    console.info(
      `[structure] doc=${id} accepted=${createdIds.length} skipped=${skipped.length}`,
    );

    return NextResponse.json({
      accepted: createdIds.length,
      itemIds: createdIds,
      skipped: skipped.map((s) => ({ prompt: s.prompt, reason: s.reason })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** An accepted proposal → the persistence shape (choice config assembled here). */
function toCreateItem(proposal: AcceptedProposal): CreateSyntheticItem {
  return {
    type: proposal.type,
    promptMd: proposal.promptMd,
    config:
      proposal.type === "choice"
        ? {
            select: proposal.select ?? "single",
            options: (proposal.options ?? []).map((label) => ({ label, checked: false })),
          }
        : null,
    anchor: { exact: proposal.anchorExact, start: proposal.start },
  };
}
