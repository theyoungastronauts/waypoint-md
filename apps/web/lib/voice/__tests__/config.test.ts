import { afterEach, describe, expect, it, vi } from "vitest";
import { getOpenAiKey, voiceEnabled } from "@/lib/voice/config";

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
