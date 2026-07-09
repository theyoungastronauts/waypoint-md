import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_R2_BUCKET,
  DEFAULT_R2_PUBLIC_DOMAIN,
  getR2Config,
  publishEnabled,
} from "@/lib/publish/config";

const KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_DOMAIN",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setCreds() {
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "ak";
  process.env.R2_SECRET_ACCESS_KEY = "sk";
}

describe("publishEnabled", () => {
  it("is false when no credentials are set", () => {
    expect(publishEnabled()).toBe(false);
  });

  it("is false when only some credentials are set", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "ak";
    expect(publishEnabled()).toBe(false);
  });

  it("is false when a credential is blank/whitespace", () => {
    setCreds();
    process.env.R2_SECRET_ACCESS_KEY = "   ";
    expect(publishEnabled()).toBe(false);
  });

  it("is true when all three credentials are present", () => {
    setCreds();
    expect(publishEnabled()).toBe(true);
  });
});

describe("getR2Config", () => {
  it("returns null when credentials are missing", () => {
    expect(getR2Config()).toBeNull();
  });

  it("applies bucket and public-domain defaults when unset", () => {
    setCreds();
    const config = getR2Config();
    expect(config).not.toBeNull();
    expect(config!.bucket).toBe(DEFAULT_R2_BUCKET);
    expect(config!.publicDomain).toBe(DEFAULT_R2_PUBLIC_DOMAIN);
  });

  it("honors explicit bucket and public domain", () => {
    setCreds();
    process.env.R2_BUCKET_NAME = "my-bucket";
    process.env.R2_PUBLIC_DOMAIN = "cdn.example.com";
    const config = getR2Config()!;
    expect(config.bucket).toBe("my-bucket");
    expect(config.publicDomain).toBe("cdn.example.com");
  });
});
