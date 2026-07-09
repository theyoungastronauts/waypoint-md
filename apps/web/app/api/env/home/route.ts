import os from "node:os";
import { NextResponse } from "next/server";

// Always fresh — reads the server process's home dir; never cached as a static
// asset. Auth-covered by the central middleware (§15); deliberately NOT added to
// OPEN_PATHS.
export const dynamic = "force-dynamic";

/**
 * GET /api/env/home → `{ home }` (§14, decision B-5). The browser can't know the
 * server's home directory, so the "Attach file" affordance asks for it to
 * rewrite a pasted absolute path under home to `~/…`. Server-only and
 * read-only: it returns the path string from `os.homedir()`; no filesystem is
 * touched and nothing is uploaded.
 */
export function GET(): NextResponse {
  return NextResponse.json({ home: os.homedir() });
}
