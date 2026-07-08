"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * App-wide TanStack Query v5 client (§9). Created once per browser session in
 * state so it survives re-renders but never leaks between requests during SSR.
 * Autosave mutations retry transient failures so a brief network blip doesn't
 * strand a saved answer.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
          mutations: { retry: 2 },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
