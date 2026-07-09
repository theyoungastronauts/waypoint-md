import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { listPublications, toPublicationSummary } from "@/lib/publications";
import { publicationUrls } from "@/lib/publish/paths";
import { assertPublishEnabled } from "@/lib/publish/guard";
import { publish } from "@/lib/publish/service";

export const dynamic = "force-dynamic";

/**
 * CLI-publish source hint. Its presence (the `waypoint publish` verb sends
 * `{ host }`) records `origin = "cli"` + `source_host`; absent → `origin = "api"`.
 * Mirrors how the documents door promotes a paste to a CLI push.
 */
const sourceSchema = z.object({ host: z.string().trim().min(1).optional() });

const createSchema = z.object({
  markdown: z.string().min(1, "markdown is required."),
  filename: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  source: sourceSchema.optional(),
});

/** POST /api/publications — render + upload + index → `{ id, title, urls }`. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertPublishEnabled();
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const input = createSchema.parse(body);

    const row = await publish({
      markdown: input.markdown,
      filename: input.filename ?? null,
      title: input.title ?? null,
      origin: input.source ? "cli" : "api",
      sourceHost: input.source?.host ?? null,
    });

    return NextResponse.json(
      {
        id: row.id,
        title: row.title,
        urls: publicationUrls(row.publicBase, row.r2Folder, row.sanitizedName),
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** GET /api/publications?q=&limit= — registry listing, newest first. */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    assertPublishEnabled();
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw !== null && limitRaw !== "" ? Number(limitRaw) : undefined;

    const rows = listPublications({ q, limit });
    return NextResponse.json({ publications: rows.map(toPublicationSummary) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
