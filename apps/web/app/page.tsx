import Link from "next/link";

import { DocumentRow } from "@/components/queue/document-row";
import { FilterBar } from "@/components/queue/filter-bar";
import { listDocuments, type DocumentSummary } from "@/lib/documents";
import { listProjects } from "@/lib/projects";
import { statusMeta } from "@/lib/format";

export const dynamic = "force-dynamic";

interface QueuePageProps {
  searchParams: Promise<{ status?: string; project?: string }>;
}

/** Sections shown when no explicit status filter is active. */
const SECTION_ORDER = ["pending", "in_review", "completed", "pulled"] as const;

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const { status, project } = await searchParams;
  const projects = listProjects();
  const documents = listDocuments({
    status: status || undefined,
    projectId: project || undefined,
  });

  const grouped = new Map<string, DocumentSummary[]>();
  for (const doc of documents) {
    const list = grouped.get(doc.status) ?? [];
    list.push(doc);
    grouped.set(doc.status, list);
  }
  const sections = status
    ? [status]
    : SECTION_ORDER.filter((s) => (grouped.get(s)?.length ?? 0) > 0);

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">
            {documents.length} document{documents.length === 1 ? "" : "s"} to review.
          </p>
        </div>
        <Link
          href="/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          New document
        </Link>
      </div>

      <FilterBar projects={projects} activeStatus={status} activeProject={project} />

      {documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <h2 className="text-lg font-medium">Nothing here yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Import a document to start reviewing — upload a file, paste markdown, point at a
            server path, or fetch a URL.
          </p>
          <Link
            href="/new"
            className="mt-4 inline-block rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Import a document
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map((section) => {
            const docs = grouped.get(section) ?? [];
            if (docs.length === 0) return null;
            return (
              <div key={section} className="space-y-3">
                {!status && (
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {statusMeta(section).label}
                    <span className="ml-2 text-muted-foreground/60">{docs.length}</span>
                  </h2>
                )}
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
