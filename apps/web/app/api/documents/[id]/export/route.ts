import { applyReview } from "@waypoint/spec";
import { toErrorResponse, HttpError } from "@/lib/api/http";
import { getDocumentDetail } from "@/lib/documents";
import { buildReviewState, exportFilename } from "@/lib/review-state";
import { appendSyntheticResponses, buildSyntheticEntries } from "@/lib/synthetic-export";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id/export?format=annotated — the annotated markdown
 * download (§8, §11). The body is `applyReview(raw_md, reviewState)`: a pure
 * function of the source and the persisted review. An untouched document
 * round-trips byte-identically (no responses → empty review → source returned
 * unchanged). The `digest` format lands in Phase 9.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const format = new URL(req.url).searchParams.get("format") ?? "annotated";
    if (format !== "annotated") {
      throw new HttpError(
        400,
        "unsupported_format",
        `Unknown export format "${format}". Only "annotated" is available.`,
      );
    }

    const detail = getDocumentDetail(id);
    if (!detail) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }

    // Caller-supplied timestamp keeps applyReview pure; it is only recorded when
    // the review is non-empty (untouched export stays byte-identical).
    const review = buildReviewState(detail, new Date().toISOString());
    // Synthetic items never enter the splice writer (§5.7): their responses are
    // appended below the (byte-faithful) document body, and only when they exist.
    const annotated = appendSyntheticResponses(
      applyReview(detail.rawMd, review),
      buildSyntheticEntries(detail),
    );
    const filename = exportFilename(detail);

    return new Response(annotated, {
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
