import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import { GET as getSettings, POST as postSettings } from "@/app/api/settings/route";
import { DEFAULT_MODEL, MODELS, MODEL_SETTING_KEY } from "@/lib/ai/models";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

const ENV = process.env.WAYPOINT_MODEL;
afterEach(() => {
  getDb().delete(settings).where(eq(settings.key, MODEL_SETTING_KEY)).run();
  if (ENV === undefined) delete process.env.WAYPOINT_MODEL;
  else process.env.WAYPOINT_MODEL = ENV;
});

function post(body: unknown) {
  return postSettings(
    new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/settings", () => {
  it("GET returns the default model and its source when nothing is set", async () => {
    delete process.env.WAYPOINT_MODEL;
    const data = await getSettings().json();
    expect(data.model).toBe(DEFAULT_MODEL);
    expect(data.source).toBe("default");
    expect(Array.isArray(data.choices)).toBe(true);
    expect(data.choices.length).toBe(3);
  });

  it("GET reflects the WAYPOINT_MODEL env default", async () => {
    process.env.WAYPOINT_MODEL = MODELS.opus;
    const data = await getSettings().json();
    expect(data.model).toBe(MODELS.opus);
    expect(data.source).toBe("env");
  });

  it("POST stores a model and it then wins over the env default", async () => {
    process.env.WAYPOINT_MODEL = MODELS.opus;
    const res = await post({ model: MODELS.fable });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(MODELS.fable);
    expect(body.source).toBe("settings");

    // A subsequent GET agrees — the change is live, no restart.
    const after = await getSettings().json();
    expect(after.model).toBe(MODELS.fable);
    expect(after.source).toBe("settings");
  });

  it("POST rejects an unknown model", async () => {
    const res = await post({ model: "gpt-4o" });
    expect(res.status).toBe(400);
  });
});
