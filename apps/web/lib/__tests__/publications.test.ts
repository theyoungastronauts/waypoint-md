import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import {
  getPublication,
  insertPublication,
  listPublications,
  publicationExists,
  stampRevoked,
  toFtsMatch,
  type InsertPublicationInput,
} from "@/lib/publications";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

let seq = 0;
function seed(overrides: Partial<InsertPublicationInput> = {}) {
  seq += 1;
  return insertPublication({
    id: `pub-${seq}-${Math.random().toString(36).slice(2)}`,
    title: `Title ${seq}`,
    sanitizedName: `title-${seq}`,
    sourceMd: `# Title ${seq}\n\nbody ${seq}`,
    r2Folder: `smitty/shares/folder-${seq}`,
    publicBase: "dropzone.tylersavery.com",
    origin: "api",
    createdAt: new Date(2026, 0, seq).toISOString(),
    ...overrides,
  });
}

describe("insert + read", () => {
  it("round-trips a row and derives existence", () => {
    const row = seed({ title: "Round Trip", sourceMd: "# Round Trip\n\nhello" });
    const read = getPublication(row.id);
    expect(read?.title).toBe("Round Trip");
    expect(read?.sourceMd).toBe("# Round Trip\n\nhello");
    expect(publicationExists(row.id)).toBe(true);
    expect(publicationExists("nope")).toBe(false);
  });

  it("lists newest first by created_at", () => {
    const older = seed({ createdAt: new Date(2026, 2, 1).toISOString(), title: "Older" });
    const newer = seed({ createdAt: new Date(2026, 2, 2).toISOString(), title: "Newer" });
    const ids = listPublications({ limit: 200 }).map((r) => r.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });
});

describe("FTS search", () => {
  it("matches on title and on body, prefix-style", () => {
    const dep = seed({ title: "Deployment Runbook", sourceMd: "# Deployment Runbook\n\nkubernetes rollout steps" });
    const budget = seed({ title: "Budget Sheet", sourceMd: "# Budget Sheet\n\nquarterly spreadsheet figures" });

    const byTitlePrefix = listPublications({ q: "deploy" }).map((r) => r.id);
    expect(byTitlePrefix).toContain(dep.id);
    expect(byTitlePrefix).not.toContain(budget.id);

    const byBody = listPublications({ q: "kubernetes" }).map((r) => r.id);
    expect(byBody).toContain(dep.id);
    expect(byBody).not.toContain(budget.id);

    const other = listPublications({ q: "spreadsheet" }).map((r) => r.id);
    expect(other).toContain(budget.id);
    expect(other).not.toContain(dep.id);
  });

  it("returns everything (newest first) for an empty/whitespace query", () => {
    const all = listPublications({});
    const blank = listPublications({ q: "   " });
    expect(blank.map((r) => r.id)).toEqual(all.map((r) => r.id));
  });

  it("returns no rows for a query that has no searchable tokens", () => {
    expect(listPublications({ q: "!!!" })).toEqual([]);
  });

  const hostile = ['"', "foo AND", "*", "a:b(", "NEAR(x y)", ")", "-", "OR OR OR", '""', "^", "col:*"];
  it.each(hostile)("never throws or injects on hostile query %j", (q) => {
    expect(() => listPublications({ q })).not.toThrow();
    // Whatever it returns, it is a well-formed array.
    expect(Array.isArray(listPublications({ q }))).toBe(true);
  });

  it("tokenizes into quoted prefix terms", () => {
    expect(toFtsMatch("foo bar")).toBe('"foo"* "bar"*');
    expect(toFtsMatch('a"b')).toBe('"a"* "b"*');
    expect(toFtsMatch("   ")).toBe("");
    expect(toFtsMatch("foo AND bar")).toBe('"foo"* "AND"* "bar"*');
  });
});

describe("revoke", () => {
  it("stamps revoked_at once and is idempotent", () => {
    const row = seed({ title: "To Revoke" });
    expect(row.revokedAt).toBeNull();

    const first = stampRevoked(row.id);
    expect(first?.revokedAt).toBeTruthy();

    const second = stampRevoked(row.id);
    expect(second?.revokedAt).toBe(first?.revokedAt);
  });

  it("returns null for an unknown id", () => {
    expect(stampRevoked("does-not-exist")).toBeNull();
  });

  it("keeps revoked rows searchable (the registry remembers)", () => {
    const row = seed({ title: "Revoked But Findable", sourceMd: "# Revoked But Findable\n\nzephyr marker" });
    stampRevoked(row.id);
    const found = listPublications({ q: "zephyr" }).map((r) => r.id);
    expect(found).toContain(row.id);
  });
});
