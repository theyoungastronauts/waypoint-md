"use client";

import { useState } from "react";

import { resolveNextPath } from "@/lib/next-path";

interface ApiErrorBody {
  error?: { message?: string };
}

/**
 * Minimal login page (§15): paste the shared token, exchange it for an httpOnly
 * session cookie via POST /api/auth/login, then continue to the originally
 * requested path. Reads the `next` param from the URL at submit time (rather than
 * `useSearchParams`) so the page needs no Suspense boundary and prerenders clean.
 */
export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setError("Enter your access token.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        setError(data.error?.message ?? `Login failed (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = resolveNextPath(next, window.location.origin);
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-sm space-y-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          This Waypoint server requires an access token.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Access token</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            placeholder="WAYPOINT_TOKEN"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
