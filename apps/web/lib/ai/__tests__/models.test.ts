import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import { DEFAULT_MODEL, MODELS, MODEL_SETTING_KEY, resolveModelDetail } from "@/lib/ai/models";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { setSetting } from "@/lib/settings";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

const ENV = process.env.WAYPOINT_MODEL;
afterEach(() => {
  // Reset both precedence sources between cases.
  getDb().delete(settings).where(eq(settings.key, MODEL_SETTING_KEY)).run();
  if (ENV === undefined) delete process.env.WAYPOINT_MODEL;
  else process.env.WAYPOINT_MODEL = ENV;
});

describe("resolveModelDetail — precedence: settings > env > default (§14)", () => {
  it("falls back to the built-in default when nothing is set", () => {
    delete process.env.WAYPOINT_MODEL;
    expect(resolveModelDetail()).toEqual({ model: DEFAULT_MODEL, source: "default" });
  });

  it("uses the WAYPOINT_MODEL env default when no setting is stored", () => {
    process.env.WAYPOINT_MODEL = MODELS.opus;
    expect(resolveModelDetail()).toEqual({ model: MODELS.opus, source: "env" });
  });

  it("lets the settings value win over the env default", () => {
    process.env.WAYPOINT_MODEL = MODELS.opus;
    setSetting(MODEL_SETTING_KEY, MODELS.fable);
    expect(resolveModelDetail()).toEqual({ model: MODELS.fable, source: "settings" });
  });

  it("ignores an unknown settings value and falls through to env", () => {
    process.env.WAYPOINT_MODEL = MODELS.sonnet;
    setSetting(MODEL_SETTING_KEY, "claude-not-a-real-model");
    expect(resolveModelDetail()).toEqual({ model: MODELS.sonnet, source: "env" });
  });

  it("ignores an unknown settings value and an unset env, falling to default", () => {
    delete process.env.WAYPOINT_MODEL;
    setSetting(MODEL_SETTING_KEY, "garbage");
    expect(resolveModelDetail()).toEqual({ model: DEFAULT_MODEL, source: "default" });
  });
});
