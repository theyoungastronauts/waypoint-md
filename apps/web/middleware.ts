import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  authEnabled,
  bearerToken,
  credentialAuthorizes,
  isOpenPath,
} from "@/lib/auth";

/**
 * The central auth gate (§15). Every route is covered by default: the matcher
 * below takes in everything except Next's static assets, and only the paths in
 * `isOpenPath` (health + login) skip the check. A new route is protected the
 * moment it exists — nothing has to opt in, which is the property the plan asks
 * for ("routes must opt out").
 */
export function middleware(req: NextRequest): NextResponse {
  // Open mode: no token configured, auth waived. The loud startup warning that
  // accompanies this lives in instrumentation.ts (server log at boot).
  if (!authEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();

  const presented =
    bearerToken(req.headers.get("authorization")) ??
    req.cookies.get(SESSION_COOKIE)?.value ??
    null;

  if (credentialAuthorizes(presented)) return NextResponse.next();

  // API callers (CLI, client fetch) get a machine-readable 401; browsers get
  // bounced to the login page with a return path.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing or invalid credentials." } },
      { status: 401 },
    );
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next internals and static files — API routes and pages
  // alike. Auth logic itself decides what is open.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
