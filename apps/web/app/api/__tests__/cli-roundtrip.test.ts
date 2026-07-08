import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "@/test/db";

// Real route handlers — the CLI drives these through a fetch stub.
import { POST as postDocument, GET as listDocumentsRoute } from "@/app/api/documents/route";
import { GET as getDocumentRoute, PATCH as patchDocument } from "@/app/api/documents/[id]/route";
import { GET as exportRoute } from "@/app/api/documents/[id]/export/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { getDocumentDetail } from "@/lib/documents";

// CLI command logic + helpers (relative — the CLI is a sibling workspace package).
import { runPush } from "../../../../../packages/cli/src/commands/push";
import { runPull } from "../../../../../packages/cli/src/commands/pull";
import { readPointer } from "../../../../../packages/cli/src/pointer";
import type { ResolvedConfig } from "../../../../../packages/cli/src/config";

/** Route the CLI client's fetch calls to the real handlers (§8 surface). */
async function dispatch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
  const u = new URL(url);
  const method = init?.method ?? "GET";
  const req = new Request(url, init as RequestInit);

  if (u.pathname === "/api/health") return healthRoute();
  if (u.pathname === "/api/documents" && method === "POST") return postDocument(req);
  if (u.pathname === "/api/documents" && method === "GET") return listDocumentsRoute(req);

  const m = u.pathname.match(/^\/api\/documents\/([^/]+)(\/export)?$/);
  if (m) {
    const params = Promise.resolve({ id: m[1] });
    if (m[2] === "/export") return exportRoute(req, { params });
    if (method === "GET") return getDocumentRoute(req, { params });
    if (method === "PATCH") return patchDocument(req, { params });
  }
  throw new Error(`no route for ${method} ${u.pathname}`);
}

let cleanupDb: () => void;
let projectRoot: string;
let home: string;
let prevHome: string | undefined;

beforeAll(async () => {
  cleanupDb = await setupTestDb();
});
afterAll(() => cleanupDb?.());

const io = { log: () => {}, warn: () => {}, error: () => {} };

function config(): ResolvedConfig {
  return { url: "http://test.local", publicUrl: "http://test.local", projectRoot };
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("CLI push → pull round-trip against real handlers", () => {
  it("ingests via the CLI door, exports beside the source byte-identically, and marks pulled", async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "waypoint-rt-proj-"));
    home = mkdtempSync(path.join(tmpdir(), "waypoint-rt-home-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;

    const source = "docs/plan.md";
    const sourceBytes = "# Plan\n\nSome body text.\n";
    const sourceAbs = path.join(projectRoot, source);
    mkdirSync(path.dirname(sourceAbs), { recursive: true });
    writeFileSync(sourceAbs, sourceBytes, "utf8");

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
        dispatch(String(url), init),
      ),
    );

    // Push it.
    await runPush(sourceAbs, {}, { config: config(), io });
    const pointer = readPointer(projectRoot);
    expect(pointer?.id).toBeTruthy();
    const id = pointer!.id;

    // The CLI door recorded the relative source + host, sourceType "cli".
    const stored = getDocumentDetail(id)!;
    expect(stored.sourceType).toBe("cli");
    expect(stored.sourcePath).toBe(source);
    expect(stored.rawMd).toBe(sourceBytes);

    // Pull it back beside the source.
    await runPull(undefined, {}, { config: config(), io });

    const reviewPath = path.join(projectRoot, "docs", "plan.review.md");
    // No responses => applyReview(raw, {}) === raw, byte-identical (§11).
    expect(readFileSync(reviewPath, "utf8")).toBe(sourceBytes);

    // Pointer cleared and document marked pulled.
    expect(readPointer(projectRoot)).toBeNull();
    expect(getDocumentDetail(id)!.status).toBe("pulled");
  });
});
