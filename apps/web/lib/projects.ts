import { asc, eq } from "drizzle-orm";
import { HttpError } from "./api/http";
import { getDb } from "./db/client";
import { projects } from "./db/schema";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

/** All projects, oldest first. */
export function listProjects(): Project[] {
  return getDb().select().from(projects).orderBy(asc(projects.createdAt)).all();
}

/** Create a project. Names are not required to be unique (kept simple for v1). */
export function createProject(name: string): Project {
  const [row] = getDb().insert(projects).values({ name }).returning().all();
  return row;
}

/** Look up a project by id; null if it does not exist. */
export function getProject(id: string): Project | null {
  return getDb().select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

/**
 * Resolve a project reference from ingest input: an explicit `projectId` wins;
 * otherwise a `project` name is matched case-sensitively and created if absent
 * (the CLI and paste door both pass names). Returns null when neither is given.
 */
export function resolveProjectId(input: {
  projectId?: string | null;
  project?: string | null;
}): string | null {
  if (input.projectId) {
    const existing = getProject(input.projectId);
    if (!existing) {
      throw new HttpError(400, "project_not_found", `No project with id ${input.projectId}.`);
    }
    return existing.id;
  }
  const name = input.project?.trim();
  if (!name) return null;
  const match = getDb().select().from(projects).where(eq(projects.name, name)).get();
  if (match) return match.id;
  return createProject(name).id;
}
