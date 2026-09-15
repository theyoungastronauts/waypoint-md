import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { toPublicationSummary } from "@/lib/publications";
import { assertPublishEnabled } from "@/lib/publish/guard";
import { finalizeMediaPublication } from "@/lib/publish/media";
import { publicationPagePath } from "@/lib/publish/paths";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/publications/:id/finalize — confirm a presigned upload landed and
 * open the row to the registry (§ media spec Phase B, decision B-2).
 *
 * A missing object is the interesting failure: the row exists and the key is
 * reserved, but nothing was ever written, so the answer is `409 upload_missing`
 * rather than a 404 — the publisher can retry the PUT against the same URL until
 * it expires. `page` is the tailnet detail path, relative like `/d/:id` is, so
 * the CLI prefixes it with its own configured public URL (§8).
 */
export async function POST(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    assertPublishEnabled();
    const { id } = await ctx.params;
    const result = await finalizeMediaPublication(id);

    if (!result.ok) {
      if (result.reason === "upload_missing") {
        throw new HttpError(
          409,
          "upload_missing",
          "No uploaded object for this publication. Complete the presigned upload, then finalize.",
        );
      }
      if (result.reason === "not_media") {
        throw new HttpError(400, "not_media", "That publication is not a media publication.");
      }
      throw new HttpError(404, "not_found", "No publication with that id.");
    }

    const summary = toPublicationSummary(result.row);
    if (summary.kind !== "media") {
      throw new HttpError(400, "not_media", "That publication is not a media publication.");
    }

    return NextResponse.json({
      id: summary.id,
      title: summary.title,
      kind: summary.kind,
      bytes: summary.bytes,
      urls: {
        file: summary.urls.file,
        manifest: summary.urls.manifest,
        page: publicationPagePath(summary.id),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
