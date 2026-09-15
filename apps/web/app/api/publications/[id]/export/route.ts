import { HttpError, toErrorResponse } from "@/lib/api/http";
import { buildMediaDigest } from "@/lib/media-digest";
import { getPublication, toPublicationDetail } from "@/lib/publications";
import { listMediaComments, toCommentViews } from "@/lib/review/comments";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/publications/:id/export?format=digest — the media digest (SPEC §9.4,
 * decision C-5), which is what `waypoint pull <publication-id> --digest` writes.
 *
 * Mirrors the document export door (`/api/documents/:id/export`): same query
 * parameter, same `text/markdown` + `Content-Disposition` response, so the CLI's
 * existing filename handling works unchanged. Open notes only unless
 * `?resolved=1`, because the agent's job is the open ones.
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "digest";
    if (format !== "digest") {
      throw new HttpError(
        400,
        "unsupported_format",
        `Unknown export format "${format}". A publication exports as "digest".`,
      );
    }

    const row = getPublication(id);
    if (!row) throw new HttpError(404, "not_found", "No publication with that id.");
    const detail = toPublicationDetail(row);
    if (detail.kind !== "media") {
      throw new HttpError(400, "not_media", "Only media publications have a review digest.");
    }

    const body = buildMediaDigest(
      detail,
      toCommentViews(listMediaComments(id)),
      new Date().toISOString(),
      { includeResolved: url.searchParams.get("resolved") === "1" },
    );

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${detail.sanitizedName}.digest.md"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
