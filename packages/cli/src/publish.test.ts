import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedConfig } from "./config";
import { runBackfill, runPublish } from "./commands/publish";
import { capturingIo, jsonResponse, stubFetch, tmpDir, type CapturedIo } from "./testkit";

let project: ReturnType<typeof tmpDir>;
let io: CapturedIo;
let docPath: string;

function config(): ResolvedConfig {
  return {
    url: "http://server:3000",
    publicUrl: "http://public:4000",
    token: "tok",
    projectRoot: project.dir,
  };
}

const publishOk = () =>
  jsonResponse(
    {
      id: "abcd1234-ef56-7890-abcd-ef1234567890",
      title: "My Plan",
      urls: {
        html: "https://dropzone.tylersavery.com/smitty/shares/uuid/my-plan.html",
        pdf: "https://dropzone.tylersavery.com/smitty/shares/uuid/my-plan.pdf",
        md: "https://dropzone.tylersavery.com/smitty/shares/uuid/my-plan.md",
      },
    },
    201,
  );

beforeEach(() => {
  project = tmpDir("proj");
  io = capturingIo();
  docPath = path.join(project.dir, "my-plan.md");
  writeFileSync(docPath, "# My Plan\n\nbody\n", "utf8");
});

afterEach(() => {
  vi.unstubAllGlobals();
  project.cleanup();
});

describe("waypoint publish", () => {
  it("posts the markdown and prints the share output shape", async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/publications") && call.method === "POST") return publishOk();
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPublish(docPath, {}, { config: config(), io: io.io });

    const text = io.text();
    expect(text).toContain("Sharing: My Plan");
    expect(text).toContain("ID: abcd1234");
    expect(text).toContain("Share URLs:");
    expect(text).toContain("  HTML:     https://dropzone.tylersavery.com/smitty/shares/uuid/my-plan.html");
    expect(text).toContain("  PDF:      https://dropzone.tylersavery.com/smitty/shares/uuid/my-plan.pdf");
    expect(text).toContain("  Markdown: https://dropzone.tylersavery.com/smitty/shares/uuid/my-plan.md");

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.headers.authorization).toBe("Bearer tok");
    const body = JSON.parse(post.body!);
    expect(body.markdown).toBe("# My Plan\n\nbody\n");
    expect(body.filename).toBe("my-plan.md");
    expect(body.source.host).toBeTruthy();
  });

  it("passes --title through to the payload", async () => {
    const calls = stubFetch(() => publishOk());
    await runPublish(docPath, { title: "Custom Title" }, { config: config(), io: io.io });
    const post = calls.find((c) => c.method === "POST")!;
    expect(JSON.parse(post.body!).title).toBe("Custom Title");
  });

  it("errors clearly when the file is missing", async () => {
    stubFetch(() => publishOk());
    await expect(
      runPublish(path.join(project.dir, "nope.md"), {}, { config: config(), io: io.io }),
    ).rejects.toThrow(/File not found/);
  });

  it("surfaces publish_unavailable from the server as an error", async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: "publish_unavailable", message: "Publishing is not configured." } }, 400),
    );
    await expect(runPublish(docPath, {}, { config: config(), io: io.io })).rejects.toThrow(/not configured/);
  });
});

describe("waypoint publish --backfill", () => {
  it("calls the backfill endpoint and reports counts", async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/publications/backfill") && call.method === "POST") {
        return jsonResponse({ indexed: 3, skipped: 1 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runBackfill({ config: config(), io: io.io });

    expect(io.text()).toContain("indexed 3, skipped 1");
    expect(calls.some((c) => c.url.endsWith("/api/publications/backfill"))).toBe(true);
  });
});
