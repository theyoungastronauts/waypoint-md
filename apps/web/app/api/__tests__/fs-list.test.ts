import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/fs/list/route";
import { isOpenPath } from "@/lib/auth";
import { middleware } from "@/middleware";

// A home tree rooted in a temp dir; `os.homedir()` is stubbed to point at it so
// the containment boundary is exercised without touching the real home dir.
let base: string;
let home: string;
let outside: string;

beforeAll(() => {
  // realpath up front so cwd assertions are stable on macOS (/var → /private/var).
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "waypoint-fs-list-")));
  home = path.join(base, "home");
  outside = path.join(base, "outside");
  mkdirSync(path.join(home, "prj", "nested"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(home, "readme.md"), "x");
  writeFileSync(path.join(home, ".hidden"), "x");
  writeFileSync(path.join(home, "prj", "a.ts"), "x");
  writeFileSync(path.join(outside, "secret.md"), "x");
  // A directory symlink that lives inside home but resolves outside it.
  symlinkSync(outside, path.join(home, "escape"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

/** Call the route handler for a given querystring and read status + JSON body. */
async function list(query = "") {
  const res = GET(new Request(`http://localhost/api/fs/list${query}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/fs/list — home-scoped listing (decision B-5)", () => {
  it("lists the home root: cwd '~', no parent, dirs before files", async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.cwd).toBe("~");
    expect(body.parent).toBeNull();

    const names = body.entries.map((e: { name: string }) => e.name);
    expect(names).toContain("prj");
    expect(names).toContain("readme.md");
    // Dotfile hidden by default; escaping symlink never surfaced.
    expect(names).not.toContain(".hidden");
    expect(names).not.toContain("escape");

    // Directories sort ahead of files.
    expect(body.entries[0]).toMatchObject({ name: "prj", type: "dir" });
    // Every entry's path is already home-relative.
    for (const entry of body.entries) expect(entry.path.startsWith("~/")).toBe(true);
  });

  it("navigates into a subdirectory", async () => {
    const { status, body } = await list("?path=~/prj");
    expect(status).toBe(200);
    expect(body.cwd).toBe("~/prj");
    expect(body.parent).toBe("~");
    expect(body.entries).toEqual([
      { name: "nested", type: "dir", path: "~/prj/nested" },
      { name: "a.ts", type: "file", path: "~/prj/a.ts" },
    ]);
  });

  it("includes dotfiles with all=1", async () => {
    const { status, body } = await list("?path=~&all=1");
    expect(status).toBe(200);
    expect(body.entries.map((e: { name: string }) => e.name)).toContain(".hidden");
  });

  it("rejects a .. traversal that escapes home (403)", async () => {
    const { status, body } = await list("?path=~/../outside");
    expect(status).toBe(403);
    expect(body.error.code).toBe("path_not_allowed");
  });

  it("rejects a symlink that points outside home (403)", async () => {
    const { status, body } = await list("?path=~/escape");
    expect(status).toBe(403);
    expect(body.error.code).toBe("path_not_allowed");
  });

  it("returns not_found for a missing directory (404)", async () => {
    const { status, body } = await list("?path=~/nope");
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns not_a_directory when the path is a file (400)", async () => {
    const { status, body } = await list("?path=~/readme.md");
    expect(status).toBe(400);
    expect(body.error.code).toBe("not_a_directory");
  });

  it("rejects a null byte in the path (400)", async () => {
    const { status, body } = await list(`?path=${encodeURIComponent("a\0b")}`);
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_path");
  });
});

describe("/api/fs/list is auth-covered (not open)", () => {
  const TOKEN = "s3cret-token";

  afterEach(() => delete process.env.WAYPOINT_TOKEN);

  function req(pathname: string, bearer?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return new NextRequest(`http://localhost${pathname}`, { headers });
  }

  it("is absent from the open-path allowlist", () => {
    expect(isOpenPath("/api/fs/list")).toBe(false);
  });

  it("rejects an unauthenticated call when a token is configured (401)", () => {
    process.env.WAYPOINT_TOKEN = TOKEN;
    expect(middleware(req("/api/fs/list")).status).toBe(401);
  });

  it("passes the central gate with the correct bearer token", () => {
    process.env.WAYPOINT_TOKEN = TOKEN;
    expect(middleware(req("/api/fs/list", TOKEN)).headers.get("x-middleware-next")).toBe("1");
  });
});
