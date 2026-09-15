import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { addMediaComment, listMediaComments } from "@/lib/review/comments";
import { resolveReviewAccess, touchLastSeen } from "@/lib/review/links";
import { commentError, notFoundError } from "@/lib/review/errors";
import { toPublicComments } from "@/lib/review/public-view";
import { checkCommentRateLimit, clientIp } from "@/lib/review/rate-limit";
import { MAX_TIMECODE_MS } from "@/lib/review/timecode";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The public comment body (decision C-2). Note what it does **not** accept: a
 * name. Attribution comes from the review link the request arrived on, so a
 * `name` (or `author`, or `authorName`) in the body is simply not a field here
 * and is discarded with the rest of the unknown keys — a reviewer cannot post as
 * someone else, whatever they send.
 */
const createSchema = z.object({
  k: z.string().min(1).optional(),
  timecodeMs: z.number().int().min(0).max(MAX_TIMECODE_MS).nullable().optional(),
  region: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .nullable()
    .optional(),
  body: z.string().min(1, "A comment body is required."),
});

/** GET /api/r/:id/comments?k= — every note on the render, in timecode order. */
export async function GET(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const token = new URL(req.url).searchParams.get("k");
    const access = resolveReviewAccess(token, id);
    if (!access) throw notFoundError();

    return NextResponse.json({ comments: toPublicComments(listMediaComments(id)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/r/:id/comments — leave a timecoded, region-marked, or general note.
 *
 * The token travels in the body (it is already in the page's URL; keeping it out
 * of a second query string keeps it out of one more log). Rate limits are
 * checked only after the link resolves, so an unauthenticated flood cannot fill
 * the buckets that protect a real reviewer.
 */
export async function POST(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = createSchema.parse(body);

    const token = input.k ?? new URL(req.url).searchParams.get("k");
    const access = resolveReviewAccess(token, id);
    if (!access) throw notFoundError();

    const limit = checkCommentRateLimit(clientIp(req.headers), access.link.id);
    if (!limit.ok) {
      throw new HttpError(
        429,
        "rate_limited",
        limit.scope === "ip"
          ? "Too many comments from this address. Wait a moment and try again."
          : "This review link has reached its daily comment limit.",
        { retryAfterSeconds: limit.retryAfterSeconds },
      );
    }

    const result = addMediaComment({
      publicationId: id,
      reviewLinkId: access.link.id,
      authorName: access.link.reviewerName,
      timecodeMs: input.timecodeMs ?? null,
      region: input.region ?? null,
      body: input.body,
    });
    if (!result.ok) throw commentError(result.reason);

    touchLastSeen(access.link.id);
    // Re-list rather than wrap the inserted row on its own: an ordinal is a
    // position in the whole ordered set, and a one-row view would report every
    // new note as `c1`.
    const view = toPublicComments(listMediaComments(id)).find((c) => c.id === result.row.id);
    return NextResponse.json({ comment: view }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

