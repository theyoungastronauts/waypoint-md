// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PublicationsPage from "@/app/publications/page";

/**
 * Degradation (spec: mirrors the AI contract). With no R2 credentials,
 * `publishEnabled()` is false and the Publications page must render the
 * "not configured" notice instead of the search UI — never crash. The nav-link
 * gate is the same `publishEnabled()` boolean, exercised in the API/config tests.
 */
const CREDS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of CREDS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  cleanup();
  for (const k of CREDS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Publications page degradation", () => {
  it("shows the not-configured notice and no search box when publishing is disabled", () => {
    render(<PublicationsPage />);

    expect(screen.getByText(/publishing isn.t configured/i)).toBeTruthy();
    // The feature itself is absent: no search input, no list.
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
