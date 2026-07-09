import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedConfig } from "./config";
import { reviewTargetPath, runPull } from "./commands/pull";
import { readPointer, writePointer } from "./pointer";
import {
  annotatedResponse,
  capturingIo,
  jsonResponse,
  stubFetch,
  tmpDir,
  withTempHome,
  type CapturedIo,
} from "./testkit";

describe("reviewTargetPath", () => {
  it("places the review beside its source", () => {
    const target = reviewTargetPath("/repo", "docs/plan.md", "plan.review.md", "id1");
    expect(target).toBe(path.resolve("/repo", "docs", "plan.review.md"));
  });

  it("falls back to a server filename in cwd when there is no source path", () => {
    const target = reviewTargetPath("/repo", null, "thing.review.md", "id1");
    expect(target).toBe(path.resolve(process.cwd(), "thing.review.md"));
  });

  it("uses <id>.review.md when the server sends no filename", () => {
    const target = reviewTargetPath("/repo", null, "", "abc123");
    expect(target).toBe(path.resolve(process.cwd(), "abc123.review.md"));
  });
});

describe("waypoint pull", () => {
  let home: ReturnType<typeof withTempHome>;
  let project: ReturnType<typeof tmpDir>;
  let io: CapturedIo;

  function config(): ResolvedConfig {
    return {
      url: "http://server:3000",
      publicUrl: "http://server:3000",
      token: "tok",
      projectRoot: project.dir,
    };
  }

  const health = () => jsonResponse({ status: "ok", version: "0.1.0", specVersion: "1.0.0" });

  beforeEach(() => {
    home = withTempHome();
    project = tmpDir("proj");
    io = capturingIo();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    home.restore();
    project.cleanup();
  });

  it("writes the annotated file beside the source, clears the pointer, and marks pulled", async () => {
    writePointer(project.dir, { id: "doc123", source: "docs/plan.md", pushedAt: "2026-07-07T00:00:00Z" });

    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return health();
      if (call.url.includes("/export")) return annotatedResponse("# Reviewed\n\nanswered.\n", "plan.review.md");
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "GET") {
        return jsonResponse({ document: { id: "doc123", sourcePath: "docs/plan.md", items: [] } });
      }
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "PATCH") {
        return jsonResponse({ document: { id: "doc123", status: "pulled" } });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPull(undefined, {}, { config: config(), io: io.io });

    const written = path.join(project.dir, "docs", "plan.review.md");
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain("# Reviewed");

    // Pointer cleared.
    expect(readPointer(project.dir)).toBeNull();

    // Marked pulled via PATCH { status: "pulled" }.
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch!.body!).status).toBe("pulled");
  });

  it("with --digest writes both files beside the source and still marks pulled", async () => {
    writePointer(project.dir, { id: "doc123", source: "docs/plan.md", pushedAt: "2026-07-07T00:00:00Z" });

    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return health();
      if (call.url.includes("/export") && call.url.includes("format=digest")) {
        return annotatedResponse("---\nwaypoint_digest: 1\n---\n\n# Digest\n", "plan.digest.md");
      }
      if (call.url.includes("/export")) return annotatedResponse("# Reviewed\n", "plan.review.md");
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "GET") {
        return jsonResponse({ document: { id: "doc123", sourcePath: "docs/plan.md", items: [] } });
      }
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "PATCH") {
        return jsonResponse({ document: { id: "doc123", status: "pulled" } });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPull(undefined, { digest: true }, { config: config(), io: io.io });

    const annotated = path.join(project.dir, "docs", "plan.review.md");
    const digest = path.join(project.dir, "docs", "plan.digest.md");
    expect(readFileSync(annotated, "utf8")).toContain("# Reviewed");
    expect(readFileSync(digest, "utf8")).toContain("waypoint_digest: 1");

    // No Phase 5 regression: pointer cleared and doc marked pulled.
    expect(readPointer(project.dir)).toBeNull();
    expect(calls.some((c) => c.method === "PATCH" && JSON.parse(c.body!).status === "pulled")).toBe(true);
  });

  it("without --digest writes only the annotated file (no digest fetch)", async () => {
    writePointer(project.dir, { id: "doc123", source: "docs/plan.md", pushedAt: "2026-07-07T00:00:00Z" });

    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return health();
      if (call.url.includes("/export")) return annotatedResponse("# Reviewed\n", "plan.review.md");
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "GET") {
        return jsonResponse({ document: { id: "doc123", sourcePath: "docs/plan.md", items: [] } });
      }
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "PATCH") {
        return jsonResponse({ document: { id: "doc123", status: "pulled" } });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPull(undefined, {}, { config: config(), io: io.io });

    expect(existsSync(path.join(project.dir, "docs", "plan.digest.md"))).toBe(false);
    expect(calls.every((c) => !c.url.includes("format=digest"))).toBe(true);
  });

  it("materializes attachments into <name>.attachments/ beside the review file", async () => {
    writePointer(project.dir, { id: "doc123", source: "docs/plan.md", pushedAt: "2026-07-07T00:00:00Z" });

    stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return health();
      // Attachment bytes stream — matched before the doc/export routes.
      if (call.url.includes("/api/attachments/att-1")) {
        return new Response(Buffer.from("IMG-BYTES"), { status: 200 });
      }
      if (call.url.includes("/export")) {
        return annotatedResponse(
          "# Reviewed\n\n_Attachment: ![shot](plan.attachments/att-1234-shot.png)_\n",
          "plan.review.md",
        );
      }
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "GET") {
        return jsonResponse({
          document: {
            id: "doc123",
            sourcePath: "docs/plan.md",
            items: [
              {
                id: "it1",
                response: { status: "answered" },
                attachments: [{ id: "att-1", filename: "shot.png", exportName: "att-1234-shot.png" }],
              },
            ],
          },
        });
      }
      if (call.url.match(/\/api\/documents\/doc123$/) && call.method === "PATCH") {
        return jsonResponse({ document: { id: "doc123", status: "pulled" } });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPull(undefined, {}, { config: config(), io: io.io });

    const written = path.join(project.dir, "docs", "plan.attachments", "att-1234-shot.png");
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written)).toEqual(Buffer.from("IMG-BYTES"));

    // No regression: the review file is still written and the doc marked pulled.
    expect(existsSync(path.join(project.dir, "docs", "plan.review.md"))).toBe(true);
    expect(readPointer(project.dir)).toBeNull();
  });

  it("resolves --latest via the queue when no id or pointer is given", async () => {
    // sourcePath is null here, so pull falls back to cwd — pin it to the temp
    // project dir so the test never writes into the real working directory.
    vi.spyOn(process, "cwd").mockReturnValue(project.dir);
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return health();
      if (call.url.endsWith("/api/documents") && call.method === "GET") {
        return jsonResponse({
          documents: [{ id: "newest", title: "n", status: "completed", sourceType: "cli", projectId: null, projectName: null, createdAt: "", updatedAt: "" }],
        });
      }
      if (call.url.includes("/export")) return annotatedResponse("x\n", "n.review.md");
      if (call.url.includes("/api/documents/newest") && call.method === "GET") {
        return jsonResponse({ document: { id: "newest", sourcePath: null, items: [] } });
      }
      if (call.url.includes("/api/documents/newest") && call.method === "PATCH") {
        return jsonResponse({ document: { id: "newest", status: "pulled" } });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPull(undefined, { latest: true }, { config: config(), io: io.io });
    expect(calls.some((c) => c.method === "PATCH" && c.url.includes("newest"))).toBe(true);
  });

  it("errors clearly when there is nothing to pull", async () => {
    stubFetch((call) => (call.url.endsWith("/api/health") ? health() : jsonResponse({ documents: [] })));
    await expect(runPull(undefined, {}, { config: config(), io: io.io })).rejects.toThrow(/nothing to pull/i);
  });
});
