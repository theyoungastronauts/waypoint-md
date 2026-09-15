import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import { insertPublication } from "@/lib/publications";
import {
  addMediaComment,
  countUnresolved,
  getMediaComment,
  listMediaComments,
  MAX_COMMENT_BYTES,
  orderComments,
  setCommentResolved,
  toCommentViews,
  type MediaCommentRow,
} from "@/lib/review/comments";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

let seq = 0;
function seedMedia(): string {
  seq += 1;
  const row = insertPublication({
    id: `c-media-${seq}`,
    title: `Render ${seq}`,
    sanitizedName: `render-${seq}`,
    sourceMd: "",
    kind: "media",
    contentType: "video/mp4",
    r2Folder: `smitty/shares/c-media-${seq}`,
    publicBase: "dropzone.tylersavery.com",
    origin: "cli",
  });
  return row.id;
}

function add(publicationId: string, overrides: Partial<Parameters<typeof addMediaComment>[0]> = {}) {
  const result = addMediaComment({
    publicationId,
    reviewLinkId: null,
    authorName: "Jay",
    body: "the wordmark lands too late here",
    ...overrides,
  });
  if (!result.ok) throw new Error(`seed failed: ${result.reason}`);
  return result.row;
}

describe("addMediaComment", () => {
  it("stores a timecoded note with its region and trims the body", () => {
    const pub = seedMedia();
    const row = add(pub, {
      timecodeMs: 12_400,
      region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      body: "  tighten this  ",
    });
    expect(row.timecodeMs).toBe(12_400);
    expect(row.bodyText).toBe("tighten this");
    expect(toCommentViews([row])[0].region).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it("stores a general note with no timecode", () => {
    const pub = seedMedia();
    expect(add(pub, { timecodeMs: null }).timecodeMs).toBeNull();
  });

  it("refuses an empty or whitespace-only body", () => {
    const pub = seedMedia();
    expect(addMediaComment({ publicationId: pub, reviewLinkId: null, authorName: "Jay", body: "   " })).toEqual({
      ok: false,
      reason: "empty_body",
    });
  });

  it("refuses a body past the 4 KB cap, measured in bytes not characters", () => {
    const pub = seedMedia();
    const justUnder = "a".repeat(MAX_COMMENT_BYTES);
    expect(
      addMediaComment({ publicationId: pub, reviewLinkId: null, authorName: "Jay", body: justUnder }).ok,
    ).toBe(true);

    // Two-byte characters hit the cap at half the character count.
    const multibyte = "é".repeat(MAX_COMMENT_BYTES / 2 + 1);
    expect(
      addMediaComment({ publicationId: pub, reviewLinkId: null, authorName: "Jay", body: multibyte }),
    ).toEqual({ ok: false, reason: "body_too_long" });
  });

  it("refuses an impossible timecode or a region outside the frame", () => {
    const pub = seedMedia();
    expect(
      addMediaComment({
        publicationId: pub,
        reviewLinkId: null,
        authorName: "Jay",
        body: "x",
        timecodeMs: -5,
      }),
    ).toEqual({ ok: false, reason: "invalid_timecode" });

    expect(
      addMediaComment({
        publicationId: pub,
        reviewLinkId: null,
        authorName: "Jay",
        body: "x",
        region: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
      }),
    ).toEqual({ ok: false, reason: "invalid_region" });
  });

  it("stores a body exactly as typed — no markdown, no HTML interpretation", () => {
    const pub = seedMedia();
    const hostile = '<script>alert("x")</script> **not bold**';
    expect(add(pub, { body: hostile }).bodyText).toBe(hostile);
  });
});

describe("orderComments", () => {
  const row = (over: Partial<MediaCommentRow>): MediaCommentRow => ({
    id: "id",
    publicationId: "p",
    reviewLinkId: null,
    authorName: "Jay",
    timecodeMs: null,
    region: null,
    bodyText: "x",
    createdAt: "2026-09-15T00:00:00.000Z",
    resolvedAt: null,
    ...over,
  });

  it("puts general notes first, then walks up the timeline", () => {
    const ordered = orderComments([
      row({ id: "c", timecodeMs: 30_000 }),
      row({ id: "a", timecodeMs: null }),
      row({ id: "b", timecodeMs: 1_000 }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties by creation time, then by id, so the order is total", () => {
    const ordered = orderComments([
      row({ id: "z", timecodeMs: 1_000, createdAt: "2026-09-15T00:00:02.000Z" }),
      row({ id: "y", timecodeMs: 1_000, createdAt: "2026-09-15T00:00:01.000Z" }),
      row({ id: "a", timecodeMs: 1_000, createdAt: "2026-09-15T00:00:02.000Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["y", "a", "z"]);
  });

  it("does not mutate its input", () => {
    const input = [row({ id: "b", timecodeMs: 2 }), row({ id: "a", timecodeMs: 1 })];
    orderComments(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("listing, ordinals, and resolve", () => {
  it("numbers views from 1 in list order", () => {
    const pub = seedMedia();
    add(pub, { timecodeMs: 5_000 });
    add(pub, { timecodeMs: null });
    add(pub, { timecodeMs: 1_000 });

    const views = toCommentViews(listMediaComments(pub));
    expect(views.map((v) => [v.ordinal, v.timecodeMs])).toEqual([
      [1, null],
      [2, 1_000],
      [3, 5_000],
    ]);
  });

  it("marks a comment that arrived through a review link", () => {
    const pub = seedMedia();
    const authored = add(pub);
    expect(toCommentViews([authored])[0].viaLink).toBe(false);
  });

  it("resolves and reopens idempotently, and counts what is open", () => {
    const pub = seedMedia();
    const a = add(pub, { timecodeMs: 1_000 });
    add(pub, { timecodeMs: 2_000 });
    expect(countUnresolved(pub)).toBe(2);

    const resolved = setCommentResolved(pub, a.id, true);
    expect(resolved?.resolvedAt).toBeTruthy();
    expect(setCommentResolved(pub, a.id, true)?.resolvedAt).toBe(resolved?.resolvedAt);
    expect(countUnresolved(pub)).toBe(1);

    expect(setCommentResolved(pub, a.id, false)?.resolvedAt).toBeNull();
    expect(countUnresolved(pub)).toBe(2);
  });

  it("scopes a comment id to its publication", () => {
    const mine = seedMedia();
    const theirs = seedMedia();
    const comment = add(theirs);
    expect(getMediaComment(mine, comment.id)).toBeNull();
    expect(setCommentResolved(mine, comment.id, true)).toBeNull();
  });
});
