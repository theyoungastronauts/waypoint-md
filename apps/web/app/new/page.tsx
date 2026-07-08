import type { Metadata } from "next";

import { NewDocumentForm } from "@/components/new/new-document-form";
import { pathDoorEnabled } from "@/lib/ingest/path-door";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New document" };

export default function NewDocumentPage() {
  const projects = listProjects();
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Import a document</h1>
        <p className="text-sm text-muted-foreground">
          Upload a file, paste markdown, point at a server path, or fetch a URL.
        </p>
      </div>
      <NewDocumentForm
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        pathDoorEnabled={pathDoorEnabled()}
      />
    </section>
  );
}
