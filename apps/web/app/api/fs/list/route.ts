import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api/http";
import { listHomeDir } from "@/lib/fs/list-dir";

// Reads the live filesystem under the server's home dir on every request; never
// a static asset. Auth-covered by the central middleware (§15); deliberately
// NOT added to OPEN_PATHS.
export const dynamic = "force-dynamic";

/**
 * GET /api/fs/list?path=<~/… | absolute>&all=1 → `{ cwd, parent, entries }`
 * (§14). Backs the "Attach file" picker: a home-rooted directory browser that
 * cannot escape home (containment enforced in `lib/fs/list-dir.ts`). Returns
 * names and types only — no file contents are read.
 */
export function GET(req: Request): NextResponse {
  try {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1";
    return NextResponse.json(listHomeDir(url.searchParams.get("path"), { all }));
  } catch (err) {
    return toErrorResponse(err);
  }
}
