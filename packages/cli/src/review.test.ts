import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedConfig } from "./config";
import { runLinks } from "./commands/links";
import { findComment, runResolve } from "./commands/resolve";
import { publicationLine, runStatus } from "./commands/status";
import { runPull } from "./commands/pull";
import { CliError } from "./io";
import {
  annotatedResponse,
  capturingIo,
  jsonResponse,
  stubFetch,
  tmpDir,
  withTempHome,
  type CapturedIo,
  type FetchCall,
} from "./testkit";

/**
 * The review commands (§ media spec Phase C, decision C-6): minting links,
 * resolving notes, listing publications, and pulling a media digest. All against
 * a stubbed server — these tests are about what the CLI sends and prints.
 */

describe("review commands", () => {
  let home: ReturnType<typeof withTempHome>;
  let project: ReturnType<typeof tmpDir>;
  let io: CapturedIo;
  let cwd: string;

  function config(): ResolvedConfig {
    return {
      url: "http://server:3000",
      publicUrl: "http://server:3000",
      token: "tok",
      projectRoot: project.dir,
    };
  }

  const deps = () => ({ config: config(), io: io.io });
  const health = () => jsonResponse({ status: "ok", version: "0.1.0", specVersion: "1.2.0" });

  beforeEach(() => {
    home = withTempHome();
    project = tmpDir("project");
    io = capturingIo();
    cwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(cwd);
    project.cleanup();
    home.restore();
    vi.unstubAllGlobals();
  });

  describe("waypoint links", () => {
    it("mints a link for a named reviewer and prints its URL", async () => {
      const calls = stubFetch(() =>
        jsonResponse(
          {
            link: {
              id: "link-1",
              reviewerName: "Jay",
              token: "abc",
              createdAt: "2026-09-15T00:00:00.000Z",
              lastSeenAt: null,
              revoked: false,
              url: "https://review.tylersavery.com/r/pub-1?k=abc",
            },
          },
          201,
        ),
      );

      await runLinks("pub-1", { add: "  Jay  " }, deps());

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://server:3000/api/publications/pub-1/review-links");
      expect(calls[0].method).toBe("POST");
      expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ name: "Jay" });
      expect(io.text()).toContain("https://review.tylersavery.com/r/pub-1?k=abc");
    });

    it("refuses an empty name rather than minting an unattributed link", async () => {
      stubFetch(() => jsonResponse({}));
      await expect(runLinks("pub-1", { add: "   " }, deps())).rejects.toBeInstanceOf(CliError);
    });

    it("refuses --add together with --revoke", async () => {
      stubFetch(() => jsonResponse({}));
      await expect(
        runLinks("pub-1", { add: "Jay", revoke: "link-1" }, deps()),
      ).rejects.toBeInstanceOf(CliError);
    });

    it("lists links, hiding the URL of a revoked one", async () => {
      stubFetch(() =>
        jsonResponse({
          links: [
            {
              id: "link-1aaaaaa",
              reviewerName: "Jay",
              token: "abc",
              createdAt: "2026-09-15T00:00:00.000Z",
              lastSeenAt: "2026-09-15T01:00:00.000Z",
              revoked: false,
              url: "https://review.tylersavery.com/r/pub-1?k=abc",
            },
            {
              id: "link-2bbbbbb",
              reviewerName: "Aaron",
              token: "def",
              createdAt: "2026-09-15T00:00:00.000Z",
              lastSeenAt: null,
              revoked: true,
              url: "https://review.tylersavery.com/r/pub-1?k=def",
            },
          ],
        }),
      );

      await runLinks("pub-1", {}, deps());
      const text = io.text();
      expect(text).toContain("2 review link(s)");
      expect(text).toContain("k=abc");
      expect(text).toContain("revoked");
      expect(text).not.toContain("k=def");
    });

    it("says so plainly when there are none", async () => {
      stubFetch(() => jsonResponse({ links: [] }));
      await runLinks("pub-1", {}, deps());
      expect(io.text()).toContain("No review links yet");
    });

    it("revokes by id", async () => {
      const calls = stubFetch(() =>
        jsonResponse({
          link: {
            id: "link-1",
            reviewerName: "Jay",
            token: "abc",
            createdAt: "2026-09-15T00:00:00.000Z",
            lastSeenAt: null,
            revoked: true,
            url: "https://review.tylersavery.com/r/pub-1?k=abc",
          },
        }),
      );

      await runLinks("pub-1", { revoke: "link-1" }, deps());
      expect(calls[0].url).toBe(
        "http://server:3000/api/publications/pub-1/review-links/link-1/revoke",
      );
      expect(io.text()).toContain("Revoked");
    });
  });

  describe("waypoint resolve", () => {
    const comments = [
      {
        id: "aaaa1111-0000-0000-0000-000000000000",
        ordinal: 1,
        authorName: "Jay",
        timecodeMs: null,
        body: "overall pace is right",
        createdAt: "2026-09-15T00:00:00.000Z",
        resolved: false,
      },
      {
        id: "bbbb2222-0000-0000-0000-000000000000",
        ordinal: 2,
        authorName: "Jay",
        timecodeMs: 12_400,
        body: "the wordmark lands too late here",
        createdAt: "2026-09-15T00:01:00.000Z",
        resolved: false,
      },
    ];

    function stub(): FetchCall[] {
      return stubFetch((call) => {
        if (call.url.endsWith("/comments")) return jsonResponse({ comments });
        return jsonResponse({ comment: { ...comments[1], resolved: true } });
      });
    }

    it("resolves the note the digest calls c2", async () => {
      const calls = stub();
      await runResolve("pub-1", "c2", deps());

      expect(calls.map((c) => c.url)).toEqual([
        "http://server:3000/api/publications/pub-1/comments",
        `http://server:3000/api/publications/pub-1/comments/${comments[1].id}/resolve`,
      ]);
      expect(io.text()).toContain("Resolved c2");
    });

    it("also takes a full id or an unambiguous prefix", async () => {
      const calls = stub();
      await runResolve("pub-1", "bbbb2222", deps());
      expect(calls[1].url).toContain(comments[1].id);
    });

    it("says nothing changed when the note is already resolved", async () => {
      const calls = stubFetch(() =>
        jsonResponse({ comments: [{ ...comments[0], resolved: true }] }),
      );
      await runResolve("pub-1", "c1", deps());
      expect(calls).toHaveLength(1);
      expect(io.text()).toContain("already resolved");
    });

    it("explains an out-of-range digest number instead of guessing", async () => {
      stub();
      await expect(runResolve("pub-1", "c9", deps())).rejects.toThrow(/No note c9/);
    });

    it("refuses an ambiguous prefix", () => {
      expect(() =>
        findComment(
          [
            { ...comments[0], id: "aaaa1111" },
            { ...comments[1], id: "aaaa2222" },
          ],
          "aaaa",
        ),
      ).toThrow(/matches 2 notes/);
    });
  });

  describe("waypoint status --publications", () => {
    it("lists renders with their stack, date, and open notes", async () => {
      stubFetch((call) => {
        if (call.url.endsWith("/api/health")) return health();
        return jsonResponse({
          publications: [
            {
              id: "pub-1aaaaaaa",
              kind: "media",
              title: "vBTC Unwrapped",
              createdAt: "2026-09-14T00:00:00.000Z",
              revoked: false,
              group: "vbtc-unwrapped",
              label: "v2",
              unresolved: 3,
            },
            {
              id: "pub-2bbbbbbb",
              kind: "markdown",
              title: "The plan",
              createdAt: "2026-09-10T00:00:00.000Z",
              revoked: false,
            },
          ],
        });
      });

      await runStatus(deps(), { publications: true });
      const text = io.text();
      expect(text).toContain("2 publication(s)");
      expect(text).toContain("vbtc-unwrapped/v2");
      expect(text).toContain("(3 open)");
      expect(text).toContain("3 unresolved review note(s)");
    });

    it("leaves the document listing exactly as it was by default", async () => {
      stubFetch((call) => {
        if (call.url.endsWith("/api/health")) return health();
        return jsonResponse({
          documents: [
            {
              id: "doc-1aaaaaaa",
              title: "A plan",
              status: "completed",
              sourceType: "cli",
              projectId: null,
              projectName: null,
              createdAt: "2026-09-14T00:00:00.000Z",
              updatedAt: "2026-09-14T00:00:00.000Z",
            },
          ],
        });
      });

      await runStatus(deps());
      expect(io.text()).toContain("1 document(s)");
      expect(io.text()).toContain("doc-1aaa  completed");
    });

    it("says so when the registry is empty", async () => {
      stubFetch((call) =>
        call.url.endsWith("/api/health") ? health() : jsonResponse({ publications: [] }),
      );
      await runStatus(deps(), { publications: true });
      expect(io.text()).toContain("No publications yet");
    });
  });

  describe("publicationLine", () => {
    it("marks a revoked publication rather than its note count", () => {
      const line = publicationLine({
        id: "pub-1aaaaaaa",
        kind: "media",
        title: "vBTC Unwrapped",
        createdAt: "2026-09-14T00:00:00.000Z",
        revoked: true,
        unresolved: 2,
      });
      expect(line).toContain("(revoked)");
      expect(line).not.toContain("open");
    });
  });

  describe("waypoint pull <publication-id> --digest", () => {
    it("writes the media digest in the current directory and stops there", async () => {
      process.chdir(project.dir);
      const digest = "---\nwaypoint_digest: 1\nkind: media\n---\n\n# Digest — vBTC Unwrapped\n";
      const calls = stubFetch((call) => {
        if (call.url.endsWith("/api/health")) return health();
        if (call.url.includes("/api/documents/")) {
          return jsonResponse({ error: { code: "not_found", message: "No document." } }, 404);
        }
        return annotatedResponse(digest, "vbtc-unwrapped-v2.digest.md");
      });

      await runPull("pub-1", { digest: true }, deps());

      const written = path.join(project.dir, "vbtc-unwrapped-v2.digest.md");
      expect(existsSync(written)).toBe(true);
      expect(readFileSync(written, "utf8")).toBe(digest);

      // No PATCH to mark anything pulled: a publication has no review lifecycle.
      expect(calls.some((c) => c.method === "PATCH")).toBe(false);
      expect(calls.at(-1)?.url).toBe(
        "http://server:3000/api/publications/pub-1/export?format=digest",
      );
    });

    it("points at --digest when a publication id is pulled without it", async () => {
      stubFetch((call) =>
        call.url.endsWith("/api/health")
          ? health()
          : jsonResponse({ error: { code: "not_found", message: "No document." } }, 404),
      );

      await expect(runPull("pub-1", {}, deps())).rejects.toThrow(/--digest/);
    });

    it("still surfaces a non-404 document failure unchanged", async () => {
      stubFetch((call) =>
        call.url.endsWith("/api/health")
          ? health()
          : jsonResponse({ error: { code: "internal_error", message: "Boom." } }, 500),
      );

      await expect(runPull("doc-1", { digest: true }, deps())).rejects.toThrow(/Boom/);
    });
  });
});
