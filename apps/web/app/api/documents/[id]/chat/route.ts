import Anthropic from "@anthropic-ai/sdk";
import { parseDocument, type ResponseValue } from "@waypoint/spec";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { aiEnabled, getAnthropicKey } from "@/lib/ai/config";
import { assembleContext, SYSTEM_PROMPT, type ItemAnswer } from "@/lib/ai/context";
import { resolveModel } from "@/lib/ai/models";
import { appendChatMessage, listChatMessages } from "@/lib/chat";
import { getDocumentDetail } from "@/lib/documents";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Last N persisted messages fed back to the model as conversation history (§14). */
const HISTORY_MESSAGES = 20;
/** Answers are short; streaming keeps this from ever hitting an HTTP timeout. */
const MAX_TOKENS = 2048;

const bodySchema = z.object({
  message: z.string().trim().min(1, "Message is empty.").max(8000),
  /** The focused item's DB id (the focused-item model, §9). Optional. */
  focusedItemId: z.string().min(1).nullable().optional(),
});

/** GET /api/documents/:id/chat — the persisted thread for this document (§14). */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    if (!aiEnabled()) {
      throw new HttpError(400, "ai_unavailable", "AI features require ANTHROPIC_API_KEY.");
    }
    const { id } = await ctx.params;
    if (!getDocumentDetail(id)) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }
    return NextResponse.json({ messages: listChatMessages(id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/documents/:id/chat — the document-scoped sidebar agent (§14). The
 * server assembles lean context, streams from the Anthropic API, and relays the
 * text as SSE. The API key never reaches the browser (server proxy only, §15).
 *
 * SSE lifecycle:
 *  - `event: delta` per streamed text chunk, `event: done` at the end, and
 *    `event: error` if the upstream call fails before completing.
 *  - Client cancel (the browser aborts the fetch) triggers the stream's
 *    `cancel()`, which aborts the upstream request. The partial assistant turn
 *    that the reviewer already saw **is persisted** so a reload matches the UI.
 *  - An upstream error **discards** any partial (it may be malformed) and emits
 *    `event: error`. Either way no promise is left unhandled.
 */
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
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

    const raw = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = bodySchema.parse(raw);

    // Map the focused DB item id → its wp_id (context is keyed by wp_id).
    const focusedWpId =
      (input.focusedItemId && detail.items.find((it) => it.id === input.focusedItemId)?.wpId) || null;

    // Current answers keyed by wp_id, from the immutable parse + the DB responses.
    const answers = new Map<string, ItemAnswer>();
    for (const item of detail.items) {
      if (!item.wpId) continue;
      answers.set(item.wpId, {
        value: (item.response?.value ?? null) as ResponseValue | null,
        status: item.response?.status ?? null,
      });
    }

    const parsed = parseDocument(detail.rawMd);
    const context = assembleContext({
      rawMd: detail.rawMd,
      frontmatter: parsed.frontmatter,
      items: parsed.items,
      answers,
      focusedWpId,
    });
    const model = resolveModel();

    // Cost posture (§14, §19): a large document is windowed, never shipped whole.
    console.info(
      `[chat] doc=${id} model=${model} windowed=${context.windowed} focus=${focusedWpId ?? "none"}`,
    );

    // Persist the user turn up front so a reload shows it, then build the history
    // window (which now ends with this turn) for the model.
    appendChatMessage(id, "user", input.message);
    const windowed = listChatMessages(id).slice(-HISTORY_MESSAGES);
    // The Messages API requires the first message to be a user turn; a sliced
    // window can start mid-exchange on an assistant message, which is a 400.
    const firstUser = windowed.findIndex((m) => m.role === "user");
    const history = windowed
      .slice(firstUser === -1 ? windowed.length : firstUser)
      .map((m) => ({ role: m.role, content: m.content }));

    const client = new Anthropic({ apiKey });
    const anthropicStream = client.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      system: `${SYSTEM_PROMPT}\n\n# Document context\n\n${context.contextText}`,
      messages: history,
    });
    // Attaching an error listener keeps an upstream error from surfacing as an
    // unhandled rejection; the `for await` below is where we actually handle it.
    anthropicStream.on("error", () => {});

    const encoder = new TextEncoder();
    let assistantText = "";
    let clientGone = false;

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const safeEnqueue = (chunk: string) => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            clientGone = true; // controller closed under us — stop emitting.
          }
        };

        try {
          for await (const event of anthropicStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              assistantText += event.delta.text;
              safeEnqueue(sse("delta", { text: event.delta.text }));
            }
          }
          safeEnqueue(sse("done", {}));
          if (assistantText) appendChatMessage(id, "assistant", assistantText);
          if (!clientGone) controller.close();
        } catch (err) {
          if (clientGone || anthropicStream.aborted) {
            // Client cancelled mid-stream: persist what the reviewer already saw.
            if (assistantText) appendChatMessage(id, "assistant", assistantText);
          } else {
            // Upstream failure: discard the (possibly malformed) partial, surface it.
            console.error(`[chat] stream error doc=${id}:`, err);
            safeEnqueue(sse("error", { message: "The assistant response failed. Please try again." }));
            if (!clientGone) {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          }
        }
      },
      cancel() {
        // The browser disconnected (or called stop()). Abort the upstream request;
        // the `for await` throws and the catch above persists the partial.
        clientGone = true;
        anthropicStream.abort();
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Format one Server-Sent Event frame. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
