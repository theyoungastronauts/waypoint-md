"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useDebouncedCallback } from "@/components/review/use-debounced-callback";
import { Button } from "@/components/ui/button";
import type { PublicationSummary } from "@/lib/publications";
import { cn } from "@/lib/utils";
import { PublicationRow } from "./publication-row";

/** How many rows the registry loads per page (server seed + each scroll load). */
export const PUBLICATIONS_PAGE_SIZE = 25;

interface PublicationPage {
  publications: PublicationSummary[];
  nextOffset: number | null;
}

/**
 * The registry browser (§ publish spec): a search box driving the FTS-backed
 * `GET /api/publications?q=` and a newest-first, infinitely-scrolling list. The
 * server seeds the first page so the first paint has data; scrolling a sentinel
 * into view loads the next page (with an explicit "Load more" button as an
 * accessible fallback). Changing the search resets to page one under a new
 * query key. TanStack Query keeps prior results visible while the next resolves.
 */
export function PublicationList({
  initialPublications,
  initialNextOffset,
}: {
  initialPublications: PublicationSummary[];
  initialNextOffset: number | null;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const { call: debounceQuery } = useDebouncedCallback(setQuery, 250);

  const onChange = (value: string) => {
    setInput(value);
    debounceQuery(value.trim());
  };

  const { data, isFetching, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["publications", query],
      queryFn: ({ pageParam, signal }) => fetchPublications(query, pageParam, signal),
      initialPageParam: 0,
      getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
      // The empty-query first page is server-rendered; seed it so the first
      // paint (and a return to the cleared search) shows rows with no fetch.
      initialData:
        query === ""
          ? { pages: [{ publications: initialPublications, nextOffset: initialNextOffset }], pageParams: [0] }
          : undefined,
    });

  const publications = data?.pages.flatMap((p) => p.publications) ?? [];
  const searching = query.length > 0;

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, publications.length]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={input}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search publications…"
        aria-label="Search publications"
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />

      {isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Couldn’t load publications. Please try again.
        </p>
      ) : publications.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <h2 className="text-lg font-medium">{searching ? "No matches" : "No publications yet"}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {searching
              ? "No publication matches that search."
              : "Publish a markdown file with the Waypoint CLI and it will appear here."}
          </p>
        </div>
      ) : (
        <div className={cn("space-y-2 transition-opacity", isFetching && !isFetchingNextPage && "opacity-70")}>
          {publications.map((pub) => (
            <PublicationRow key={pub.id} pub={pub} />
          ))}

          {hasNextPage && (
            <div ref={sentinelRef} className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function fetchPublications(q: string, offset: number, signal: AbortSignal): Promise<PublicationPage> {
  const params = new URLSearchParams({ q, offset: String(offset), limit: String(PUBLICATIONS_PAGE_SIZE) });
  const res = await fetch(`/api/publications?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { publications: data.publications as PublicationSummary[], nextOffset: data.nextOffset ?? null };
}
