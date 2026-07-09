"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import type { PublicationDetail } from "@/lib/publications";
import { ArtifactLinks } from "./artifact-links";
import { originLabel } from "./labels";

/**
 * Publication detail (§ publish spec): metadata, the three artifact links, the
 * rendered source markdown, and a Revoke control. Revoke deletes the R2 objects,
 * so it takes a two-click inline confirm (no window.confirm — that breaks the
 * harness and reads worse). On success the view reflects the revoked state in
 * place, no reload: the links go dead and a revoked note replaces the button.
 * `bodyHtml` is pre-rendered server-side through the shared rehype-sanitize
 * pipeline, so it is safe for `dangerouslySetInnerHTML`.
 */
export function PublicationDetailView({
  detail,
  bodyHtml,
}: {
  detail: PublicationDetail;
  bodyHtml: string;
}) {
  const [revoked, setRevoked] = useState(detail.revoked);
  const [revokedAt, setRevokedAt] = useState(detail.revokedAt);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/publications/${detail.id}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRevoked(true);
      setRevokedAt(data.publication?.revokedAt ?? new Date().toISOString());
      setConfirming(false);
      // Drop the cached list so navigating back refetches — otherwise a
      // just-revoked row keeps rendering as live (staleTime) until it expires,
      // which is exactly the feedback revoke exists to give.
      queryClient.invalidateQueries({ queryKey: ["publications"] });
    } catch {
      setError("Couldn’t revoke this publication. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/publications" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to publications
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {detail.title || "Untitled publication"}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{originLabel(detail.origin)}</Badge>
          {detail.sourceHost && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">{detail.sourceHost}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>published {relativeTime(detail.createdAt)}</span>
          {revoked && (
            <>
              <span aria-hidden>·</span>
              <Badge className="bg-destructive/15 text-destructive">revoked</Badge>
            </>
          )}
        </div>
      </div>

      <ArtifactLinks urls={detail.urls} revoked={revoked} />

      <div className="space-y-2">
        {revoked ? (
          <p className="text-sm text-muted-foreground">
            Revoked {revokedAt ? relativeTime(revokedAt) : ""} — the HTML, PDF, and Markdown files
            were deleted from R2. This registry entry stays for the record.
          </p>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
            <span className="text-sm">
              Revoke this publication? This deletes the HTML, PDF, and Markdown from R2 and can’t be
              undone.
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={revoke} disabled={busy}>
                {busy ? "Revoking…" : "Revoke"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Revoke
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Source</h2>
        <div
          className="wp-prose max-w-none rounded-lg border border-border bg-card px-5 py-4"
          // Pre-sanitized server-side by the shared rehype-sanitize pipeline.
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>
    </div>
  );
}
