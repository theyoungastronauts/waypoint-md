import { describe, expect, it } from "vitest";

import { spliceAtCaret } from "@/components/review/caret-insert";

describe("spliceAtCaret — caret-aware insertion (decision B-5)", () => {
  it("inserts at a collapsed caret in the middle of the value", () => {
    const r = spliceAtCaret("Hello world", 5, 5, " brave");
    expect(r.value).toBe("Hello brave world");
    expect(r.caret).toBe(11); // just past the inserted text
  });

  it("replaces a selected range", () => {
    const r = spliceAtCaret("Hello world", 6, 11, "there");
    expect(r.value).toBe("Hello there");
    expect(r.caret).toBe(11);
  });

  it("appends when the caret is at the end", () => {
    const r = spliceAtCaret("abc", 3, 3, "X");
    expect(r.value).toBe("abcX");
    expect(r.caret).toBe(4);
  });

  it("sets an empty field outright", () => {
    const r = spliceAtCaret("", 0, 0, "~/f");
    expect(r.value).toBe("~/f");
    expect(r.caret).toBe(3);
  });

  it("normalizes a reversed selection (start > end)", () => {
    const r = spliceAtCaret("abcdef", 4, 2, "X");
    expect(r.value).toBe("abXef");
    expect(r.caret).toBe(3);
  });

  it("clamps out-of-bounds offsets into the value", () => {
    const r = spliceAtCaret("abc", 10, 20, "X");
    expect(r.value).toBe("abcX");
    expect(r.caret).toBe(4);
  });

  it("falls back to the end for non-finite offsets", () => {
    const r = spliceAtCaret("abc", Number.NaN, Number.NaN, "X");
    expect(r.value).toBe("abcX");
    expect(r.caret).toBe(4);
  });
});
