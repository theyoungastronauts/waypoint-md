import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `constantTimeEqual` is wrapped rather than replaced: the real comparison still
 * runs (so every assertion below is about real behaviour), and the wrapper only
 * records that the check went through it. The unique index on `token` would
 * otherwise make a plain equality check look identical from the outside, and the
 * point of decision C-1 is which comparison the app performs.
 */
const auth = vi.hoisted(() => ({ calls: [] as Array<[string, string]> }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    constantTimeEqual(a: string, b: string) {
      auth.calls.push([a, b]);
      return actual.constantTimeEqual(a, b);
    },
  };
});

import { setupTestDb } from "@/test/db";
import { getSqlite } from "@/lib/db/client";
import { insertPublication, type InsertPublicationInput } from "@/lib/publications";
import {
  createReviewLink,
  listReviewLinks,
  resolveReviewAccess,
  revokeReviewLink,
  touchLastSeen,
} from "@/lib/review/links";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());
beforeEach(() => {
  auth.calls = [];
});

let seq = 0;

/** A finalized media publication — the only kind a review link may open. */
function seedMedia(overrides: Partial<InsertPublicationInput> = {}) {
  seq += 1;
  const row = insertPublication({
    id: `media-${seq}`,
    title: `Render ${seq}`,
    sanitizedName: `render-${seq}`,
    sourceMd: "",
    kind: "media",
    contentType: "video/mp4",
    r2Folder: `smitty/shares/media-${seq}`,
    publicBase: "dropzone.tylersavery.com",
    origin: "cli",
    ...overrides,
  });
  // `finalized_at` is stamped by the finalize call, which is not in play here.
  getSqlite()
    .prepare("UPDATE publications SET finalized_at = ? WHERE id = ?")
    .run(new Date().toISOString(), row.id);
  return row;
}

describe("createReviewLink", () => {
  it("mints a 32-byte token and binds the reviewer's name", () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "  Jay  ");
    expect(link.reviewerName).toBe("Jay");
    expect(link.token).toMatch(/^[0-9a-f]{64}$/);
    expect(link.revokedAt).toBeNull();
  });

  it("gives every link its own token", () => {
    const pub = seedMedia();
    const a = createReviewLink(pub.id, "Jay");
    const b = createReviewLink(pub.id, "Aaron");
    expect(a.token).not.toBe(b.token);
    expect(listReviewLinks(pub.id).map((l) => l.reviewerName)).toEqual(["Jay", "Aaron"]);
  });
});

describe("resolveReviewAccess", () => {
  it("opens the link's own publication, through the constant-time compare", () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    const access = resolveReviewAccess(link.token, pub.id);
    expect(access?.publication.id).toBe(pub.id);
    expect(access?.link.reviewerName).toBe("Jay");
    expect(auth.calls).toContainEqual([link.token, link.token]);
  });

  it("opens a later version of the same material — a v1 link still works on v2", () => {
    const v1 = seedMedia({ groupSlug: "vbtc-unwrapped", label: "v1" });
    const v2 = seedMedia({ groupSlug: "vbtc-unwrapped", label: "v2" });
    const link = createReviewLink(v1.id, "Jay");
    expect(resolveReviewAccess(link.token, v2.id)?.publication.id).toBe(v2.id);
  });

  it("refuses a publication in another group, or in none", () => {
    const mine = seedMedia({ groupSlug: "vbtc-unwrapped", label: "v1" });
    const theirs = seedMedia({ groupSlug: "other-spot", label: "v1" });
    const ungrouped = seedMedia();
    const link = createReviewLink(mine.id, "Jay");
    expect(resolveReviewAccess(link.token, theirs.id)).toBeNull();
    expect(resolveReviewAccess(link.token, ungrouped.id)).toBeNull();
  });

  it("refuses a link whose own publication has no group, against a different one", () => {
    const solo = seedMedia();
    const other = seedMedia({ groupSlug: "vbtc-unwrapped" });
    const link = createReviewLink(solo.id, "Jay");
    expect(resolveReviewAccess(link.token, other.id)).toBeNull();
  });

  it("refuses a revoked link", () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    revokeReviewLink(pub.id, link.id);
    expect(resolveReviewAccess(link.token, pub.id)).toBeNull();
  });

  it("refuses an unknown, empty, or absent token", () => {
    const pub = seedMedia();
    createReviewLink(pub.id, "Jay");
    expect(resolveReviewAccess("nope", pub.id)).toBeNull();
    expect(resolveReviewAccess("", pub.id)).toBeNull();
    expect(resolveReviewAccess(null, pub.id)).toBeNull();
    expect(resolveReviewAccess(undefined, pub.id)).toBeNull();
  });

  it("refuses a publication whose upload never landed", () => {
    const unfinalized = insertPublication({
      id: "media-unfinalized",
      title: "Half a render",
      sanitizedName: "half",
      sourceMd: "",
      kind: "media",
      contentType: "video/mp4",
      r2Folder: "smitty/shares/half",
      publicBase: "dropzone.tylersavery.com",
      origin: "cli",
    });
    const link = createReviewLink(unfinalized.id, "Jay");
    expect(resolveReviewAccess(link.token, unfinalized.id)).toBeNull();
  });

  it("refuses a revoked publication — the objects it played are gone", () => {
    const revoked = seedMedia();
    const link = createReviewLink(revoked.id, "Jay");
    getSqlite()
      .prepare("UPDATE publications SET revoked_at = ? WHERE id = ?")
      .run(new Date().toISOString(), revoked.id);
    expect(resolveReviewAccess(link.token, revoked.id)).toBeNull();
  });

  it("refuses a markdown publication — there is nothing to review", () => {
    const md = insertPublication({
      id: "md-plan",
      title: "A plan",
      sanitizedName: "a-plan",
      sourceMd: "# A plan",
      r2Folder: "smitty/shares/a-plan",
      publicBase: "dropzone.tylersavery.com",
      origin: "cli",
    });
    const link = createReviewLink(md.id, "Jay");
    expect(resolveReviewAccess(link.token, md.id)).toBeNull();
  });

  it("refuses a token that differs by one character", () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    const off = `${link.token.slice(0, -1)}${link.token.endsWith("a") ? "b" : "a"}`;
    expect(resolveReviewAccess(off, pub.id)).toBeNull();
  });
});

describe("revokeReviewLink", () => {
  it("is idempotent and keeps the first timestamp", () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    const first = revokeReviewLink(pub.id, link.id);
    const second = revokeReviewLink(pub.id, link.id);
    expect(first?.revokedAt).toBeTruthy();
    expect(second?.revokedAt).toBe(first?.revokedAt);
  });

  it("refuses a link id that belongs to another publication", () => {
    const mine = seedMedia();
    const theirs = seedMedia();
    const link = createReviewLink(theirs.id, "Jay");
    expect(revokeReviewLink(mine.id, link.id)).toBeNull();
  });
});

describe("touchLastSeen", () => {
  it("records when a link was last opened", () => {
    const pub = seedMedia();
    const link = createReviewLink(pub.id, "Jay");
    expect(link.lastSeenAt).toBeNull();
    touchLastSeen(link.id, "2026-09-15T10:00:00.000Z");
    expect(listReviewLinks(pub.id)[0].lastSeenAt).toBe("2026-09-15T10:00:00.000Z");
  });
});
