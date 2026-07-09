import { NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { deleteAttachment, readAttachment } from "@/lib/attachments";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/attachments/:id — stream an attachment's bytes for the review-view
 * thumbnail (§6, B-3). Returns the stored image with its recorded content-type;
 * auth-covered by the central middleware. `no-store` keeps a deleted image from
 * lingering in a cache after its row and bytes are gone.
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const found = readAttachment(id);
    if (!found) {
      throw new HttpError(404, "not_found", "No attachment with that id.");
    }
    return new Response(new Uint8Array(found.bytes), {
      status: 200,
      headers: {
        "content-type": found.meta.mime,
        "content-length": String(found.bytes.length),
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/attachments/:id — remove the removable thumbnail (§6). Deletes both
 * the metadata row and the on-disk bytes; a missing id is a 404.
 */
export async function DELETE(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!deleteAttachment(id)) {
      throw new HttpError(404, "not_found", "No attachment with that id.");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
