import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";

// Route handlers under test.
import { GET as listDocumentsRoute, POST as postDocument } from "@/app/api/documents/route";
import { GET as getDocumentRoute, PATCH as patchDocument } from "@/app/api/documents/[id]/route";

// Direct service/data-access for the supersede case (needs project + source_path,
// which only the path/CLI doors carry).
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";
import { createProject } from "@/lib/projects";

const FIXTURES = path.resolve(process.cwd(), "packages/spec/fixtures");
const kitchenSink = readFileSync(path.join(FIXTURES, "kitchen-sink.md"), "utf8");

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

describe("POST /api/documents (ingest doors)", () => {
  it("ingests pasted markdown, storing raw_md byte-identically", async () => {
    const res = await postDocument(jsonRequest({ markdown: kitchenSink }));
    expect(res.status).toBe(201);
    const { id, url, warnings } = await res.json();
    expect(id).toBeTruthy();
    expect(url).toBe(`/d/${id}`);
    expect(Array.isArray(warnings)).toBe(true);

    const detail = getDocumentDetail(id);
    expect(detail).not.toBeNull();
    expect(detail!.rawMd).toBe(kitchenSink);
    expect(sha256(detail!.rawMd)).toBe(sha256(kitchenSink));
    expect(detail!.status).toBe("pending");
    expect(detail!.sourceType).toBe("paste");
    // kitchen-sink has three questions.
    expect(detail!.items.length).toBe(3);
    expect(detail!.title).toBe("RDS Migration Plan");
  });

  it("ingests an uploaded file via multipart/form-data", async () => {
    const file = new File([Buffer.from(kitchenSink, "utf8")], "kitchen-sink.md", {
      type: "text/markdown",
    });
    const form = new FormData();
    form.set("file", file);
    const res = await postDocument(
      new Request("http://localhost/api/documents", { method: "POST", body: form }),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const detail = getDocumentDetail(id);
    expect(detail!.rawMd).toBe(kitchenSink);
    expect(detail!.sourceType).toBe("upload");
  });

  it("rejects an upload with an unsupported extension", async () => {
    const file = new File([Buffer.from("nope")], "evil.exe", { type: "application/octet-stream" });
    const form = new FormData();
    form.set("file", file);
    const res = await postDocument(
      new Request("http://localhost/api/documents", { method: "POST", body: form }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unsupported_file_type");
  });

  it("rejects a body with no recognized source", async () => {
    const res = await postDocument(jsonRequest({ nonsense: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("no_source");
  });

  it("rejects a pasted document over the 1 MB cap", async () => {
    const huge = "a".repeat(1024 * 1024 + 1);
    const res = await postDocument(jsonRequest({ markdown: huge }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("document_too_large");
  });

  it("surfaces parse warnings without failing ingest", async () => {
    const malformed = readFileSync(path.join(FIXTURES, "malformed-pairs.md"), "utf8");
    const res = await postDocument(jsonRequest({ markdown: malformed }));
    expect(res.status).toBe(201);
    const { warnings } = await res.json();
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("GET /api/documents (queue listing + filters)", () => {
  it("filters by project and status", async () => {
    const project = createProject("filter-project");
    const res = await postDocument(jsonRequest({ markdown: "# Solo\n\nbody", projectId: project.id }));
    const { id } = await res.json();

    const byProject = await listDocumentsRoute(
      new Request(`http://localhost/api/documents?project=${project.id}`),
    );
    const listed = (await byProject.json()).documents as Array<{ id: string; projectName: string }>;
    expect(listed.some((d) => d.id === id)).toBe(true);
    expect(listed.every((d) => d.projectName === "filter-project")).toBe(true);

    const pending = await listDocumentsRoute(
      new Request(`http://localhost/api/documents?project=${project.id}&status=pending`),
    );
    expect(((await pending.json()).documents as unknown[]).length).toBe(1);

    const completed = await listDocumentsRoute(
      new Request(`http://localhost/api/documents?project=${project.id}&status=completed`),
    );
    expect(((await completed.json()).documents as unknown[]).length).toBe(0);
  });
});

describe("GET/PATCH /api/documents/:id", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await getDocumentRoute(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("transitions status and reassigns project", async () => {
    const create = await postDocument(jsonRequest({ markdown: "# Patch me\n\nbody" }));
    const { id } = await create.json();

    const statusRes = await patchDocument(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "in_review" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(statusRes.status).toBe(200);
    expect((await statusRes.json()).document.status).toBe("in_review");

    const projRes = await patchDocument(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: "reassigned" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    const patched = (await projRes.json()).document;
    expect(patched.projectId).toBeTruthy();
    expect(getDocumentDetail(id)!.projectName).toBe("reassigned");
  });

  it("rejects an unknown status value", async () => {
    const create = await postDocument(jsonRequest({ markdown: "# S\n\nb" }));
    const { id } = await create.json();
    const res = await patchDocument(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "bogus" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects setting status to archived directly (supersede-automation only)", async () => {
    const create = await postDocument(jsonRequest({ markdown: "# A\n\nb" }));
    const { id } = await create.json();
    const res = await patchDocument(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
    expect(getDocumentDetail(id)!.status).toBe("pending");
  });
});

describe("supersede semantics (§6)", () => {
  it("re-ingesting the same project + source_path archives the old doc and links supersedes_id", () => {
    const project = createProject("supersede-project");
    const first = ingestDocument({
      raw: "# V1\n\nfirst",
      sourceType: "cli",
      projectId: project.id,
      sourcePath: "docs/plan.md",
    });
    const second = ingestDocument({
      raw: "# V2\n\nsecond",
      sourceType: "cli",
      projectId: project.id,
      sourcePath: "docs/plan.md",
    });

    const oldDoc = getDocumentDetail(first.id)!;
    const newDoc = getDocumentDetail(second.id)!;

    expect(oldDoc.status).toBe("archived");
    expect(newDoc.supersedesId).toBe(first.id);
    // raw_md is never mutated by supersede.
    expect(oldDoc.rawMd).toBe("# V1\n\nfirst");
    expect(newDoc.rawMd).toBe("# V2\n\nsecond");
  });
});
