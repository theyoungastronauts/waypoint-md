import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import {
  MAX_ATTACHMENT_BYTES,
  createAttachment,
  isAllowedImageMime,
} from "@/lib/attachments";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/items/:id/attachments — upload an image attachment for an item's
 * response (§6, decisions B-3). Multipart `file` field only; the trust boundary
 * lives here (never in the client): the MIME must be in the image allowlist and
 * the bytes must be ≤ 10 MB, both rejected server-side. Needs no AI key — this is
 * plain persistence, so it is deliberately independent of the AI capability gate
 * and covered by the central auth middleware (not in OPEN_PATHS).
 */
export async function POST(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw new HttpError(400, "invalid_request", "Expected a multipart/form-data upload.");
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "no_file", "Expected a `file` field in the upload.");
    }
    if (!isAllowedImageMime(file.type)) {
      throw new HttpError(
        400,
        "unsupported_media_type",
        "Only PNG, JPEG, GIF, or WebP images can be attached.",
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new HttpError(413, "attachment_too_large", "Image exceeds the 10 MB attachment limit.");
    }
    if (bytes.length === 0) {
      throw new HttpError(400, "empty_file", "The uploaded image was empty.");
    }

    const filename = file.name && file.name.length > 0 ? file.name : "image";
    const attachment = createAttachment(id, filename, file.type, bytes);
    if (!attachment) {
      throw new HttpError(404, "not_found", "No item with that id.");
    }

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
