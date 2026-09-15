import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { assertPublishEnabled } from "@/lib/publish/guard";
import { createMediaPublication } from "@/lib/publish/media";
import {
  MAX_MEDIA_BYTES,
  MEDIA_CONTENT_TYPE_VALUES,
  MIN_MEDIA_BYTES,
} from "@/lib/publish/media-types";

export const dynamic = "force-dynamic";

/** Same CLI-publish source hint the markdown door takes (origin + host). */
const sourceSchema = z.object({ host: z.string().trim().min(1).optional() });

/**
 * The upload allowlist and the size bounds are the whole of the server's control
 * over what gets written: past this point the caller holds a presigned PUT and
 * writes to the bucket directly. `contentType` is an enum, not a pattern, and
 * `bytes` is bounded at both ends (a zero-byte render is a mistake, and 4 GiB is
 * well past the largest ProRes master the studio produces) — decision B-2.
 */
const createSchema = z.object({
  filename: z.string().trim().min(1, "filename is required."),
  contentType: z.enum(MEDIA_CONTENT_TYPE_VALUES),
  bytes: z.number().int().min(MIN_MEDIA_BYTES).max(MAX_MEDIA_BYTES),
  title: z.string().trim().min(1).optional(),
  group: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  /** The render manifest, stored verbatim on the row and uploaded beside the file. */
  manifest: z.record(z.unknown()).optional(),
  source: sourceSchema.optional(),
});

/**
 * POST /api/publications/media — reserve a media publication and hand back a
 * presigned R2 PUT (§ media spec Phase B). The response is a capability for one
 * object of one size; the row stays out of the registry until the companion
 * finalize call confirms the bytes landed.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertPublishEnabled();
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = createSchema.parse(body);

    const result = await createMediaPublication({
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.bytes,
      title: input.title ?? null,
      group: input.group ?? null,
      label: input.label ?? null,
      manifest: input.manifest ?? null,
      origin: input.source ? "cli" : "api",
      sourceHost: input.source?.host ?? null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
