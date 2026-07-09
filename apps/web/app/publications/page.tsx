import type { Metadata } from "next";

import { PublicationList, PUBLICATIONS_PAGE_SIZE } from "@/components/publications/publication-list";
import { PublishDisabled } from "@/components/publications/publish-disabled";
import { listPublications, toPublicationSummary } from "@/lib/publications";
import { publishEnabled } from "@/lib/publish/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Publications" };

/**
 * The Publications registry (§ publish spec, ratified as its own section). The
 * server reads the newest-first list through the lib layer and hands it to the
 * client browser, which owns the search-as-you-type. When publishing isn't
 * configured the section degrades to a clear notice — mirrors the AI contract.
 */
export default function PublicationsPage() {
  const enabled = publishEnabled();
  // Seed the first page (same size the client paginates by) so the first paint
  // has rows without a fetch; the client loads further pages on scroll.
  const firstPage = enabled
    ? listPublications({ limit: PUBLICATIONS_PAGE_SIZE }).map(toPublicationSummary)
    : [];
  const firstNextOffset = firstPage.length === PUBLICATIONS_PAGE_SIZE ? firstPage.length : null;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Publications</h1>
        <p className="text-sm text-muted-foreground">
          Permanent published artifacts — searchable, each linking to its HTML, PDF, and Markdown on
          R2.
        </p>
      </div>

      {enabled ? (
        <PublicationList initialPublications={firstPage} initialNextOffset={firstNextOffset} />
      ) : (
        <PublishDisabled />
      )}
    </section>
  );
}
