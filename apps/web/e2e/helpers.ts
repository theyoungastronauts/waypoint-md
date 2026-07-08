import { expect, type Page } from "@playwright/test";

/**
 * A small SPEC-v1 document with prose to comment on, one text question, and one
 * single-select choice question. Shared by the desktop and mobile smokes.
 */
export const SMOKE_DOC = `---
waypoint: 1
title: "E2E Smoke Plan"
---

# Smoke plan

This plan hinges on the barcode scanner beat, a decision we made in phase two.

<!-- wp:question id="q1" type="text" -->
**Q1 — Sizing:** Which instance class do we keep after the incident?
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Auth model:**
- [ ] Single shared token
- [ ] Tailscale-only, no app auth
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
`;

/** The reviewer's answer to q1, asserted verbatim in the exported file. */
export const Q1_ANSWER = "db.r6g.large through end of quarter";

/**
 * Import {@link SMOKE_DOC} via the paste door and land on its review page.
 * Returns the document id parsed from the URL.
 */
export async function importSmokeDoc(page: Page): Promise<string> {
  await page.goto("/new");
  await page.getByRole("tab", { name: "Paste" }).click();
  await page.getByPlaceholder("Paste raw markdown here").fill(SMOKE_DOC);
  await page.getByRole("button", { name: "Import document" }).click();
  await page.waitForURL(/\/d\/[^/]+$/);
  await expect(page.locator("[data-item-card]").first()).toBeVisible();
  const m = page.url().match(/\/d\/([^/]+)$/);
  if (!m) throw new Error(`unexpected review URL: ${page.url()}`);
  return m[1];
}

/**
 * Programmatically select a phrase inside the rendered prose and notify the
 * selection watcher, so the floating "Comment" affordance appears. A drag-select
 * is too pixel-fragile for a smoke; this exercises the same store path.
 */
export async function selectProsePhrase(page: Page, phrase: string): Promise<void> {
  const ok = await page.evaluate((needle) => {
    const prose = document.querySelector("[data-wp-prose]");
    if (!prose) return false;
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue ?? "";
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        // Keep the selection (and thus the floating button) inside the viewport.
        (node.parentElement as HTMLElement | null)?.scrollIntoView({ block: "center" });
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        return true;
      }
    }
    return false;
  }, phrase);
  expect(ok, `phrase not found in prose: ${phrase}`).toBe(true);
}
