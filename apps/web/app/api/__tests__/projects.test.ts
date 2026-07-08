import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import { GET as listProjectsRoute, POST as createProjectRoute } from "@/app/api/projects/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/projects", {
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

describe("GET/POST /api/projects", () => {
  it("creates a project and lists it back", async () => {
    const created = await createProjectRoute(jsonRequest({ name: "acme-api" }));
    expect(created.status).toBe(201);
    const { project } = await created.json();
    expect(project.name).toBe("acme-api");
    expect(project.id).toBeTruthy();

    const listed = await listProjectsRoute();
    const { projects } = await listed.json();
    expect(projects.some((p: { id: string }) => p.id === project.id)).toBe(true);
  });

  it("rejects an empty project name", async () => {
    const res = await createProjectRoute(jsonRequest({ name: "  " }));
    expect(res.status).toBe(400);
  });
});
