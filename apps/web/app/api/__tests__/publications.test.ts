import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

// --- Mock puppeteer: no Chrome, ever. `pdf()` returns a tiny fixed buffer. ---
vi.mock("puppeteer", () => ({
  default: {
    launch: async () => ({
      newPage: async () => ({
        setContent: async () => {},
        pdf: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF"
      }),
      close: async () => {},
    }),
  },
}));

// --- Mock the R2 S3 client: record puts/deletes, script list/get for backfill. ---
const s3 = vi.hoisted(() => ({
  puts: [] as Array<{ Bucket: string; Key: string; ContentType?: string; Body: unknown }>,
  deletes: [] as Array<{ Bucket: string; Key: string }>,
  /** ListObjectsV2 result contents (Key + LastModified). */
  objects: [] as Array<{ Key: string; LastModified?: Date }>,
  /** GetObject bodies, keyed by object key. */
  bodies: new Map<string, string>(),
  reset() {
    this.puts = [];
    this.deletes = [];
    this.objects = [];
    this.bodies = new Map();
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: { Bucket: string; Key: string; ContentType?: string; Body: unknown };
    __type = "put" as const;
    constructor(input: PutObjectCommand["input"]) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: { Bucket: string; Key: string };
    __type = "delete" as const;
    constructor(input: DeleteObjectCommand["input"]) {
      this.input = input;
    }
  }
  class ListObjectsV2Command {
    input: { Bucket: string; Prefix?: string; ContinuationToken?: string };
    __type = "list" as const;
    constructor(input: ListObjectsV2Command["input"]) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: { Bucket: string; Key: string };
    __type = "get" as const;
    constructor(input: GetObjectCommand["input"]) {
      this.input = input;
    }
  }
  class S3Client {
    async send(cmd: { __type: string; input: Record<string, unknown> }) {
      switch (cmd.__type) {
        case "put":
          s3.puts.push(cmd.input as (typeof s3.puts)[number]);
          return {};
        case "delete":
          s3.deletes.push(cmd.input as (typeof s3.deletes)[number]);
          return {};
        case "list":
          return { Contents: s3.objects, IsTruncated: false };
        case "get": {
          const body = s3.bodies.get(cmd.input.Key as string) ?? "";
          return { Body: { transformToString: async () => body } };
        }
        default:
          throw new Error(`unexpected command ${cmd.__type}`);
      }
    }
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand };
});

import { setupTestDb } from "@/test/db";
import { GET as listRoute, POST as createRoute } from "@/app/api/publications/route";
import { GET as detailRoute } from "@/app/api/publications/[id]/route";
import { POST as revokeRoute } from "@/app/api/publications/[id]/revoke/route";
import { POST as backfillRoute } from "@/app/api/publications/backfill/route";

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

const ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_DOMAIN",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "ak";
  process.env.R2_SECRET_ACCESS_KEY = "sk";
  process.env.R2_BUCKET_NAME = "dropzone";
  process.env.R2_PUBLIC_DOMAIN = "dropzone.tylersavery.com";
  s3.reset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function create(body: unknown): Promise<Response> {
  return createRoute(
    new Request("http://localhost/api/publications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/publications", () => {
  it("renders, uploads three objects, indexes the row, and returns urls", async () => {
    const res = await create({ markdown: "# My Plan\n\nHello world", filename: "my-plan.md" });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.title).toBe("My Plan");
    expect(body.id).toBeTruthy();
    const base = `https://dropzone.tylersavery.com/smitty/shares/${body.id}/my-plan`;
    expect(body.urls).toEqual({ html: `${base}.html`, pdf: `${base}.pdf`, md: `${base}.md` });

    // Exactly three objects, correct keys + content types.
    expect(s3.puts).toHaveLength(3);
    const byExt = Object.fromEntries(s3.puts.map((p) => [p.Key.split(".").pop(), p]));
    expect(byExt.html.Key).toBe(`smitty/shares/${body.id}/my-plan.html`);
    expect(byExt.html.ContentType).toBe("text/html; charset=utf-8");
    expect(byExt.pdf.ContentType).toBe("application/pdf");
    expect(byExt.md.ContentType).toBe("text/markdown; charset=utf-8");

    // The web HTML carries the share bar; the markdown object is the source bytes.
    expect(String(byExt.html.Body)).toContain('<div class="share-bar">');
    expect(String(byExt.html.Body)).toContain("Download PDF");
    expect(byExt.md.Body).toBe("# My Plan\n\nHello world");
    expect(byExt.pdf.Body).toBeInstanceOf(Uint8Array);
  });

  it("records origin=cli and the host when a source is sent", async () => {
    const res = await create({ markdown: "# CLI\n\nx", filename: "cli.md", source: { host: "mini.local" } });
    const { id } = await res.json();
    const detail = await (await detailRoute(new Request("http://localhost/x"), params(id))).json();
    expect(detail.publication.origin).toBe("cli");
    expect(detail.publication.sourceHost).toBe("mini.local");
  });

  it("derives the slug from the title when no filename is given", async () => {
    const res = await create({ markdown: "body only, no heading", title: "Quarterly Review" });
    const body = await res.json();
    expect(body.title).toBe("Quarterly Review");
    expect(body.urls.html).toContain(`/quarterly-review.html`);
  });

  it("rejects an empty markdown body", async () => {
    const res = await create({ markdown: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/publications", () => {
  it("lists newest first and filters by FTS query", async () => {
    const a = await (await create({ markdown: "# Alpha Doc\n\nunicorn contents", filename: "alpha.md" })).json();
    const b = await (await create({ markdown: "# Beta Doc\n\ndragon contents", filename: "beta.md" })).json();

    const all = await (await listRoute(new Request("http://localhost/api/publications"))).json();
    const allIds = all.publications.map((p: { id: string }) => p.id);
    expect(allIds).toContain(a.id);
    expect(allIds).toContain(b.id);
    // Summaries carry urls and a revoked flag, but not the (heavy) source markdown.
    const summary = all.publications.find((p: { id: string }) => p.id === a.id);
    expect(summary.urls.html).toContain("/alpha.html");
    expect(summary.revoked).toBe(false);
    expect(summary.sourceMd).toBeUndefined();

    const hits = await (await listRoute(new Request("http://localhost/api/publications?q=unicorn"))).json();
    const hitIds = hits.publications.map((p: { id: string }) => p.id);
    expect(hitIds).toContain(a.id);
    expect(hitIds).not.toContain(b.id);
  });

  it("survives a hostile FTS query without a 500", async () => {
    const res = await listRoute(new Request(`http://localhost/api/publications?q=${encodeURIComponent('foo AND "(')}`));
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).publications)).toBe(true);
  });

  it("paginates with limit + offset and reports nextOffset until the last page", async () => {
    for (let i = 0; i < 3; i++) {
      await create({ markdown: `# Doc ${i}\n\nbody ${i}`, filename: `doc-${i}.md` });
    }
    // Walk pages from the start; the shared test DB may hold rows from earlier
    // tests, so assert the pagination invariants rather than an absolute count.
    const seen: string[] = [];
    let offset = 0;
    let pages = 0;
    for (;;) {
      const page = await (
        await listRoute(new Request(`http://localhost/api/publications?limit=2&offset=${offset}`))
      ).json();
      pages += 1;
      seen.push(...page.publications.map((p: { id: string }) => p.id));
      if (page.nextOffset === null) {
        // Last page is short (or exactly fills, but then there'd be no null yet):
        expect(page.publications.length).toBeLessThanOrEqual(2);
        break;
      }
      expect(page.publications).toHaveLength(2); // a full page carries a cursor
      expect(page.nextOffset).toBe(offset + 2);
      offset = page.nextOffset;
    }
    expect(pages).toBeGreaterThanOrEqual(2);
    // Pages never overlap: every id seen exactly once.
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("GET /api/publications/:id", () => {
  it("returns the full row including source markdown", async () => {
    const created = await (await create({ markdown: "# Detail\n\nfull source", filename: "detail.md" })).json();
    const res = await detailRoute(new Request("http://localhost/x"), params(created.id));
    expect(res.status).toBe(200);
    const { publication } = await res.json();
    expect(publication.sourceMd).toBe("# Detail\n\nfull source");
    expect(publication.r2Folder).toBe(`smitty/shares/${created.id}`);
  });

  it("404s for an unknown id", async () => {
    const res = await detailRoute(new Request("http://localhost/x"), params("nope"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/publications/:id/revoke", () => {
  it("deletes the three objects, stamps revoked_at, and is idempotent", async () => {
    const created = await (await create({ markdown: "# Revoke Me\n\nx", filename: "revoke-me.md" })).json();

    const first = await revokeRoute(new Request("http://localhost/x", { method: "POST" }), params(created.id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.publication.revoked).toBe(true);
    expect(firstBody.publication.revokedAt).toBeTruthy();

    // Three DeleteObject calls with the right keys.
    expect(s3.deletes.map((d) => d.Key).sort()).toEqual(
      [
        `smitty/shares/${created.id}/revoke-me.html`,
        `smitty/shares/${created.id}/revoke-me.md`,
        `smitty/shares/${created.id}/revoke-me.pdf`,
      ].sort(),
    );

    // Second revoke: still 200, timestamp unchanged (idempotent).
    const second = await revokeRoute(new Request("http://localhost/x", { method: "POST" }), params(created.id));
    expect(second.status).toBe(200);
    expect((await second.json()).publication.revokedAt).toBe(firstBody.publication.revokedAt);
  });

  it("404s for an unknown id", async () => {
    const res = await revokeRoute(new Request("http://localhost/x", { method: "POST" }), params("nope"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/publications/backfill", () => {
  it("indexes existing objects idempotently, dating rows from LastModified", async () => {
    const lm = new Date("2025-01-02T03:04:05.000Z");
    s3.objects = [
      { Key: "smitty/shares/uuid-a/first.md", LastModified: lm },
      { Key: "smitty/shares/uuid-a/first.html", LastModified: lm },
      { Key: "smitty/shares/uuid-a/first.pdf", LastModified: lm },
      { Key: "smitty/shares/uuid-b/second.md", LastModified: lm },
    ];
    s3.bodies.set("smitty/shares/uuid-a/first.md", "# First\n\nalpha");
    s3.bodies.set("smitty/shares/uuid-b/second.md", "# Second\n\nbeta");

    const first = await (await backfillRoute()).json();
    expect(first).toEqual({ indexed: 2, skipped: 0 });

    // Rows exist keyed by the folder uuid, origin backfill, dated from LastModified.
    const a = await (await detailRoute(new Request("http://localhost/x"), params("uuid-a"))).json();
    expect(a.publication.origin).toBe("backfill");
    expect(a.publication.title).toBe("First");
    expect(a.publication.createdAt).toBe(lm.toISOString());
    expect(a.publication.urls.html).toBe("https://dropzone.tylersavery.com/smitty/shares/uuid-a/first.html");

    // Re-running skips everything (idempotent by primary key).
    const second = await (await backfillRoute()).json();
    expect(second).toEqual({ indexed: 0, skipped: 2 });
  });
});

describe("degradation — no R2 credentials", () => {
  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
  });

  it("returns 400 publish_unavailable on every endpoint and stores nothing", async () => {
    const post = await create({ markdown: "# X\n\ny", filename: "x.md" });
    expect(post.status).toBe(400);
    expect((await post.json()).error.code).toBe("publish_unavailable");
    expect(s3.puts).toHaveLength(0);

    const list = await listRoute(new Request("http://localhost/api/publications"));
    expect(list.status).toBe(400);

    const detail = await detailRoute(new Request("http://localhost/x"), params("any"));
    expect(detail.status).toBe(400);

    const revoke = await revokeRoute(new Request("http://localhost/x", { method: "POST" }), params("any"));
    expect(revoke.status).toBe(400);

    const backfill = await backfillRoute();
    expect(backfill.status).toBe(400);
  });
});
