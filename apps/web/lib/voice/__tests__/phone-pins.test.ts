import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Scripted PIN draws when a test queues them; the real randomInt otherwise.
const draws = vi.hoisted(() => [] as number[]);
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomInt: (min: number, max: number) => draws.shift() ?? actual.randomInt(min, max),
  };
});
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/db";
import { getDb } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { updateDocument } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";
import {
  backfillPhonePins,
  ensurePhonePin,
  findLatestLiveDocument,
  findLiveDocumentByPin,
  isValidPin,
} from "@/lib/voice/phone-pins";

const kitchenSink = readFileSync(path.resolve(process.cwd(), "packages/spec/fixtures/kitchen-sink.md"), "utf8");

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

const ingest = (raw = kitchenSink) => ingestDocument({ raw, sourceType: "paste" }).id;
const pinOf = (id: string) =>
  getDb().select({ pin: documents.phonePin }).from(documents).where(eq(documents.id, id)).get()?.pin ?? null;

describe("phone PINs", () => {
  it("assigns a stable 4-digit PIN that never starts with 0", () => {
    const id = ingest();
    const pin = ensurePhonePin(id);
    expect(pin).toMatch(/^[1-9]\d{3}$/);
    expect(ensurePhonePin(id)).toBe(pin);
    expect(isValidPin(pin!)).toBe(true);
    expect(isValidPin("0123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
  });

  it("gives none to a document without questions", () => {
    expect(ensurePhonePin(ingest("# Just prose\n"))).toBeNull();
  });

  it("opens only live reviews: a completed, pulled or superseded review's PIN opens nothing", () => {
    for (const status of ["completed", "pulled", "archived"] as const) {
      const id = ingest();
      const pin = ensurePhonePin(id)!;
      expect(findLiveDocumentByPin(pin)?.id).toBe(id);
      updateDocument(id, { status });
      expect(findLiveDocumentByPin(pin)).toBeNull();
      expect(ensurePhonePin(id)).toBeNull();
    }
  });

  it("hands a finished review's PIN to a new review, and redraws past a live one", () => {
    const old = ingest();
    const oldPin = ensurePhonePin(old)!;
    updateDocument(old, { status: "completed" });
    const live = ingest();
    const livePin = ensurePhonePin(live)!;

    // Draws: the live review's PIN (taken, so drawn again), then the finished one's.
    draws.push(Number(livePin), Number(oldPin));
    const fresh = ingest();
    expect(ensurePhonePin(fresh)).toBe(oldPin);
    expect(pinOf(old)).toBeNull();
    expect(pinOf(live)).toBe(livePin);
    expect(findLiveDocumentByPin(oldPin)?.id).toBe(fresh);
  });

  it("never gives two live reviews the same PIN", () => {
    const pins = new Set<string>();
    for (let i = 0; i < 40; i++) pins.add(ensurePhonePin(ingest())!);
    expect(pins.size).toBe(40);
  });

  it("backfills live reviews that have no PIN", () => {
    const id = ingest();
    expect(pinOf(id)).toBeNull();
    expect(backfillPhonePins()).toBeGreaterThanOrEqual(1);
    expect(pinOf(id)).toMatch(/^[1-9]\d{3}$/);
  });

  it("finds the latest live review with questions", () => {
    const older = ingest();
    ingest("# Prose only, newer\n");
    const newest = ingest();
    expect(findLatestLiveDocument()?.id).toBe(newest);
    updateDocument(newest, { status: "completed" });
    expect(findLatestLiveDocument()?.id).not.toBe(newest);
    void older;
  });
});
