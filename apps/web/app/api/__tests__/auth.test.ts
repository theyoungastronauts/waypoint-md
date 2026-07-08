import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { middleware } from "@/middleware";
import { SESSION_COOKIE } from "@/lib/auth";
import { POST as login } from "@/app/api/auth/login/route";

const TOKEN = "s3cret-token";

function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.WAYPOINT_TOKEN;
  else process.env.WAYPOINT_TOKEN = value;
}

afterEach(() => setToken(undefined));

/** Build a NextRequest for a path with optional bearer / cookie credentials. */
function req(path: string, opts: { bearer?: string; cookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  return new NextRequest(`http://localhost${path}`, { headers });
}

const allowed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const isRedirectToLogin = (r: Response) =>
  (r.status === 307 || r.status === 308) && (r.headers.get("location") ?? "").includes("/login");

describe("auth middleware — open mode (no token)", () => {
  it("allows every route when WAYPOINT_TOKEN is unset", () => {
    setToken(undefined);
    expect(allowed(middleware(req("/api/documents")))).toBe(true);
    expect(allowed(middleware(req("/")))).toBe(true);
    expect(allowed(middleware(req("/d/abc")))).toBe(true);
  });
});

describe("auth middleware — enforced mode (token set)", () => {
  it("keeps /api/health open in both modes", () => {
    setToken(TOKEN);
    expect(allowed(middleware(req("/api/health")))).toBe(true);
  });

  it("keeps the login route and login page open", () => {
    setToken(TOKEN);
    expect(allowed(middleware(req("/api/auth/login")))).toBe(true);
    expect(allowed(middleware(req("/login")))).toBe(true);
  });

  it("rejects an API call with no credentials (401)", () => {
    setToken(TOKEN);
    expect(middleware(req("/api/documents")).status).toBe(401);
  });

  it("rejects an API call with a wrong bearer token (401)", () => {
    setToken(TOKEN);
    expect(middleware(req("/api/documents", { bearer: "nope" })).status).toBe(401);
  });

  it("accepts an API call with the correct bearer token", () => {
    setToken(TOKEN);
    expect(allowed(middleware(req("/api/documents", { bearer: TOKEN })))).toBe(true);
  });

  it("accepts an API call carrying a valid session cookie", () => {
    setToken(TOKEN);
    expect(allowed(middleware(req("/api/documents", { cookie: TOKEN })))).toBe(true);
  });

  it("rejects an API call carrying a wrong session cookie (401)", () => {
    setToken(TOKEN);
    expect(middleware(req("/api/documents", { cookie: "wrong" })).status).toBe(401);
  });

  it("redirects an unauthenticated page visit to /login with a return path", () => {
    setToken(TOKEN);
    const res = middleware(req("/d/abc123"));
    expect(isRedirectToLogin(res)).toBe(true);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/d/abc123");
  });

  it("allows a page visit carrying a valid session cookie", () => {
    setToken(TOKEN);
    expect(allowed(middleware(req("/d/abc123", { cookie: TOKEN })))).toBe(true);
  });
});

describe("POST /api/auth/login (cookie exchange)", () => {
  function loginRequest(body: unknown): Request {
    return new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 when auth is disabled (no token configured)", async () => {
    setToken(undefined);
    const res = await login(loginRequest({ token: "anything" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("auth_disabled");
  });

  it("sets an httpOnly session cookie for the correct token", async () => {
    setToken(TOKEN);
    const res = await login(loginRequest({ token: TOKEN }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=${TOKEN}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("omits Secure by default (plain-HTTP LAN/Tailscale deployments)", async () => {
    setToken(TOKEN);
    delete process.env.WAYPOINT_COOKIE_SECURE;
    const res = await login(loginRequest({ token: TOKEN }));
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).not.toContain("secure");
  });

  it("sets Secure when WAYPOINT_COOKIE_SECURE is enabled", async () => {
    setToken(TOKEN);
    process.env.WAYPOINT_COOKIE_SECURE = "1";
    try {
      const res = await login(loginRequest({ token: TOKEN }));
      expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("secure");
    } finally {
      delete process.env.WAYPOINT_COOKIE_SECURE;
    }
  });

  it("rejects the wrong token with 401 and sets no cookie", async () => {
    setToken(TOKEN);
    const res = await login(loginRequest({ token: "wrong" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_token");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
