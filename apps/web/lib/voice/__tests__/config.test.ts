import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOpenAiKey,
  getPhoneAllowlist,
  getWebhookSecret,
  normalizePhoneNumber,
  phoneEnabled,
  voiceEnabled,
} from "@/lib/voice/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("voice capability gate", () => {
  it("is off when neither key is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(voiceEnabled()).toBe(false);
  });

  it("is off with only the Anthropic key (no Realtime)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(voiceEnabled()).toBe(false);
  });

  it("is off with only the OpenAI key (no brief)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "  ");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(voiceEnabled()).toBe(false);
  });

  it("is on with both keys", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(voiceEnabled()).toBe(true);
  });

  it("trims the OpenAI key", () => {
    vi.stubEnv("OPENAI_API_KEY", "  sk-test \n");
    expect(getOpenAiKey()).toBe("sk-test");
  });
});

describe("phone gate and allowlist", () => {
  const both = () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
  };

  it("normalizes numbers and drops junk", () => {
    vi.stubEnv("WAYPOINT_PHONE_ALLOWLIST", "+1 (604) 555-0100, 16045550199 , nope, ");
    expect(getPhoneAllowlist()).toEqual(["+16045550100", "+16045550199"]);
    expect(normalizePhoneNumber("12")).toBeNull();
  });

  it("is off without the webhook secret or an allowlisted number", () => {
    both();
    vi.stubEnv("OPENAI_WEBHOOK_SECRET", "");
    vi.stubEnv("WAYPOINT_PHONE_ALLOWLIST", "+16045550100");
    expect(phoneEnabled()).toBe(false);
    vi.stubEnv("OPENAI_WEBHOOK_SECRET", "whsec_abc");
    vi.stubEnv("WAYPOINT_PHONE_ALLOWLIST", "");
    expect(phoneEnabled()).toBe(false);
  });

  it("is on with voice, the secret and an allowlisted number", () => {
    both();
    vi.stubEnv("OPENAI_WEBHOOK_SECRET", "whsec_abc");
    vi.stubEnv("WAYPOINT_PHONE_ALLOWLIST", "+16045550100");
    expect(phoneEnabled()).toBe(true);
    expect(getWebhookSecret()).toBe("whsec_abc");
  });
});
