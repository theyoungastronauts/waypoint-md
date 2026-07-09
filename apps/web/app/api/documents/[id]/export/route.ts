import { applyReview } from "@waypoint/spec";
import { toErrorResponse, HttpError } from "@/lib/api/http";
import { enrichReviewWithAttachments } from "@/lib/attachments-export";
import { buildDigest } from "@/lib/digest";
import { getDocumentDetail } from "@/lib/documents";
import { buildReviewState, exportFilename } from "@/lib/review-state";
import { appendSyntheticResponses, buildSyntheticEntries } from "@/lib/synthetic-export";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id/export?format=annotated|digest — the review downloads
 * (§8, §11). Both are pure functions of `(raw_md, persisted review)`:
 *   - **annotated** (default): `applyReview(raw_md, review)` — the source with
 *     answers/checks/comments spliced in. An untouched document round-trips
 *     byte-identically (no responses → empty review → source returned unchanged).
 *   - **digest**: the compact `Q → A` summary for cheap agent consumption
 *     (SPEC §9), built from the same review state.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const format = new URL(req.url).searchParams.get("format") ?? "annotated";
    if (format !== "annotated" && format !== "digest") {
      throw new HttpError(
        400,
        "unsupported_format",
        `Unknown export format "${format}". Use "annotated" or "digest".`,
      );
    }

    const detail = getDocumentDetail(id);
    if (!detail) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }

    // Caller-supplied timestamp keeps the writers pure; it is only recorded when
    // the review is non-empty (untouched annotated export stays byte-identical).
    const now = new Date().toISOString();

    let body: string;
    if (format === "digest") {
      body = buildDigest(detail, now);
    } else {
      // Attachments are additive (B-4): enrich the review so each item's
      // reference line lands in its wp:answer interior as ordinary answer content.
      // applyReview stays untouched, so a doc with no attachments is a no-op here
      // and still exports byte-identically.
      const review = enrichReviewWithAttachments(buildReviewState(detail, now), detail);
      // Synthetic items never enter the splice writer (§5.7): their responses are
      // appended below the (byte-faithful) document body, and only when they exist.
      body = appendSyntheticResponses(
        applyReview(detail.rawMd, review),
        buildSyntheticEntries(detail),
      );
    }
    const filename = exportFilename(detail, format === "digest" ? "digest" : "annotated");

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
