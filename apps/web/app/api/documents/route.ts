import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse, HttpError } from "@/lib/api/http";
import { listDocuments } from "@/lib/documents";
import { MAX_DOC_BYTES, hasAllowedExtension } from "@/lib/ingest/constants";
import { readPathDoor } from "@/lib/ingest/path-door";
import { ingestDocument, type IngestResult } from "@/lib/ingest/service";
import { phoneEnabled } from "@/lib/voice/config";
import { ensurePhonePin } from "@/lib/voice/phone-pins";
import { fetchUrlDoor } from "@/lib/ingest/url-door";
import { resolveProjectId } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Fields shared by every JSON ingest door. */
const commonFields = {
  project: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
};

/**
 * CLI-push source metadata (§7, §12). Its presence promotes a `{markdown}` body
 * from the paste door to the `cli` door: `source.path` becomes `source_path`
 * (which drives supersede-on-re-push, §6) and `source.host` is recorded for
 * round-trip context.
 */
const sourceSchema = z.object({
  path: z.string().trim().min(1).optional(),
  host: z.string().trim().min(1).optional(),
});

const pasteSchema = z.object({ markdown: z.string(), source: sourceSchema.optional(), ...commonFields });
const pathSchema = z.object({ path: z.string().min(1), ...commonFields });
const urlSchema = z.object({ url: z.string().min(1), ...commonFields });

function ingestResponse(result: IngestResult): NextResponse {
  // Waypoint Voice (Q7): a review with questions gets its phone PIN at push.
  // It is only reported once calling in is set up, so it never names a dead end.
  const pin = ensurePhonePin(result.id);
  return NextResponse.json(
    {
      id: result.id,
      url: result.url,
      title: result.title,
      warnings: result.warnings,
      ...(pin && phoneEnabled() ? { phonePin: pin } : {}),
    },
    { status: 201 },
  );
}

/** POST /api/documents — ingest via multipart file | {markdown} | {path} | {url} (§8). */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    // --- Upload door: multipart/form-data ---
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new HttpError(400, "no_file", "Expected a `file` field in the upload.");
      }
      if (!hasAllowedExtension(file.name)) {
        throw new HttpError(400, "unsupported_file_type", "Only .md, .markdown, and .txt files are accepted.");
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length > MAX_DOC_BYTES) {
        throw new HttpError(413, "file_too_large", "File exceeds the 1 MB ingest limit.");
      }
      const projectId = resolveProjectId({
        projectId: asString(form.get("projectId")),
        project: asString(form.get("project")),
      });
      const result = ingestDocument({
        raw: bytes.toString("utf8"),
        sourceType: "upload",
        title: asString(form.get("title")) ?? null,
        projectId,
      });
      return ingestResponse(result);
    }

    // --- JSON doors: paste / path / url ---
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    if (typeof body !== "object" || body === null) {
      throw new HttpError(400, "invalid_request", "Expected a JSON object.");
    }
    const record = body as Record<string, unknown>;

    if ("markdown" in record) {
      const input = pasteSchema.parse(record);
      if (Buffer.byteLength(input.markdown, "utf8") > MAX_DOC_BYTES) {
        throw new HttpError(413, "document_too_large", "Document exceeds the 1 MB ingest limit.");
      }
      const projectId = resolveProjectId(input);
      // A `source.path` means this came from `waypoint push`: it is the CLI door,
      // and the relative path enables supersede-on-re-push. Absent → paste door.
      const fromCli = Boolean(input.source?.path);
      return ingestResponse(
        ingestDocument({
          raw: input.markdown,
          sourceType: fromCli ? "cli" : "paste",
          title: input.title ?? null,
          sourcePath: input.source?.path ?? null,
          pushedFromHost: input.source?.host ?? null,
          projectId,
        }),
      );
    }

    if ("path" in record) {
      const input = pathSchema.parse(record);
      const { raw, resolvedPath } = readPathDoor(input.path);
      const projectId = resolveProjectId(input);
      return ingestResponse(
        ingestDocument({
          raw,
          sourceType: "path",
          title: input.title ?? null,
          sourcePath: resolvedPath,
          projectId,
        }),
      );
    }

    if ("url" in record) {
      const input = urlSchema.parse(record);
      const { raw, resolvedUrl } = await fetchUrlDoor(input.url);
      const projectId = resolveProjectId(input);
      return ingestResponse(
        ingestDocument({
          raw,
          sourceType: "url",
          title: input.title ?? null,
          sourceUrl: resolvedUrl,
          projectId,
        }),
      );
    }

    throw new HttpError(
      400,
      "no_source",
      "Provide a multipart file, or one of `markdown`, `path`, `url`.",
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** GET /api/documents?status=&project= — the queue listing (§8). */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? undefined;
    const projectId = url.searchParams.get("project") ?? undefined;
    const documents = listDocuments({
      status: status || undefined,
      projectId: projectId || undefined,
    });
    return NextResponse.json({ documents });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** FormData values are `string | File | null`; coerce string-or-absent for helpers. */
function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
