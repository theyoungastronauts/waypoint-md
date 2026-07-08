// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
  nextFocusId,
  resolveKeyAction,
  type KeyContext,
} from "../keyboard";

/** A KeyContext with sensible defaults; override per case. */
function ctx(overrides: Partial<KeyContext>): KeyContext {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    editable: false,
    answerField: false,
    aiEnabled: true,
    ...overrides,
  };
}

describe("resolveKeyAction — plain bindings (§9)", () => {
  it("maps j/k to next/prev focus", () => {
    expect(resolveKeyAction(ctx({ key: "j" }))).toEqual({ type: "focusNext" });
    expect(resolveKeyAction(ctx({ key: "k" }))).toEqual({ type: "focusPrev" });
  });

  it("maps f/x to flag/skip", () => {
    expect(resolveKeyAction(ctx({ key: "f" }))).toEqual({ type: "flag" });
    expect(resolveKeyAction(ctx({ key: "x" }))).toEqual({ type: "skip" });
  });

  it("maps a to focus-agent only when AI is enabled", () => {
    expect(resolveKeyAction(ctx({ key: "a", aiEnabled: true }))).toEqual({ type: "focusAgent" });
    expect(resolveKeyAction(ctx({ key: "a", aiEnabled: false }))).toBeNull();
  });

  it("maps ? to the legend toggle", () => {
    expect(resolveKeyAction(ctx({ key: "?" }))).toEqual({ type: "toggleHelp" });
  });

  it("ignores unbound keys", () => {
    expect(resolveKeyAction(ctx({ key: "z" }))).toBeNull();
    expect(resolveKeyAction(ctx({ key: "Enter" }))).toBeNull();
  });
});

describe("resolveKeyAction — input guard", () => {
  it("suppresses plain bindings while typing in an editable field", () => {
    for (const key of ["j", "k", "f", "x", "a", "?"]) {
      expect(resolveKeyAction(ctx({ key, editable: true }))).toBeNull();
    }
  });

  it("suppresses plain bindings when a Cmd/Ctrl/Alt modifier is held", () => {
    expect(resolveKeyAction(ctx({ key: "a", metaKey: true }))).toBeNull(); // ⌘A select-all
    expect(resolveKeyAction(ctx({ key: "f", ctrlKey: true }))).toBeNull();
    expect(resolveKeyAction(ctx({ key: "j", altKey: true }))).toBeNull();
  });
});

describe("resolveKeyAction — ⌘⏎ mark-answered exception", () => {
  it("marks answered on Cmd+Enter and Ctrl+Enter", () => {
    expect(resolveKeyAction(ctx({ key: "Enter", metaKey: true }))).toEqual({ type: "markAnswered" });
    expect(resolveKeyAction(ctx({ key: "Enter", ctrlKey: true }))).toEqual({ type: "markAnswered" });
  });

  it("marks answered EVEN from inside an answer textarea (the one guard exception)", () => {
    expect(
      resolveKeyAction(ctx({ key: "Enter", metaKey: true, editable: true, answerField: true })),
    ).toEqual({ type: "markAnswered" });
  });

  it("marks answered from a non-editable focus (e.g. after j/k navigation)", () => {
    expect(resolveKeyAction(ctx({ key: "Enter", metaKey: true, editable: false }))).toEqual({
      type: "markAnswered",
    });
  });

  it("is left to the chat when fired from a non-answer editable surface", () => {
    // The agent chat textarea owns its own Enter handling — ⌘⏎ must not also
    // mark the focused item answered.
    expect(
      resolveKeyAction(ctx({ key: "Enter", metaKey: true, editable: true, answerField: false })),
    ).toBeNull();
  });

  it("does nothing for a bare Enter (no modifier)", () => {
    expect(resolveKeyAction(ctx({ key: "Enter" }))).toBeNull();
    expect(resolveKeyAction(ctx({ key: "Enter", editable: true }))).toBeNull();
  });
});

describe("nextFocusId — focus movement (§9)", () => {
  const order = ["a", "b", "c"];

  it("moves forward and backward within the list", () => {
    expect(nextFocusId(order, "a", 1)).toBe("b");
    expect(nextFocusId(order, "b", 1)).toBe("c");
    expect(nextFocusId(order, "c", -1)).toBe("b");
  });

  it("clamps at the boundaries (no wraparound)", () => {
    expect(nextFocusId(order, "c", 1)).toBe("c");
    expect(nextFocusId(order, "a", -1)).toBe("a");
  });

  it("picks the first (j) or last (k) item when nothing is focused", () => {
    expect(nextFocusId(order, null, 1)).toBe("a");
    expect(nextFocusId(order, null, -1)).toBe("c");
  });

  it("recovers to an end when the current id is unknown", () => {
    expect(nextFocusId(order, "gone", 1)).toBe("a");
    expect(nextFocusId(order, "gone", -1)).toBe("c");
  });

  it("returns null for an empty order", () => {
    expect(nextFocusId([], null, 1)).toBeNull();
    expect(nextFocusId([], "a", -1)).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("treats inputs, textareas, selects, and contenteditable as editable", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not derive isContentEditable from the attribute; assert directly.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableTarget(editable)).toBe(true);
  });

  it("treats non-editable elements and null as not editable", () => {
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
