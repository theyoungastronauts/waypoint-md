"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDebouncedCallback } from "@/components/review/use-debounced-callback";
import type { PublicationSummary } from "@/lib/publications";
import { cn } from "@/lib/utils";
import { PublicationRow } from "./publication-row";

/**
 * The registry browser (§ publish spec): a search box driving the FTS-backed
 * `GET /api/publications?q=` and the newest-first result list. The server seeds
 * the initial (empty-query) list so the first paint has data; typing debounces
 * into a query key, and TanStack Query keeps the previous results visible while
 * the next search resolves. Empty and error states are handled inline.
 */
export function PublicationList({
  initialPublications,
}: {
  initialPublications: PublicationSummary[];
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const { call: debounceQuery } = useDebouncedCallback(setQuery, 250);

  const onChange = (value: string) => {
    setInput(value);
    debounceQuery(value.trim());
  };

  const { data, isFetching, isError } = useQuery({
    queryKey: ["publications", query],
    queryFn: ({ signal }) => fetchPublications(query, signal),
    // The empty-query list is server-rendered; seed it so the first paint (and a
    // return to the cleared search) shows rows without a fetch round-trip.
    initialData: query === "" ? initialPublications : undefined,
    placeholderData: keepPreviousData,
  });

  const publications = data ?? [];
  const searching = query.length > 0;

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
        <div className={cn("space-y-2 transition-opacity", isFetching && "opacity-70")}>
          {publications.map((pub) => (
            <PublicationRow key={pub.id} pub={pub} />
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchPublications(q: string, signal: AbortSignal): Promise<PublicationSummary[]> {
  const res = await fetch(`/api/publications?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.publications as PublicationSummary[];
}
