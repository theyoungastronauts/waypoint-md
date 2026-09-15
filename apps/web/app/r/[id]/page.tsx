import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MediaReview } from "@/components/review-public/media-review";
import { listMediaComments } from "@/lib/review/comments";
import { resolveReviewAccess, touchLastSeen } from "@/lib/review/links";
import { toPublicComments, toPublicReviewPayload } from "@/lib/review/public-view";

export const dynamic = "force-dynamic";

/**
 * Fixed metadata, never the render's title: this is the one page in Waypoint
 * served to the open internet, and the title is resolved before the `?k=` is
 * checked. `noindex` matters for the same reason — a review link is a capability
 * handed to one person, not a page that should end up in a search index.
 */
export const metadata: Metadata = {
  title: "Review",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * GET /r/:id?k= — the public review page (decision C-3). A server component, so
 * the link is validated before any markup is produced and the page and its API
 * routes can never disagree about who the reviewer is.
 *
 * Everything that fails is `notFound()`: a wrong id, a wrong token, a revoked
 * link, a link for another group, an unfinalized or revoked publication. The
 * page is the outside world's only view of Waypoint, and it admits nothing.
 */
export default async function PublicReviewPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const raw = query.k;
  const token = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);

  const access = resolveReviewAccess(token, id);
  if (!access || token === null) notFound();

  touchLastSeen(access.link.id);

  return (
    <MediaReview
      payload={toPublicReviewPayload(access.publication, access.link)}
      initialComments={toPublicComments(listMediaComments(access.publication.id))}
      token={token}
    />
  );
}
