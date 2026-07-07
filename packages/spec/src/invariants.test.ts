/**
 * The #1 non-negotiable (§11, §17.2, §17.3). These tests iterate over EVERY
 * fixture programmatically, so any fixture added to `packages/spec/fixtures/`
 * is automatically held to both invariants.
 */

import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures.js";
import { applyReview, parseDocument, extractReviewState } from "./index.js";
import type { Item, ReviewState } from "./index.js";

const fixtures = loadFixtures();

/** A selection that differs from the item's current one, to force a real flip. */
function flippedSelection(item: Item): string[] {
  const labels = (item.options ?? []).map((o) => o.label);
  const current = new Set(item.response?.selected ?? []);
  if (item.select === "multi") return labels.filter((l) => !current.has(l)); // invert
  const alt = labels.find((l) => !current.has(l));
  return alt ? [alt] : [];
}

it("loaded the golden fixtures", () => {
  // Guards against the glob silently matching nothing (which would make the
  // per-fixture suites vacuously pass).
  expect(fixtures.length).toBeGreaterThanOrEqual(8);
});

describe("byte-fidelity: applyReview(raw, {}) === raw", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(applyReview(fixture.raw, {})).toBe(fixture.raw);
    });

    it(`${fixture.name} — empty responses are also a no-op`, () => {
      // A review that only carries empty response objects must not stamp or splice.
      expect(applyReview(fixture.raw, { responses: { phantom: {} } })).toBe(fixture.raw);
    });
  }
});

describe("round-trip: parseDocument(applyReview(raw, state)) recovers state", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name} — the document's own responses are stable`, () => {
      const initial = extractReviewState(parseDocument(fixture.raw));
      if (!initial.responses) {
        // No embedded responses to round-trip (e.g. no-convention doc).
        expect(applyReview(fixture.raw, {})).toBe(fixture.raw);
        return;
      }
      const applied = applyReview(fixture.raw, { responses: initial.responses });
      const recovered = extractReviewState(parseDocument(applied));
      expect(recovered.responses).toEqual(initial.responses);
    });
  }
});

describe("checkbox flips never corrupt the document (F-1 regression)", () => {
  for (const fixture of fixtures) {
    const parsed = parseDocument(fixture.raw);
    const choices = parsed.items.filter((i) => i.type === "choice" && (i.options?.length ?? 0) > 0);
    if (choices.length === 0) continue;

    it(`${fixture.name} — a forced flip keeps labels byte-stable and round-trips`, () => {
      const responses: NonNullable<ReviewState["responses"]> = {};
      for (const item of choices) responses[item.wpId] = { selected: flippedSelection(item) };

      const out = applyReview(fixture.raw, { responses });
      const reparsed = parseDocument(out);

      // No new structural warnings (the flip may only clear a multi-checked-single).
      const relevant = (w: { code: string }) => w.code !== "multi-checked-single";
      expect(reparsed.warnings.filter(relevant)).toEqual(parsed.warnings.filter(relevant));

      for (const before of choices) {
        const after = reparsed.items.find((i) => i.wpId === before.wpId);
        expect(after, `item ${before.wpId} survived the flip`).toBeDefined();
        // Corruption would swallow the bullet into the label or mangle a marker.
        expect(after!.options?.map((o) => o.label)).toEqual(before.options!.map((o) => o.label));
        for (const opt of after!.options ?? []) {
          expect(out.slice(opt.marker.start, opt.marker.end)).toMatch(/^\[[ xX]\]$/);
        }
        expect(after!.response?.selected ?? []).toEqual(flippedSelection(before));
      }
    });
  }
});

describe("parser never throws on any fixture", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(() => parseDocument(fixture.raw)).not.toThrow();
    });
  }
});
