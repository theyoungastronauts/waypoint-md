import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { upsertResponse } from "@/lib/responses";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The autosave payload (§9): the current answer body plus an explicit status.
 * `status: null` clears the status back to untouched; omitting `value` fields is
 * fine (a status-only change, e.g. flag). `.strip()` drops unknown keys rather
 * than rejecting, so a slightly richer client payload never fails autosave.
 */
const bodySchema = z.object({
  value: z
    .object({
      text: z.string().optional(),
      selected: z.array(z.string()).optional(),
      other: z.string().optional(),
    })
    .strip()
    .optional(),
  status: z.enum(["answered", "flagged", "skipped"]).nullable().optional(),
});

/** PUT /api/items/:id/response — upsert the reviewer's answer + status (§8). */
export async function PUT(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = bodySchema.parse(body);

    const stored = upsertResponse(id, input.value ?? {}, input.status ?? null);
    if (!stored) {
      throw new HttpError(404, "not_found", "No item with that id.");
    }
    return NextResponse.json({ response: stored });
  } catch (err) {
    return toErrorResponse(err);
  }
}
