import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// dns.lookup is mocked so URL-door tests never touch the network.
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

import { setupTestDb } from "@/test/db";
import { POST as postDocument } from "@/app/api/documents/route";
import { getDocumentDetail } from "@/lib/documents";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let cleanup: () => void;
let allowedDir: string;
const originalRoots = process.env.WAYPOINT_ALLOWED_ROOTS;

beforeAll(async () => {
  cleanup = await setupTestDb();
  allowedDir = mkdtempSync(path.join(tmpdir(), "waypoint-doors-"));
  writeFileSync(path.join(allowedDir, "plan.md"), "# Allowed\n\nbody");
});

afterEach(() => {
  if (originalRoots === undefined) delete process.env.WAYPOINT_ALLOWED_ROOTS;
  else process.env.WAYPOINT_ALLOWED_ROOTS = originalRoots;
  vi.unstubAllGlobals();
  lookupMock.mockReset();
});

afterAll(() => {
  cleanup?.();
  rmSync(allowedDir, { recursive: true, force: true });
});

describe("path door via POST /api/documents (§15)", () => {
  it("is disabled (403) when WAYPOINT_ALLOWED_ROOTS is unset", async () => {
    delete process.env.WAYPOINT_ALLOWED_ROOTS;
    const res = await postDocument(jsonRequest({ path: "/etc/passwd" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("path_door_disabled");
  });

  it("rejects an absolute path outside the allowed roots", async () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedDir;
    const res = await postDocument(jsonRequest({ path: "/etc/passwd" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("path_not_allowed");
  });

  it("rejects a .. traversal out of an allowed root", async () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedDir;
    const res = await postDocument(
      jsonRequest({ path: path.join(allowedDir, "..", "..", "etc", "hosts") }),
    );
    expect([403, 404, 400]).toContain(res.status);
    expect((await res.json()).error.code).not.toBe(undefined);
  });

  it("reads a file inside an allowed root", async () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedDir;
    const res = await postDocument(jsonRequest({ path: path.join(allowedDir, "plan.md") }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const detail = getDocumentDetail(id);
    expect(detail!.sourceType).toBe("path");
    expect(detail!.rawMd).toBe("# Allowed\n\nbody");
  });
});

describe("url door via POST /api/documents (§15)", () => {
  const stubFetch = (impl: typeof fetch) => vi.stubGlobal("fetch", vi.fn(impl));

  it("rejects a response over the 1 MB cap", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    stubFetch(async () =>
      new Response("hi", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(3 * 1024 * 1024) },
      }),
    );
    const res = await postDocument(jsonRequest({ url: "https://example.com/big.md" }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("response_too_large");
  });

  it("rejects a non-text content type", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    stubFetch(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await postDocument(jsonRequest({ url: "https://example.com/x.json" }));
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("unsupported_content_type");
  });

  it("rejects a URL that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.0.10", family: 4 }]);
    stubFetch(async () => new Response("x", { status: 200, headers: { "content-type": "text/plain" } }));
    const res = await postDocument(jsonRequest({ url: "https://internal.example.com/x.md" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("blocked_address");
  });

  it("ingests a public text document", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    stubFetch(async () =>
      new Response("# Remote\n\nbody", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
    );
    const res = await postDocument(jsonRequest({ url: "https://example.com/plan.md" }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const detail = getDocumentDetail(id);
    expect(detail!.sourceType).toBe("url");
    expect(detail!.sourceUrl).toBe("https://example.com/plan.md");
    expect(detail!.rawMd).toBe("# Remote\n\nbody");
  });
});
