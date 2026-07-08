import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedConfig } from "./config";
import { runPush } from "./commands/push";
import { outboxCount } from "./outbox";
import { readPointer } from "./pointer";
import {
  capturingIo,
  jsonResponse,
  stubFetch,
  stubFetchOffline,
  tmpDir,
  withTempHome,
  type CapturedIo,
} from "./testkit";

let home: ReturnType<typeof withTempHome>;
let project: ReturnType<typeof tmpDir>;
let io: CapturedIo;
let planPath: string;

function config(): ResolvedConfig {
  return {
    url: "http://server:3000",
    publicUrl: "http://public:4000",
    token: "tok",
    project: "acme",
    projectRoot: project.dir,
  };
}

const healthOk = () => jsonResponse({ status: "ok", version: "0.1.0", specVersion: "1.0.0" });
const pushOk = () => jsonResponse({ id: "doc123", url: "/d/doc123", title: "Plan", warnings: [] }, 201);

beforeEach(() => {
  home = withTempHome();
  project = tmpDir("proj");
  io = capturingIo();
  planPath = path.join(project.dir, "plan.md");
  writeFileSync(planPath, "# Plan\n\nbody\n", "utf8");
});

afterEach(() => {
  vi.unstubAllGlobals();
  home.restore();
  project.cleanup();
});

describe("waypoint push", () => {
  it("posts the doc, writes the pointer, and prints the public review URL", async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return healthOk();
      if (call.url.endsWith("/api/documents") && call.method === "POST") return pushOk();
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    await runPush(planPath, {}, { config: config(), io: io.io });

    const pointer = readPointer(project.dir);
    expect(pointer?.id).toBe("doc123");
    expect(pointer?.source).toBe("plan.md");
    expect(io.text()).toContain("http://public:4000/d/doc123");

    const post = calls.find((c) => c.method === "POST");
    expect(post?.headers.authorization).toBe("Bearer tok");
    const body = JSON.parse(post!.body!);
    expect(body.source.path).toBe("plan.md");
    expect(body.source.host).toBeTruthy();
    expect(body.project).toBe("acme");
  });

  it("passes --title through to the payload", async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return healthOk();
      return pushOk();
    });
    await runPush(planPath, { title: "Custom Title" }, { config: config(), io: io.io });
    const post = calls.find((c) => c.method === "POST");
    expect(JSON.parse(post!.body!).title).toBe("Custom Title");
  });

  it("queues to the outbox (not the pointer) when the server is unreachable", async () => {
    stubFetchOffline();
    await runPush(planPath, {}, { config: config(), io: io.io });

    expect(outboxCount()).toBe(1);
    expect(readPointer(project.dir)).toBeNull();
    expect(io.warns.join("\n")).toMatch(/queued/i);
  });

  it("does not throw when the server is down (push never hard-fails)", async () => {
    stubFetchOffline();
    await expect(runPush(planPath, {}, { config: config(), io: io.io })).resolves.toBeUndefined();
  });

  it("--flush delivers queued pushes once the server is back", async () => {
    // Queue one offline.
    stubFetchOffline();
    await runPush(planPath, {}, { config: config(), io: io.io });
    expect(outboxCount()).toBe(1);

    // Server returns; flush drains the outbox and writes the pointer.
    vi.unstubAllGlobals();
    stubFetch((call) => (call.url.endsWith("/api/health") ? healthOk() : pushOk()));
    await runPush(undefined, { flush: true }, { config: config(), io: io.io });

    expect(outboxCount()).toBe(0);
    expect(readPointer(project.dir)?.id).toBe("doc123");
  });

  it("surfaces an auth failure as a hard error (never queued)", async () => {
    stubFetch((call) => {
      if (call.url.endsWith("/api/health")) return healthOk();
      return jsonResponse({ error: { code: "unauthorized", message: "nope" } }, 401);
    });
    await expect(runPush(planPath, {}, { config: config(), io: io.io })).rejects.toThrow();
    expect(outboxCount()).toBe(0);
  });
});
