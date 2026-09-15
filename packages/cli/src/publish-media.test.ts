import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `waypoint publish <render.mp4>` (decision B-3). The upload is the part worth
 * pinning down: it must set `Content-Length` and stream the file rather than
 * buffering it, because a fetch body that is a stream goes out chunked and an
 * S3-compatible store rejects a chunked PUT against a presigned URL. So
 * `node:https` is mocked at the module boundary and the request it builds is
 * asserted directly — no bytes ever leave the process.
 */

/** One PUT the mocked `node:https` recorded. */
interface RecordedPut {
  url: string;
  options: { method?: string; headers?: Record<string, string | number> };
  /** Bytes the file stream piped into the request. */
  body: string;
  /** True when the body arrived through `pipe()` rather than one buffered write. */
  piped: boolean;
}

const httpsMock = vi.hoisted(() => ({
  calls: [] as RecordedPut[],
  /** Status the mocked store answers with. */
  status: 200,
  /** Body the mocked store answers with (for the error path). */
  responseBody: "",
  /** When set, the request emits this error instead of responding. */
  requestError: null as Error | null,
  reset() {
    this.calls = [];
    this.status = 200;
    this.responseBody = "";
    this.requestError = null;
  },
}));

vi.mock("node:https", async () => {
  // Imported inside the factory: `vi.mock` is hoisted above the file's imports,
  // so a top-level `EventEmitter` binding would not exist yet when this runs.
  const { EventEmitter } = await import("node:events");

  type ResponseLike = InstanceType<typeof EventEmitter> & { statusCode?: number };

  class FakeRequest extends EventEmitter {
    private chunks: Buffer[] = [];

    constructor(
      private record: RecordedPut,
      private onResponse: (res: ResponseLike) => void,
    ) {
      super();
    }

    write(chunk: Buffer | string) {
      // The real uploader pipes the file, so every write is a stream chunk.
      this.record.piped = true;
      this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      return true;
    }

    end() {
      this.record.body = Buffer.concat(this.chunks).toString("utf8");
      // Answer on the next tick, as a real socket would.
      setImmediate(() => {
        if (httpsMock.requestError) {
          this.emit("error", httpsMock.requestError);
          return;
        }
        const res = new EventEmitter() as ResponseLike;
        res.statusCode = httpsMock.status;
        this.onResponse(res);
        if (httpsMock.responseBody) res.emit("data", Buffer.from(httpsMock.responseBody));
        res.emit("end");
      });
    }

    destroy() {}
  }

  return {
    default: {
      request: (
        url: URL | string,
        options: { method?: string; headers?: Record<string, string | number> },
        onResponse: (res: ResponseLike) => void,
      ) => {
        const record: RecordedPut = { url: String(url), options, body: "", piped: false };
        httpsMock.calls.push(record);
        return new FakeRequest(record, onResponse);
      },
    },
  };
});

import type { ResolvedConfig } from "./config";
import { runPublish } from "./commands/publish";
import { capturingIo, jsonResponse, stubFetch, tmpDir, type CapturedIo, type FetchCall } from "./testkit";

let project: ReturnType<typeof tmpDir>;
let io: CapturedIo;
let renderPath: string;

const RENDER_BODY = "x".repeat(4096);

function config(): ResolvedConfig {
  return {
    url: "http://server:3000",
    publicUrl: "http://public:4000",
    token: "tok",
    projectRoot: project.dir,
  };
}

const CREATED = {
  id: "abcd1234-ef56-7890-abcd-ef1234567890",
  key: "smitty/shares/uuid/spot.mp4",
  uploadUrl: "https://signed.example/smitty/shares/uuid/spot.mp4?sig=stub",
  expiresAt: "2026-09-15T04:00:00.000Z",
};

const FINALIZED = {
  id: CREATED.id,
  title: "Spot",
  kind: "media",
  bytes: 4096,
  urls: {
    file: "https://dropzone.tylersavery.com/smitty/shares/uuid/spot.mp4",
    manifest: null as string | null,
    page: "/publications/abcd1234-ef56-7890-abcd-ef1234567890",
  },
};

/** Route the two API calls the media flow makes; anything else is a test bug. */
function stubMediaApi(finalized: typeof FINALIZED = FINALIZED): FetchCall[] {
  return stubFetch((call) => {
    if (call.url.endsWith("/api/publications/media") && call.method === "POST") {
      return jsonResponse(CREATED, 201);
    }
    if (call.url.endsWith("/finalize") && call.method === "POST") {
      return jsonResponse(finalized);
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  });
}

beforeEach(() => {
  project = tmpDir("proj");
  io = capturingIo();
  renderPath = path.join(project.dir, "spot.mp4");
  writeFileSync(renderPath, RENDER_BODY, "utf8");
  httpsMock.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  project.cleanup();
});

describe("waypoint publish — extension dispatch", () => {
  it("sends a .md file down the markdown flow, untouched", async () => {
    const docPath = path.join(project.dir, "plan.md");
    writeFileSync(docPath, "# Plan\n\nbody\n", "utf8");
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/publications") && call.method === "POST") {
        return jsonResponse(
          {
            id: "doc-1",
            title: "Plan",
            urls: { html: "https://x/plan.html", pdf: "https://x/plan.pdf", md: "https://x/plan.md" },
          },
          201,
        );
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPublish(docPath, {}, { config: config(), io: io.io });

    expect(calls.map((c) => c.url)).toEqual(["http://server:3000/api/publications"]);
    expect(httpsMock.calls).toHaveLength(0);
    expect(io.text()).toContain("Sharing: Plan");
  });

  it.each([
    ["spot.mp4", "video/mp4"],
    ["spot.MOV", "video/quicktime"],
    ["spot.webm", "video/webm"],
    ["still.png", "image/png"],
    ["still.jpg", "image/jpeg"],
    ["still.jpeg", "image/jpeg"],
    ["sheet.pdf", "application/pdf"],
  ])("sends %s down the media flow as %s", async (filename, contentType) => {
    const file = path.join(project.dir, filename);
    writeFileSync(file, RENDER_BODY, "utf8");
    const calls = stubMediaApi();

    await runPublish(file, {}, { config: config(), io: io.io });

    const create = calls.find((c) => c.url.endsWith("/api/publications/media"))!;
    expect(JSON.parse(create.body!).contentType).toBe(contentType);
  });

  it("errors clearly when the file is missing", async () => {
    stubMediaApi();
    await expect(
      runPublish(path.join(project.dir, "nope.mp4"), {}, { config: config(), io: io.io }),
    ).rejects.toThrow(/File not found/);
  });

  it("refuses an empty file before touching the network", async () => {
    const empty = path.join(project.dir, "empty.mp4");
    writeFileSync(empty, "", "utf8");
    const calls = stubMediaApi();
    await expect(runPublish(empty, {}, { config: config(), io: io.io })).rejects.toThrow(/empty/);
    expect(calls).toHaveLength(0);
  });
});

describe("waypoint publish — the media upload", () => {
  it("creates, streams the PUT with an explicit Content-Length, then finalizes", async () => {
    const calls = stubMediaApi();

    await runPublish(renderPath, {}, { config: config(), io: io.io });

    // 1. Create: the declared size is the real file size.
    const create = calls.find((c) => c.url.endsWith("/api/publications/media"))!;
    expect(create.headers.authorization).toBe("Bearer tok");
    const payload = JSON.parse(create.body!);
    expect(payload).toMatchObject({ filename: "spot.mp4", contentType: "video/mp4", bytes: 4096 });
    expect(payload.source.host).toBeTruthy();

    // 2. Upload: straight to the signed URL, streamed, length declared.
    expect(httpsMock.calls).toHaveLength(1);
    const put = httpsMock.calls[0];
    expect(put.url).toBe(CREATED.uploadUrl);
    expect(put.options.method).toBe("PUT");
    expect(put.options.headers?.["content-length"]).toBe(4096);
    expect(put.options.headers?.["content-type"]).toBe("video/mp4");
    expect(put.piped).toBe(true);
    expect(put.body).toBe(RENDER_BODY);

    // The upload never goes through the Waypoint server.
    expect(calls.some((c) => c.body === RENDER_BODY)).toBe(false);

    // 3. Finalize, only after the PUT succeeded.
    const finalizeCall = calls.find((c) => c.url.endsWith("/finalize"))!;
    expect(finalizeCall.url).toBe(`http://server:3000/api/publications/${CREATED.id}/finalize`);
    expect(calls.indexOf(finalizeCall)).toBeGreaterThan(calls.indexOf(create));
  });

  it("does not finalize when the store rejects the upload", async () => {
    const calls = stubMediaApi();
    httpsMock.status = 403;
    httpsMock.responseBody = "<Error><Code>SignatureDoesNotMatch</Code></Error>";

    await expect(runPublish(renderPath, {}, { config: config(), io: io.io })).rejects.toThrow(
      /Upload to storage failed \(HTTP 403\)/,
    );
    expect(calls.some((c) => c.url.endsWith("/finalize"))).toBe(false);
  });

  it("reports an unreachable store as a network failure, not a crash", async () => {
    stubMediaApi();
    httpsMock.requestError = new Error("socket hang up");
    await expect(runPublish(renderPath, {}, { config: config(), io: io.io })).rejects.toThrow(
      /Could not upload to storage \(socket hang up\)/,
    );
  });

  it("prints progress as the upload advances", async () => {
    stubMediaApi();
    await runPublish(renderPath, {}, { config: config(), io: io.io });
    expect(io.logs.some((line) => /^\s+\d+%$/.test(line))).toBe(true);
    expect(io.logs.some((line) => line.includes("Uploading spot.mp4"))).toBe(true);
  });

  it("surfaces publish_unavailable from the server as a clean error", async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: "publish_unavailable", message: "Publishing is not configured." } }, 400),
    );
    await expect(runPublish(renderPath, {}, { config: config(), io: io.io })).rejects.toThrow(
      /not configured/,
    );
    expect(httpsMock.calls).toHaveLength(0);
  });
});

describe("waypoint publish — media flags", () => {
  it("passes --group, --label, and --title through", async () => {
    const calls = stubMediaApi();
    await runPublish(
      renderPath,
      { group: " vbtc-unwrapped ", label: " v2 ", title: " The Spot " },
      { config: config(), io: io.io },
    );
    const payload = JSON.parse(calls.find((c) => c.url.endsWith("/media"))!.body!);
    expect(payload).toMatchObject({ group: "vbtc-unwrapped", label: "v2", title: "The Spot" });
  });

  it("auto-detects <file>.manifest.json beside the render", async () => {
    const manifest = { title: "vBTC Unwrapped", composition: "wordmark-reveal" };
    writeFileSync(`${renderPath}.manifest.json`, JSON.stringify(manifest), "utf8");
    const calls = stubMediaApi();

    await runPublish(renderPath, {}, { config: config(), io: io.io });

    const payload = JSON.parse(calls.find((c) => c.url.endsWith("/media"))!.body!);
    expect(payload.manifest).toEqual(manifest);
    // The manifest's title wins over the filename when no --title is given.
    expect(payload.title).toBe("vBTC Unwrapped");
  });

  it("sends no manifest when there is none beside the file", async () => {
    const calls = stubMediaApi();
    await runPublish(renderPath, {}, { config: config(), io: io.io });
    const payload = JSON.parse(calls.find((c) => c.url.endsWith("/media"))!.body!);
    expect(payload.manifest).toBeUndefined();
    expect(payload.title).toBe("spot");
  });

  it("reads an explicit --manifest and errors when it is missing or malformed", async () => {
    const explicit = path.join(project.dir, "render.json");
    writeFileSync(explicit, JSON.stringify({ composition: "explicit" }), "utf8");
    const calls = stubMediaApi();
    await runPublish(renderPath, { manifest: explicit }, { config: config(), io: io.io });
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/media"))!.body!).manifest).toEqual({
      composition: "explicit",
    });

    await expect(
      runPublish(renderPath, { manifest: path.join(project.dir, "gone.json") }, { config: config(), io: io.io }),
    ).rejects.toThrow(/Manifest not found/);

    const broken = path.join(project.dir, "broken.json");
    writeFileSync(broken, "{ not json", "utf8");
    await expect(
      runPublish(renderPath, { manifest: broken }, { config: config(), io: io.io }),
    ).rejects.toThrow(/not valid JSON/);

    const notObject = path.join(project.dir, "array.json");
    writeFileSync(notObject, "[1,2]", "utf8");
    await expect(
      runPublish(renderPath, { manifest: notObject }, { config: config(), io: io.io }),
    ).rejects.toThrow(/must be a JSON object/);
  });
});

describe("waypoint publish --json", () => {
  it("prints one JSON object on stdout and keeps progress off it", async () => {
    stubMediaApi({
      ...FINALIZED,
      urls: { ...FINALIZED.urls, manifest: "https://dropzone.tylersavery.com/smitty/shares/uuid/spot.manifest.json" },
    });

    await runPublish(renderPath, { json: true }, { config: config(), io: io.io });

    expect(io.logs).toHaveLength(1);
    const printed = JSON.parse(io.logs[0]);
    expect(printed).toEqual({
      id: CREATED.id,
      title: "Spot",
      kind: "media",
      urls: {
        file: "https://dropzone.tylersavery.com/smitty/shares/uuid/spot.mp4",
        manifest: "https://dropzone.tylersavery.com/smitty/shares/uuid/spot.manifest.json",
        // The server hands back a relative page path; the CLI absolutizes it
        // with its own configured public URL.
        page: "http://public:4000/publications/abcd1234-ef56-7890-abcd-ef1234567890",
      },
    });

    // Progress went to stderr instead of polluting the machine output.
    expect(io.warns.some((line) => /^\s+\d+%$/.test(line))).toBe(true);
  });

  it("prints the markdown result as JSON too", async () => {
    const docPath = path.join(project.dir, "plan.md");
    writeFileSync(docPath, "# Plan\n\nbody\n", "utf8");
    const urls = { html: "https://x/plan.html", pdf: "https://x/plan.pdf", md: "https://x/plan.md" };
    stubFetch(() => jsonResponse({ id: "doc-1", title: "Plan", urls }, 201));

    await runPublish(docPath, { json: true }, { config: config(), io: io.io });

    expect(io.logs).toHaveLength(1);
    expect(JSON.parse(io.logs[0])).toEqual({ id: "doc-1", title: "Plan", kind: "markdown", urls });
  });
});

describe("waypoint publish — human output", () => {
  it("prints the file, manifest, and page urls", async () => {
    stubMediaApi({
      ...FINALIZED,
      urls: { ...FINALIZED.urls, manifest: "https://dropzone.tylersavery.com/smitty/shares/uuid/spot.manifest.json" },
    });

    await runPublish(renderPath, {}, { config: config(), io: io.io });

    const text = io.text();
    expect(text).toContain("Published: Spot");
    expect(text).toContain("ID: abcd1234");
    expect(text).toContain("  File:     https://dropzone.tylersavery.com/smitty/shares/uuid/spot.mp4");
    expect(text).toContain("  Manifest: https://dropzone.tylersavery.com/smitty/shares/uuid/spot.manifest.json");
    expect(text).toContain("  Page:     http://public:4000/publications/abcd1234-ef56-7890-abcd-ef1234567890");
  });

  it("omits the manifest line when there is no manifest", async () => {
    stubMediaApi();
    await runPublish(renderPath, {}, { config: config(), io: io.io });
    expect(io.text()).not.toContain("Manifest:");
  });
});
