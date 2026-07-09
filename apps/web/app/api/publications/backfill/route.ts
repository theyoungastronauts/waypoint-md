import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api/http";
import { assertPublishEnabled } from "@/lib/publish/guard";
import { backfill } from "@/lib/publish/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/publications/backfill — index existing `smitty/shares/` objects into
 * the registry. Idempotent and read-only against the bucket; returns how many
 * rows were indexed vs. skipped (already present). Static segment, so it resolves
 * ahead of the `[id]` route.
 */
export async function POST(): Promise<NextResponse> {
  try {
    assertPublishEnabled();
    const result = await backfill();
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
