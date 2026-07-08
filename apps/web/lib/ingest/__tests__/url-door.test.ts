import { afterEach, describe, expect, it, vi } from "vitest";

// dns.lookup is mocked so host resolution is deterministic and offline.
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

import { assertPublicHost, fetchUrlDoor, isPrivateIp } from "../url-door";
import { UrlDoorError } from "../url-door";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  lookupMock.mockReset();
});

describe("isPrivateIp", () => {
  it("flags RFC1918, loopback, and link-local IPv4", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "169.254.1.1", "0.0.0.0", "100.64.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("flags loopback, ULA, link-local, and mapped IPv6", () => {
    for (const ip of ["::1", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "ff02::1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("passes public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1::1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicHost", () => {
  it("rejects a literal private IP without any DNS lookup", async () => {
    await expect(assertPublicHost("127.0.0.1")).rejects.toBeInstanceOf(UrlDoorError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    await expect(assertPublicHost("evil.example.com")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("accepts a hostname that resolves to a public address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicHost("example.com")).resolves.toBeUndefined();
  });
});

describe("fetchUrlDoor", () => {
  const stubFetch = (impl: typeof fetch) => vi.stubGlobal("fetch", vi.fn(impl));

  it("rejects non-http(s) protocols", async () => {
    await expect(fetchUrlDoor("file:///etc/passwd")).rejects.toMatchObject({
      code: "unsupported_protocol",
    });
  });

  it("rejects non-text content types", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    stubFetch(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(fetchUrlDoor("https://example.com/x.json")).rejects.toMatchObject({
      code: "unsupported_content_type",
    });
  });

  it("rejects bodies over the 1 MB cap via content-length", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    stubFetch(async () =>
      new Response("hi", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(2 * 1024 * 1024) },
      }),
    );
    await expect(fetchUrlDoor("https://example.com/big.md")).rejects.toMatchObject({
      code: "response_too_large",
    });
  });

  it("rejects bodies over the cap when streamed without a content-length", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const big = "a".repeat(1024 * 1024 + 10);
    stubFetch(async () =>
      new Response(big, { status: 200, headers: { "content-type": "text/plain" } }),
    );
    await expect(fetchUrlDoor("https://example.com/big.md")).rejects.toMatchObject({
      code: "response_too_large",
    });
  });

  it("re-validates the SSRF check on redirects to a private address", async () => {
    lookupMock.mockImplementation(async (host: string) => {
      if (host === "example.com") return [{ address: "93.184.216.34", family: 4 }];
      return [{ address: "127.0.0.1", family: 4 }];
    });
    stubFetch(async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.startsWith("https://example.com")) {
        return new Response(null, { status: 302, headers: { location: "http://internal.local/secret" } });
      }
      return new Response("secret", { status: 200, headers: { "content-type": "text/plain" } });
    });
    await expect(fetchUrlDoor("https://example.com/redir")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("fetches a public text document and preserves bytes", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const body = "# Title\r\n\r\nBody with CRLF.\r\n";
    stubFetch(async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } }),
    );
    const result = await fetchUrlDoor("https://example.com/plan.md");
    expect(result.raw).toBe(body);
  });
});
