import os from "node:os";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { GET as getHome } from "@/app/api/env/home/route";
import { isOpenPath } from "@/lib/auth";
import { middleware } from "@/middleware";

describe("GET /api/env/home (decision B-5)", () => {
  it("returns the server's home directory", async () => {
    const data = await getHome().json();
    expect(data.home).toBe(os.homedir());
    expect(typeof data.home).toBe("string");
    expect(data.home.length).toBeGreaterThan(0);
  });
});

describe("/api/env/home is auth-covered (not open)", () => {
  const TOKEN = "s3cret-token";

  afterEach(() => delete process.env.WAYPOINT_TOKEN);

  function req(path: string, bearer?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return new NextRequest(`http://localhost${path}`, { headers });
  }

  it("is absent from the open-path allowlist", () => {
    expect(isOpenPath("/api/env/home")).toBe(false);
  });

  it("rejects an unauthenticated call when a token is configured (401)", () => {
    process.env.WAYPOINT_TOKEN = TOKEN;
    expect(middleware(req("/api/env/home")).status).toBe(401);
  });

  it("passes the central gate with the correct bearer token", () => {
    process.env.WAYPOINT_TOKEN = TOKEN;
    expect(middleware(req("/api/env/home", TOKEN)).headers.get("x-middleware-next")).toBe("1");
  });
});
