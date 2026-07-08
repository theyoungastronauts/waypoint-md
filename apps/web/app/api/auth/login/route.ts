import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { SESSION_COOKIE, authEnabled, credentialAuthorizes } from "@/lib/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().min(1) });

// 30 days. The session cookie value is the token itself — httpOnly, so client JS
// can never read it, and it is never written to the DB (§15). A stolen cookie is
// exactly a stolen token: the same blast radius as the bearer the CLI already
// holds, which keeps the single-token model consistent across web and CLI.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * POST /api/auth/login — exchange the shared token for an httpOnly session
 * cookie (§8, §15). An open path (reachable without an existing session);
 * middleware never guards it. When no server token is configured there is
 * nothing to log into, so the exchange is refused with a clear message.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    if (!authEnabled()) {
      throw new HttpError(
        400,
        "auth_disabled",
        "This server has no WAYPOINT_TOKEN configured; auth is open and login is unnecessary.",
      );
    }

    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const { token } = bodySchema.parse(body);

    if (!credentialAuthorizes(token)) {
      throw new HttpError(401, "invalid_token", "That token was not accepted.");
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
