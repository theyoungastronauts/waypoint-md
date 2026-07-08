import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

import type { IO } from "./io";

/** A capturing IO for asserting on command output. */
export interface CapturedIo {
  io: IO;
  logs: string[];
  warns: string[];
  errors: string[];
  /** All log + warn + error lines joined, for loose `.toContain` assertions. */
  text(): string;
}

export function capturingIo(): CapturedIo {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    warns,
    errors,
    io: {
      log: (m) => logs.push(m),
      warn: (m) => warns.push(m),
      error: (m) => errors.push(m),
    },
    text: () => [...logs, ...warns, ...errors].join("\n"),
  };
}

/** Create a throwaway directory. Returns its path and a cleanup fn. */
export function tmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), `waypoint-cli-${prefix}-`));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Point `~` (os.homedir) at a scratch dir by overriding $HOME, so the global
 * config and outbox never touch the real home during tests. Returns a restore fn.
 */
export function withTempHome(): { home: string; restore: () => void } {
  const { dir, cleanup } = tmpDir("home");
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return {
    home: dir,
    restore: () => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      cleanup();
    },
  };
}

/** A recorded fetch call. */
export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

/** Install a global `fetch` stub driven by `handler`; records every call. */
export function stubFetch(handler: FetchHandler): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const call: FetchCall = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: normalizeHeaders(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

/** A fetch stub that always fails as if the server were unreachable. */
export function stubFetchOffline(): FetchCall[] {
  return stubFetch(() => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:3000");
  });
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = v;
  return out;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function annotatedResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
