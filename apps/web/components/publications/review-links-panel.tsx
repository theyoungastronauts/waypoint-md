"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import type { ReviewLinkView } from "@/lib/review/links";

/**
 * Minting and killing review links from the authoring side (decision C-4).
 *
 * One link per reviewer, because the name on the link is the name on every
 * comment that arrives through it — so the panel asks for a name first and hands
 * back a URL second. Revoking is one click and needs no confirmation: it costs
 * nothing but the URL (the render and every note it carried survive), which is
 * exactly what makes it safe to use the moment a link looks leaked.
 */

export interface ReviewLinkRowView extends ReviewLinkView {
  url: string;
}

export function ReviewLinksPanel({
  publicationId,
  initialLinks,
  publicBase,
}: {
  publicationId: string;
  initialLinks: ReviewLinkRowView[];
  publicBase: string | null;
}) {
  const [links, setLinks] = useState(initialLinks);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const create = async () => {
    if (name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/publications/${publicationId}/review-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { link } = (await res.json()) as { link: ReviewLinkRowView };
      setLinks((current) => [...current, link]);
      setName("");
    } catch {
      setError("Couldn’t create that review link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (linkId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/publications/${publicationId}/review-links/${linkId}/revoke`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { link } = (await res.json()) as { link: ReviewLinkRowView };
      setLinks((current) => current.map((l) => (l.id === link.id ? link : l)));
    } catch {
      setError("Couldn’t revoke that review link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (link: ReviewLinkRowView) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
    } catch {
      setError("Couldn’t copy — select the URL and copy it by hand.");
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card px-5 py-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Review links</h2>
        <p className="text-xs text-muted-foreground">
          One link per reviewer. The name on the link is the name on every note left through it.
          {publicBase === null &&
            " WAYPOINT_REVIEW_PUBLIC_URL is not set, so these URLs are relative — see docs/ops/review-tunnel.md."}
        </p>
      </div>

      <div className="flex gap-2">
        <input
          aria-label="Reviewer name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Reviewer name"
          className="min-h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring"
        />
        <Button size="sm" onClick={create} disabled={busy || name.trim().length === 0}>
          Create link
        </Button>
      </div>

      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground">No review links yet.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              data-testid="review-link"
              data-revoked={link.revoked ? "true" : "false"}
              className="space-y-1 rounded-md border border-border px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{link.reviewerName}</span>
                <span className="text-muted-foreground">
                  created {relativeTime(link.createdAt)}
                  {link.lastSeenAt ? ` · last opened ${relativeTime(link.lastSeenAt)}` : " · never opened"}
                </span>
                {link.revoked && <span className="text-destructive">revoked</span>}
                <span className="ml-auto flex gap-2">
                  {!link.revoked && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => copy(link)}>
                        {copiedId === link.id ? "Copied" : "Copy"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revoke(link.id)}
                        disabled={busy}
                      >
                        Revoke
                      </Button>
                    </>
                  )}
                </span>
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">{link.url}</p>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
