import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";

/**
 * The authoring half of the review loop (decision C-4): minting and revoking
 * review links, reading the notes, resolving them, and exporting the digest an
 * agent acts on. All behind the standard token gate (proven in `auth.test.ts`),
 * all pure SQLite — no R2 call, and so no `publish_unavailable` gate.
 */

import { setupTestDb } from "@/test/db";
import { getSqlite } from "@/lib/db/client";
import { insertPublication, type InsertPublicationInput } from "@/lib/publications";
import { addMediaComment } from "@/lib/review/comments";
import { GET as listLinksRoute, POST as createLinkRoute } from "@/app/api/publications/[id]/review-links/route";
import { POST as revokeLinkRoute } from "@/app/api/publications/[id]/review-links/[linkId]/revoke/route";
import { GET as listCommentsRoute } from "@/app/api/publications/[id]/comments/route";
import { POST as resolveRoute } from "@/app/api/publications/[id]/comments/[commentId]/resolve/route";
import { POST as unresolveRoute } from "@/app/api/publications/[id]/comments/[commentId]/unresolve/route";
import { GET as exportRoute } from "@/app/api/publications/[id]/export/route";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

const PUBLIC_URL = process.env.WAYPOINT_REVIEW_PUBLIC_URL;
afterEach(() => {
  if (PUBLIC_URL === undefined) delete process.env.WAYPOINT_REVIEW_PUBLIC_URL;
  else process.env.WAYPOINT_REVIEW_PUBLIC_URL = PUBLIC_URL;
});

let seq = 0;
function seedMedia(overrides: Partial<InsertPublicationInput> = {}) {
  seq += 1;
  const row = insertPublication({
    id: `a-media-${seq}`,
    title: `Render ${seq}`,
    sanitizedName: `render-${seq}`,
    sourceMd: "",
    kind: "media",
    contentType: "video/mp4",
    groupSlug: "vbtc-unwrapped",
    label: "v2",
    r2Folder: `smitty/shares/a-media-${seq}`,
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
const post = (url = "http://localhost/x") => new Request(url, { method: "POST" });

function createLink(id: string, body: unknown) {
  return createLinkRoute(
    new Request(`http://localhost/api/publications/${id}/review-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id),
  );
}

describe("POST /api/publications/:id/review-links", () => {
  it("mints a link and returns the absolute public URL to hand over", async () => {
    process.env.WAYPOINT_REVIEW_PUBLIC_URL = "https://review.tylersavery.com/";
    const pub = seedMedia();

    const res = await createLink(pub.id, { name: "Jay" });
    expect(res.status).toBe(201);
    const { link } = await res.json();
    expect(link.reviewerName).toBe("Jay");
    expect(link.url).toBe(`https://review.tylersavery.com/r/${pub.id}?k=${link.token}`);
    expect(link.revoked).toBe(false);
  });

  it("falls back to a relative URL when no public base is configured", async () => {
    delete process.env.WAYPOINT_REVIEW_PUBLIC_URL;
    const pub = seedMedia();
    const { link } = await (await createLink(pub.id, { name: "Jay" })).json();
    expect(link.url).toBe(`/r/${pub.id}?k=${link.token}`);
  });

  it("requires a reviewer name", async () => {
    const pub = seedMedia();
    expect((await createLink(pub.id, {})).status).toBe(400);
    expect((await createLink(pub.id, { name: "   " })).status).toBe(400);
  });

  it("refuses an unknown publication and a markdown one", async () => {
    expect((await createLink("nope", { name: "Jay" })).status).toBe(404);

    const md = insertPublication({
      id: "a-md-1",
      title: "A plan",
      sanitizedName: "a-plan",
      sourceMd: "# A plan",
      r2Folder: "smitty/shares/a-md-1",
      publicBase: "dropzone.tylersavery.com",
      origin: "cli",
    });
    const res = await createLink(md.id, { name: "Jay" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("not_media");
  });
});

describe("GET + revoke /api/publications/:id/review-links", () => {
  it("lists every link for the publication with its URL", async () => {
    const pub = seedMedia();
    await createLink(pub.id, { name: "Jay" });
    await createLink(pub.id, { name: "Aaron" });

    const { links, publicBase } = await (
      await listLinksRoute(new Request("http://localhost/x"), params(pub.id))
    ).json();
    expect(links.map((l: { reviewerName: string }) => l.reviewerName)).toEqual(["Jay", "Aaron"]);
    expect(links[0].url).toContain(`/r/${pub.id}?k=`);
    expect(publicBase === null || typeof publicBase === "string").toBe(true);
  });

  it("revokes a link, idempotently, and 404s one from another publication", async () => {
    const pub = seedMedia();
    const other = seedMedia();
    const { link } = await (await createLink(pub.id, { name: "Jay" })).json();

    const ctx = { params: Promise.resolve({ id: pub.id, linkId: link.id }) };
    const first = await revokeLinkRoute(post(), ctx);
    expect(first.status).toBe(200);
    expect((await first.json()).link.revoked).toBe(true);

    const again = await revokeLinkRoute(post(), {
      params: Promise.resolve({ id: pub.id, linkId: link.id }),
    });
    expect(again.status).toBe(200);

    const wrongPublication = await revokeLinkRoute(post(), {
      params: Promise.resolve({ id: other.id, linkId: link.id }),
    });
    expect(wrongPublication.status).toBe(404);
  });
});

describe("comments and resolve", () => {
  function seedComments(publicationId: string) {
    const first = addMediaComment({
      publicationId,
      reviewLinkId: null,
      authorName: "Jay",
      timecodeMs: 12_400,
      body: "the wordmark lands too late here",
    });
    const second = addMediaComment({
      publicationId,
      reviewLinkId: null,
      authorName: "Jay",
      timecodeMs: null,
      body: "overall pace is right",
    });
    if (!first.ok || !second.ok) throw new Error("seed failed");
    return { timed: first.row, general: second.row };
  }

  it("lists notes in digest order with ordinals and an unresolved count", async () => {
    const pub = seedMedia();
    seedComments(pub.id);

    const body = await (
      await listCommentsRoute(new Request("http://localhost/x"), params(pub.id))
    ).json();
    expect(body.unresolved).toBe(2);
    expect(body.comments.map((c: { ordinal: number; body: string }) => [c.ordinal, c.body])).toEqual([
      [1, "overall pace is right"],
      [2, "the wordmark lands too late here"],
    ]);
  });

  it("resolves and reopens a note", async () => {
    const pub = seedMedia();
    const { timed } = seedComments(pub.id);
    const ctx = () => ({ params: Promise.resolve({ id: pub.id, commentId: timed.id }) });

    const resolved = await resolveRoute(post(), ctx());
    expect((await resolved.json()).comment.resolved).toBe(true);
    expect((await resolveRoute(post(), ctx())).status).toBe(200);

    const reopened = await unresolveRoute(post(), ctx());
    expect((await reopened.json()).comment.resolved).toBe(false);
  });

  it("404s a comment id from another publication", async () => {
    const mine = seedMedia();
    const theirs = seedMedia();
    const { timed } = seedComments(theirs.id);
    const res = await resolveRoute(post(), {
      params: Promise.resolve({ id: mine.id, commentId: timed.id }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/publications/:id/export?format=digest", () => {
  it("returns the SPEC §9.4 digest as a markdown attachment", async () => {
    const pub = seedMedia({ title: "vBTC Unwrapped" });
    addMediaComment({
      publicationId: pub.id,
      reviewLinkId: null,
      authorName: "Jay",
      timecodeMs: 12_400,
      region: { x: 0.12, y: 0.34, w: 0.25, h: 0.18 },
      body: "the wordmark lands too late here",
    });

    const res = await exportRoute(
      new Request(`http://localhost/api/publications/${pub.id}/export?format=digest`),
      params(pub.id),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${pub.sanitizedName}.digest.md"`,
    );

    const body = await res.text();
    expect(body).toContain("waypoint_digest: 1");
    expect(body).toContain("kind: media");
    expect(body).toContain('**Anchor:** "00:12.4"');
    expect(body).toContain("**Region:** 0.120,0.340,0.250,0.180");
    expect(body).toContain("**By:** Jay");
  });

  it("defaults to the digest format and rejects any other", async () => {
    const pub = seedMedia();
    expect(
      (
        await exportRoute(
          new Request(`http://localhost/api/publications/${pub.id}/export`),
          params(pub.id),
        )
      ).status,
    ).toBe(200);

    const bad = await exportRoute(
      new Request(`http://localhost/api/publications/${pub.id}/export?format=annotated`),
      params(pub.id),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("unsupported_format");
  });

  it("hides resolved notes unless asked for them", async () => {
    const pub = seedMedia();
    const added = addMediaComment({
      publicationId: pub.id,
      reviewLinkId: null,
      authorName: "Jay",
      timecodeMs: 1_000,
      body: "already handled",
    });
    if (!added.ok) throw new Error("seed failed");
    await resolveRoute(post(), {
      params: Promise.resolve({ id: pub.id, commentId: added.row.id }),
    });

    const hidden = await (
      await exportRoute(
        new Request(`http://localhost/api/publications/${pub.id}/export?format=digest`),
        params(pub.id),
      )
    ).text();
    expect(hidden).not.toContain("already handled");

    const shown = await (
      await exportRoute(
        new Request(`http://localhost/api/publications/${pub.id}/export?format=digest&resolved=1`),
        params(pub.id),
      )
    ).text();
    expect(shown).toContain("already handled");
  });

  it("404s an unknown id and refuses a markdown publication", async () => {
    expect(
      (await exportRoute(new Request("http://localhost/x?format=digest"), params("nope"))).status,
    ).toBe(404);

    const md = insertPublication({
      id: "a-md-2",
      title: "A plan",
      sanitizedName: "a-plan-2",
      sourceMd: "# A plan",
      r2Folder: "smitty/shares/a-md-2",
      publicBase: "dropzone.tylersavery.com",
      origin: "cli",
    });
    const res = await exportRoute(new Request("http://localhost/x?format=digest"), params(md.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("not_media");
  });
});
