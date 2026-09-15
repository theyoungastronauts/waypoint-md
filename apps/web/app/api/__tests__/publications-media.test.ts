import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

/**
 * The presigned media flow, end to end against mocks (§ media spec Phase B).
 * R2 is never called: the S3 client records commands and answers HEAD from a
 * scripted set of "objects that exist", and the presigner hands back a
 * deterministic URL. Between them the two mocks can prove everything the flow
 * turns on — what gets written, what the upload URL is signed for, and what
 * happens when the bytes never arrive.
 */

const s3 = vi.hoisted(() => ({
  puts: [] as Array<{ Bucket: string; Key: string; ContentType?: string; Body: unknown }>,
  deletes: [] as Array<{ Bucket: string; Key: string }>,
  heads: [] as Array<{ Bucket: string; Key: string }>,
  /** Keys that exist in the bucket, with the size a HEAD reports. */
  objects: new Map<string, number>(),
  reset() {
    this.puts = [];
    this.deletes = [];
    this.heads = [];
    this.objects = new Map();
  },
}));

const presigner = vi.hoisted(() => ({
  calls: [] as Array<{ input: Record<string, unknown>; expiresIn?: number }>,
  reset() {
    this.calls = [];
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class NotFound extends Error {
    name = "NotFound";
    $metadata = { httpStatusCode: 404 };
  }
  class PutObjectCommand {
    __type = "put" as const;
    constructor(public input: { Bucket: string; Key: string; ContentType?: string; Body: unknown }) {}
  }
  class DeleteObjectCommand {
    __type = "delete" as const;
    constructor(public input: { Bucket: string; Key: string }) {}
  }
  class HeadObjectCommand {
    __type = "head" as const;
    constructor(public input: { Bucket: string; Key: string }) {}
  }
  class ListObjectsV2Command {
    __type = "list" as const;
    constructor(public input: { Bucket: string; Prefix?: string }) {}
  }
  class GetObjectCommand {
    __type = "get" as const;
    constructor(public input: { Bucket: string; Key: string }) {}
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
        case "head": {
          const head = cmd.input as (typeof s3.heads)[number];
          s3.heads.push(head);
          const size = s3.objects.get(head.Key);
          if (size === undefined) throw new NotFound("Not Found");
          return { ContentLength: size, ContentType: "video/mp4" };
        }
        case "list":
          return { Contents: [], IsTruncated: false };
        default:
          throw new Error(`unexpected command ${cmd.__type}`);
      }
    }
  }
  return {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    GetObjectCommand,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (
    _client: unknown,
    command: { input: Record<string, unknown> },
    options?: { expiresIn?: number },
  ) => {
    presigner.calls.push({ input: command.input, expiresIn: options?.expiresIn });
    return `https://signed.example/${String(command.input.Key)}?sig=stub`;
  },
}));

// Puppeteer is only reached by the markdown door, which this file does not
// exercise — but the route module graph imports it, so it stays stubbed.
vi.mock("puppeteer", () => ({
  default: {
    launch: async () => ({
      newPage: async () => ({ setContent: async () => {}, pdf: async () => new Uint8Array([0x25]) }),
      close: async () => {},
    }),
  },
}));

import { setupTestDb } from "@/test/db";
import { getDb } from "@/lib/db/client";
import { publications } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GET as listRoute } from "@/app/api/publications/route";
import { GET as detailRoute } from "@/app/api/publications/[id]/route";
import { POST as mediaRoute } from "@/app/api/publications/media/route";
import { POST as finalizeRoute } from "@/app/api/publications/[id]/finalize/route";
import { POST as revokeRoute } from "@/app/api/publications/[id]/revoke/route";

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
  presigner.reset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function createMedia(body: unknown): Promise<Response> {
  return mediaRoute(
    new Request("http://localhost/api/publications/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const finalize = (id: string) =>
  finalizeRoute(new Request("http://localhost/x", { method: "POST" }), params(id));

/** Create → put the object in the mock bucket → finalize. The happy path. */
async function publishMedia(
  body: Record<string, unknown> = {},
  uploadedBytes?: number,
): Promise<{ id: string; key: string }> {
  const created = await (
    await createMedia({ filename: "render.mp4", contentType: "video/mp4", bytes: 1024, ...body })
  ).json();
  s3.objects.set(created.key, uploadedBytes ?? (typeof body.bytes === "number" ? body.bytes : 1024));
  await finalize(created.id);
  return created;
}

describe("POST /api/publications/media", () => {
  it("reserves a row and returns a presigned PUT signed for the exact object", async () => {
    const res = await createMedia({
      filename: "vBTC Unwrapped v2.mp4",
      contentType: "video/mp4",
      bytes: 2048,
      group: "vbtc-unwrapped",
      label: "v2",
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.id).toBeTruthy();
    expect(body.key).toBe(`smitty/shares/${body.id}/vbtc-unwrapped-v2.mp4`);
    expect(body.uploadUrl).toBe(`https://signed.example/${body.key}?sig=stub`);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());

    // The signature covers the bucket, the key, the type, and the exact length —
    // the URL is a capability for one object of one size, for 15 minutes.
    expect(presigner.calls).toHaveLength(1);
    expect(presigner.calls[0].input).toMatchObject({
      Bucket: "dropzone",
      Key: body.key,
      ContentType: "video/mp4",
      ContentLength: 2048,
    });
    expect(presigner.calls[0].expiresIn).toBe(900);

    // No bytes went through the server: nothing was uploaded by the create.
    expect(s3.puts).toHaveLength(0);
  });

  it("uploads the manifest beside the file as soon as it is given", async () => {
    const manifest = { title: "vBTC Unwrapped", composition: "wordmark-reveal", profile: "prores" };
    const res = await createMedia({
      filename: "spot.mp4",
      contentType: "video/mp4",
      bytes: 64,
      manifest,
    });
    const body = await res.json();

    expect(s3.puts).toHaveLength(1);
    expect(s3.puts[0].Key).toBe(`smitty/shares/${body.id}/spot.manifest.json`);
    expect(s3.puts[0].ContentType).toBe("application/json; charset=utf-8");
    expect(JSON.parse(String(s3.puts[0].Body))).toEqual(manifest);
  });

  it("takes its title from the manifest when none is given", async () => {
    const created = await publishMedia({
      filename: "spot-final.mp4",
      manifest: { title: "The Reliever Chain" },
    });
    const detail = await (await detailRoute(new Request("http://localhost/x"), params(created.id))).json();
    expect(detail.publication.title).toBe("The Reliever Chain");
  });

  it("falls back to the filename without its extension", async () => {
    const created = await publishMedia({ filename: "Wordmark Reveal.mov", contentType: "video/quicktime" });
    const detail = await (await detailRoute(new Request("http://localhost/x"), params(created.id))).json();
    expect(detail.publication.title).toBe("Wordmark Reveal");
  });

  it("rejects a content type outside the allowlist", async () => {
    const res = await createMedia({
      filename: "archive.zip",
      contentType: "application/zip",
      bytes: 10,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
    expect(presigner.calls).toHaveLength(0);
  });

  it("rejects a zero-byte file and one past the 4 GiB ceiling", async () => {
    const empty = await createMedia({ filename: "a.mp4", contentType: "video/mp4", bytes: 0 });
    expect(empty.status).toBe(400);

    const huge = await createMedia({
      filename: "a.mp4",
      contentType: "video/mp4",
      bytes: 4 * 1024 * 1024 * 1024 + 1,
    });
    expect(huge.status).toBe(400);

    expect(presigner.calls).toHaveLength(0);
  });

  it("sweeps an abandoned upload — objects first, then the row", async () => {
    const abandoned = await (
      await createMedia({
        filename: "never-arrived.mp4",
        contentType: "video/mp4",
        bytes: 99,
        manifest: { composition: "ghost" },
      })
    ).json();

    // Backdate it past the one-hour window; its presigned URL expired 45 minutes ago.
    getDb()
      .update(publications)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
      .where(eq(publications.id, abandoned.id))
      .run();

    s3.reset();
    await createMedia({ filename: "next.mp4", contentType: "video/mp4", bytes: 10 });

    expect(s3.deletes.map((d) => d.Key).sort()).toEqual(
      [
        `smitty/shares/${abandoned.id}/never-arrived.mp4`,
        `smitty/shares/${abandoned.id}/never-arrived.manifest.json`,
      ].sort(),
    );

    const gone = await detailRoute(new Request("http://localhost/x"), params(abandoned.id));
    expect(gone.status).toBe(404);
  });

  it("leaves a recent unfinalized row alone", async () => {
    const pending = await (
      await createMedia({ filename: "in-flight.mp4", contentType: "video/mp4", bytes: 55 })
    ).json();

    s3.reset();
    await createMedia({ filename: "other.mp4", contentType: "video/mp4", bytes: 10 });

    expect(s3.deletes).toHaveLength(0);
    const still = await detailRoute(new Request("http://localhost/x"), params(pending.id));
    expect(still.status).toBe(200);
  });
});

describe("POST /api/publications/:id/finalize", () => {
  it("409s when the object never landed, leaving the row unfinalized", async () => {
    const created = await (
      await createMedia({ filename: "missing.mp4", contentType: "video/mp4", bytes: 12 })
    ).json();

    const res = await finalize(created.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("upload_missing");
    expect(s3.heads.map((h) => h.Key)).toEqual([created.key]);

    const detail = await (await detailRoute(new Request("http://localhost/x"), params(created.id))).json();
    expect(detail.publication.finalizedAt).toBeNull();
  });

  it("records the size the store reports and returns the file, manifest, and page urls", async () => {
    const created = await (
      await createMedia({
        filename: "spot.mp4",
        contentType: "video/mp4",
        bytes: 1000,
        manifest: { composition: "wordmark-reveal" },
      })
    ).json();
    // The store holds a different size than the publisher claimed; the HEAD wins.
    s3.objects.set(created.key, 1234);

    const res = await finalize(created.id);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({ id: created.id, kind: "media", bytes: 1234 });
    expect(body.urls.file).toBe(`https://dropzone.tylersavery.com/smitty/shares/${created.id}/spot.mp4`);
    expect(body.urls.manifest).toBe(
      `https://dropzone.tylersavery.com/smitty/shares/${created.id}/spot.manifest.json`,
    );
    expect(body.urls.page).toBe(`/publications/${created.id}`);
  });

  it("reports no manifest url when the publication has no manifest", async () => {
    const created = await (
      await createMedia({ filename: "bare.mp4", contentType: "video/mp4", bytes: 8 })
    ).json();
    s3.objects.set(created.key, 8);
    const body = await (await finalize(created.id)).json();
    expect(body.urls.manifest).toBeNull();
  });

  it("404s for an unknown id and 400s for a markdown publication", async () => {
    expect((await finalize("nope")).status).toBe(404);

    const markdownRow = getDb()
      .insert(publications)
      .values({
        id: "md-finalize",
        title: "Doc",
        sanitizedName: "doc",
        sourceMd: "# Doc",
        r2Folder: "smitty/shares/md-finalize",
        publicBase: "dropzone.tylersavery.com",
        origin: "api",
      })
      .returning()
      .all();
    expect(markdownRow).toHaveLength(1);

    const res = await finalize("md-finalize");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("not_media");
  });
});

describe("the registry and media publications", () => {
  it("hides an unfinalized upload from the listing and from search", async () => {
    const pending = await (
      await createMedia({
        filename: "pending-heron.mp4",
        contentType: "video/mp4",
        bytes: 16,
        group: "heronwatch",
      })
    ).json();

    const all = await (await listRoute(new Request("http://localhost/api/publications?limit=200"))).json();
    expect(all.publications.map((p: { id: string }) => p.id)).not.toContain(pending.id);

    const hits = await (
      await listRoute(new Request("http://localhost/api/publications?q=heronwatch"))
    ).json();
    expect(hits.publications.map((p: { id: string }) => p.id)).not.toContain(pending.id);

    // Finalizing publishes it into both.
    s3.objects.set(pending.key, 16);
    await finalize(pending.id);

    const after = await (
      await listRoute(new Request("http://localhost/api/publications?q=heronwatch"))
    ).json();
    expect(after.publications.map((p: { id: string }) => p.id)).toContain(pending.id);
  });

  it("finds a finalized render by group, label, and manifest terms", async () => {
    const created = await publishMedia({
      filename: "unwrapped.mp4",
      group: "vbtc-unwrapped",
      label: "v3",
      manifest: { composition: "cormorant-dive", profile: "prores", format: "mov" },
    });

    for (const term of ["vbtc", "v3", "cormorant", "prores"]) {
      const hits = await (
        await listRoute(new Request(`http://localhost/api/publications?q=${term}`))
      ).json();
      expect(hits.publications.map((p: { id: string }) => p.id)).toContain(created.id);
    }
  });

  it("summarizes a media row with its kind, group, label, size, and urls", async () => {
    const created = await publishMedia({
      filename: "still.png",
      contentType: "image/png",
      bytes: 2048,
      group: "stills",
      label: "hero",
    });

    const all = await (await listRoute(new Request("http://localhost/api/publications?limit=200"))).json();
    const summary = all.publications.find((p: { id: string }) => p.id === created.id);

    expect(summary).toMatchObject({
      kind: "media",
      contentType: "image/png",
      bytes: 2048,
      group: "stills",
      label: "hero",
    });
    expect(summary.urls.file).toBe(
      `https://dropzone.tylersavery.com/smitty/shares/${created.id}/still.png`,
    );
    expect(summary.urls.manifest).toBeNull();
    // Media summaries carry no markdown artifact links.
    expect(summary.urls.html).toBeUndefined();
  });

  it("returns the manifest verbatim on the detail row", async () => {
    const manifest = { composition: "wordmark-reveal", frames: 720, nested: { codec: "prores_hq" } };
    const created = await publishMedia({ filename: "detail.mp4", manifest });
    const detail = await (await detailRoute(new Request("http://localhost/x"), params(created.id))).json();

    expect(detail.publication.kind).toBe("media");
    expect(detail.publication.manifest).toEqual(manifest);
    expect(detail.publication.sourceMd).toBeUndefined();
  });
});

describe("POST /api/publications/:id/revoke — media", () => {
  it("deletes the file and the manifest, then stamps the row", async () => {
    const created = await publishMedia({
      filename: "revoke-me.mp4",
      manifest: { composition: "gone" },
    });

    const res = await revokeRoute(new Request("http://localhost/x", { method: "POST" }), params(created.id));
    expect(res.status).toBe(200);
    const { publication } = await res.json();
    expect(publication.revoked).toBe(true);

    expect(s3.deletes.map((d) => d.Key).sort()).toEqual(
      [
        `smitty/shares/${created.id}/revoke-me.mp4`,
        `smitty/shares/${created.id}/revoke-me.manifest.json`,
      ].sort(),
    );
  });
});

describe("degradation — no R2 credentials", () => {
  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
  });

  it("returns 400 publish_unavailable from both media endpoints and signs nothing", async () => {
    const create = await createMedia({ filename: "a.mp4", contentType: "video/mp4", bytes: 10 });
    expect(create.status).toBe(400);
    expect((await create.json()).error.code).toBe("publish_unavailable");

    const fin = await finalize("any");
    expect(fin.status).toBe(400);
    expect((await fin.json()).error.code).toBe("publish_unavailable");

    expect(presigner.calls).toHaveLength(0);
    expect(s3.puts).toHaveLength(0);
  });
});
