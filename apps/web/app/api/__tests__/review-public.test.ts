import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The public surface, attacked (§ media spec Phase C). These two routes are the
 * only part of Waypoint the open internet can reach, so the tests here are
 * mostly about what they refuse: an unknown id, a wrong or revoked token, a
 * token for another group, an oversized body, a flood, and — the one that would
 * be quietest if it broke — a `name` smuggled into the request body.
 *
 * No R2 anywhere: the review half is pure SQLite, which is also why it works on
 * a server with no bucket configured.
 */

import { setupTestDb } from "@/test/db";
import { getSqlite } from "@/lib/db/client";
import { insertPublication, type InsertPublicationInput } from "@/lib/publications";
import { addMediaComment } from "@/lib/review/comments";
import { createReviewLink, listReviewLinks, revokeReviewLink } from "@/lib/review/links";
import { IP_LIMIT_PER_MINUTE, resetRateLimits } from "@/lib/review/rate-limit";
import { GET as summaryRoute } from "@/app/api/r/[id]/route";
import {
  GET as listCommentsRoute,
  POST as postCommentRoute,
} from "@/app/api/r/[id]/comments/route";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());
beforeEach(() => resetRateLimits());

let seq = 0;
function seedMedia(overrides: Partial<InsertPublicationInput> = {}) {
  seq += 1;
  const row = insertPublication({
    id: `r-media-${seq}`,
    title: `Render ${seq}`,
    sanitizedName: `render-${seq}`,
    sourceMd: "",
    kind: "media",
    contentType: "video/mp4",
    r2Folder: `smitty/shares/r-media-${seq}`,
    publicBase: "dropzone.tylersavery.com",
    origin: "cli",
    ...overrides,
  });
  getSqlite()
    .prepare("UPDATE publications SET finalized_at = ? WHERE id = ?")
    .run(new Date().toISOString(), row.id);
  return row;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const summary = (id: string, k: string | null) =>
  summaryRoute(
    new Request(`http://localhost/api/r/${id}${k === null ? "" : `?k=${encodeURIComponent(k)}`}`),
    params(id),
  );

const listComments = (id: string, k: string | null) =>
  listCommentsRoute(
    new Request(
      `http://localhost/api/r/${id}/comments${k === null ? "" : `?k=${encodeURIComponent(k)}`}`,
    ),
    params(id),
  );

function postComment(id: string, body: unknown, headers: Record<string, string> = {}) {
  return postCommentRoute(
    new Request(`http://localhost/api/r/${id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    params(id),
  );
}

describe("GET /api/r/:id", () => {
  it("returns the render, its versions, and the reviewer's bound name", async () => {
    const v1 = seedMedia({ groupSlug: "vbtc", label: "v1", title: "vBTC v1" });
    const v2 = seedMedia({ groupSlug: "vbtc", label: "v2", title: "vBTC v2" });
    const link = createReviewLink(v1.id, "Jay");

    const body = await (await summary(v1.id, link.token)).json();
    expect(body.reviewer).toEqual({ name: "Jay" });
    expect(body.publication).toMatchObject({ id: v1.id, title: "vBTC v1", label: "v1" });
    expect(body.publication.fileUrl).toBe(
      `https://dropzone.tylersavery.com/${v1.r2Folder}/${v1.sanitizedName}.mp4`,
    );
    expect(body.versions.map((v: { id: string; current: boolean }) => [v.id, v.current])).toEqual([
      [v1.id, true],
      [v2.id, false],
    ]);
  });

  it("never leaks authoring metadata", async () => {
    const pub = seedMedia({ sourceHost: "studio.local", manifestJson: { secret: "shh" } });
    const link = createReviewLink(pub.id, "Jay");
    const body = await (await summary(pub.id, link.token)).json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("studio.local");
    expect(serialized).not.toContain("shh");
    expect(serialized).not.toContain(link.token);
    expect(body.publication.r2Folder).toBeUndefined();
  });

  it("opens a sibling version with the same link", async () => {
    const v1 = seedMedia({ groupSlug: "spot", label: "v1" });
    const v2 = seedMedia({ groupSlug: "spot", label: "v2" });
    const link = createReviewLink(v1.id, "Jay");
    expect((await summary(v2.id, link.token)).status).toBe(200);
  });

  it("is a flat 404 for a missing, wrong, revoked, or out-of-group token", async () => {
    const pub = seedMedia({ groupSlug: "mine" });
    const other = seedMedia({ groupSlug: "theirs" });
    const link = createReviewLink(pub.id, "Jay");

    expect((await summary(pub.id, null)).status).toBe(404);
    expect((await summary(pub.id, "not-a-token")).status).toBe(404);
    expect((await summary("no-such-publication", link.token)).status).toBe(404);
    expect((await summary(other.id, link.token)).status).toBe(404);

    revokeReviewLink(pub.id, link.id);
    const revoked = await summary(pub.id, link.token);
    expect(revoked.status).toBe(404);
    // Identical body in every case — the outside learns nothing from the difference.
    expect(await revoked.json()).toEqual({
      error: { code: "not_found", message: "Not found." },
    });
  });

  it("records that the link was opened", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    await summary(pub.id, link.token);
    expect(listReviewLinks(pub.id)[0].lastSeenAt).toBeTruthy();
  });
});

describe("POST /api/r/:id/comments", () => {
  it("attributes the note to the link's reviewer and stores the anchor", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");

    const res = await postComment(pub.id, {
      k: link.token,
      timecodeMs: 12_400,
      region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      body: "the wordmark lands too late here",
    });
    expect(res.status).toBe(201);

    const { comment } = await res.json();
    expect(comment.authorName).toBe("Jay");
    expect(comment.timecodeMs).toBe(12_400);
    expect(comment.region).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(comment.body).toBe("the wordmark lands too late here");
  });

  it("ignores a name in the body — attribution comes from the link, only", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");

    const { comment } = await (
      await postComment(pub.id, {
        k: link.token,
        body: "posting as someone else",
        name: "Aaron",
        author: "Aaron",
        authorName: "Aaron",
      })
    ).json();
    expect(comment.authorName).toBe("Jay");
  });

  it("numbers a new note by its place in the whole list, not as c1", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    await postComment(pub.id, { k: link.token, timecodeMs: null, body: "general" });
    const second = await (
      await postComment(pub.id, { k: link.token, timecodeMs: 12_400, body: "at the wordmark" })
    ).json();
    expect(second.comment.ordinal).toBe(2);
  });

  it("stores a general note with no timecode", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    const { comment } = await (
      await postComment(pub.id, { k: link.token, body: "overall pace is right" })
    ).json();
    expect(comment.timecodeMs).toBeNull();
  });

  it("stores hostile text verbatim, for the renderer to escape", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    const hostile = '<img src=x onerror=alert(1)> <script>alert("x")</script>';
    const { comment } = await (
      await postComment(pub.id, { k: link.token, body: hostile })
    ).json();
    expect(comment.body).toBe(hostile);
  });

  it("refuses an oversized body", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    const res = await postComment(pub.id, { k: link.token, body: "a".repeat(4097) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("body_too_long");
  });

  it("refuses an empty body and a region outside the frame", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    expect((await postComment(pub.id, { k: link.token, body: "   " })).status).toBe(400);
    expect(
      (
        await postComment(pub.id, {
          k: link.token,
          body: "x",
          region: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
        })
      ).status,
    ).toBe(400);
  });

  it("is a 404 for a bad token, before any rate limit is spent", async () => {
    const pub = seedMedia();
    createReviewLink(pub.id, "Jay");
    const res = await postComment(pub.id, { k: "nope", body: "x" });
    expect(res.status).toBe(404);
  });

  it("refuses the 31st comment from one address inside a minute", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    const headers = { "cf-connecting-ip": "203.0.113.9" };

    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) {
      expect((await postComment(pub.id, { k: link.token, body: `note ${i}` }, headers)).status).toBe(
        201,
      );
    }
    const refused = await postComment(pub.id, { k: link.token, body: "one too many" }, headers);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe("rate_limited");
  });
});

describe("GET /api/r/:id/comments", () => {
  it("lists notes in digest order, with resolved state and no link ids", async () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    addMediaComment({
      publicationId: pub.id,
      reviewLinkId: link.id,
      authorName: "Jay",
      timecodeMs: 5_000,
      body: "later",
    });
    addMediaComment({
      publicationId: pub.id,
      reviewLinkId: link.id,
      authorName: "Jay",
      timecodeMs: null,
      body: "general",
    });

    const { comments } = await (await listComments(pub.id, link.token)).json();
    expect(comments.map((c: { body: string }) => c.body)).toEqual(["general", "later"]);
    expect(comments[0].ordinal).toBe(1);
    expect(comments[0].resolved).toBe(false);
    expect(Object.keys(comments[0])).not.toContain("reviewLinkId");
  });

  it("is a 404 without a valid token", async () => {
    const pub = seedMedia();
    createReviewLink(pub.id, "Jay");
    expect((await listComments(pub.id, null)).status).toBe(404);
    expect((await listComments(pub.id, "nope")).status).toBe(404);
  });
});
