import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/api/http";
import { createProject, listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** GET /api/projects — list all projects (§8). */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ projects: listProjects() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const createSchema = z.object({ name: z.string().trim().min(1) });

/** POST /api/projects — create a project (§8). */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid_json", "Request body was not valid JSON.");
    });
    const { name } = createSchema.parse(body);
    return NextResponse.json({ project: createProject(name) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
