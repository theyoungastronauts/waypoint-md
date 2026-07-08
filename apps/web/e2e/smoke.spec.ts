import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { importSmokeDoc, Q1_ANSWER, selectProsePhrase } from "./helpers";

/**
 * Desktop happy path (§17 item 5): import → answer → export, plus the browser-only
 * bits accumulated from reviews — keyboard `j`/`k` + `⌘⏎`, and a selection comment
 * placed with the mouse. Runs against the real `next dev` server from the config.
 */
test("import → comment → keyboard nav → answer → export", async ({ page }) => {
  await importSmokeDoc(page);

  const cards = page.locator("[data-item-card]");
  await expect(cards).toHaveCount(2);

  // Let the client hydrate so the prose selection watcher and the document-level
  // keydown listener are attached.
  await page.waitForTimeout(700);

  // --- Selection comment via the mouse-selection path (prose is at the top) ---
  await selectProsePhrase(page, "barcode scanner beat");
  await page.getByRole("button", { name: "Comment" }).click();
  await page.getByPlaceholder("Add a comment…").fill("Confirm this is still the barcode decision.");
  const commentSaved = page.waitForResponse(
    (r) => /\/api\/documents\/[^/]+\/comments$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save" }).click();
  await commentSaved;
  // The anchored comment renders as a clickable highlight over the prose.
  await expect(page.locator("mark[data-wp-comment]").first()).toBeVisible();

  // --- Keyboard nav over the focused-item model (focus starts unset) ---------
  await page.keyboard.press("j");
  await expect(cards.nth(0)).toHaveClass(/border-ring/);
  await page.keyboard.press("j");
  await expect(cards.nth(1)).toHaveClass(/border-ring/);
  await page.keyboard.press("k");
  await expect(cards.nth(0)).toHaveClass(/border-ring/);

  // ⌘⏎ marks the focused item answered — move to q2 and mark it.
  await page.keyboard.press("j");
  await expect(cards.nth(1)).toHaveClass(/border-ring/);
  await page.keyboard.press("Meta+Enter");
  await expect(cards.nth(1).getByText("Answered")).toBeVisible();

  // --- Answer the text question, and wait for the autosave PUT ---------------
  const answer = page.getByPlaceholder(/Type your answer/);
  await answer.click();
  await answer.fill(Q1_ANSWER);
  const saved = page.waitForResponse(
    (r) => /\/api\/items\/[^/]+\/response$/.test(r.url()) && r.request().method() === "PUT",
  );
  await answer.blur(); // flush the debounce immediately
  await saved;

  // --- Export the annotated markdown and verify it carries the review --------
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Download annotated/ }).click(),
  ]);
  const filePath = await download.path();
  const annotated = readFileSync(filePath, "utf8");

  expect(annotated).toContain(Q1_ANSWER); // q1 answer spliced into wp:answer
  expect(annotated).toContain('status="answered"'); // q2 marked answered via ⌘⏎
  expect(annotated).toContain("wp:comment"); // selection comment spliced in
});
