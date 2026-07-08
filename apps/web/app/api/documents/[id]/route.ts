import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import {
  DOCUMENT_STATUSES,
  getDocumentDetail,
  updateDocument,
  type UpdateDocumentPatch,
} from "@/lib/documents";
import { resolveProjectId } from "@/lib/projects";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/documents/:id — document with items, responses, and comments (§8). */
export async function GET(_req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const detail = getDocumentDetail(id);
    if (!detail) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }
    return NextResponse.json({ document: detail });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const patchSchema = z
  .object({
    // `archived` is supersede-automation only — a reviewer/API caller may never
    // set it directly (§6). Accept the rest of the vocabulary.
    status: z
      .enum(DOCUMENT_STATUSES)
      .refine((s) => s !== "archived", {
        message: "`archived` is set only when a newer push supersedes a document.",
      })
      .optional(),
    projectId: z.string().trim().min(1).nullable().optional(),
    project: z.string().trim().min(1).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.projectId !== undefined || v.project !== undefined,
    { message: "Provide at least one of `status`, `projectId`, or `project`." },
  );

/** PATCH /api/documents/:id — status transitions and project reassignment (§8). */
export async function PATCH(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const existing = getDocumentDetail(id);
    if (!existing) {
      throw new HttpError(404, "not_found", "No document with that id.");
    }

    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = patchSchema.parse(body);

    const patch: UpdateDocumentPatch = {};
    if (input.status !== undefined) patch.status = input.status;
    if (input.project !== undefined) {
      patch.projectId = resolveProjectId({ project: input.project });
    } else if (input.projectId !== undefined) {
      // null clears the assignment; a string is validated to exist.
      patch.projectId = input.projectId === null ? null : resolveProjectId({ projectId: input.projectId });
    }

    const updated = updateDocument(id, patch);
    return NextResponse.json({ document: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
