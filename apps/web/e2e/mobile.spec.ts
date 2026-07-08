import { expect, test } from "@playwright/test";
import { importSmokeDoc } from "./helpers";

/**
 * Mobile viewport smoke (§9, §17): the right rail collapses into a bottom sheet,
 * and tapping an item there focuses its card. Runs under the `mobile` project
 * (Pixel 5 viewport) from the config.
 */
test("bottom sheet opens and an item tap focuses its card", async ({ page }) => {
  await importSmokeDoc(page);

  const cards = page.locator("[data-item-card]");
  await expect(cards).toHaveCount(2);

  // The fixed bottom bar stands in for the desktop rail on narrow viewports.
  const openBar = page.getByRole("button", { name: /Tap for items/ });
  await expect(openBar).toBeVisible();
  await openBar.tap();

  // The sheet is a labelled dialog holding the full rail.
  const sheet = page.getByRole("dialog", { name: "Review navigation" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveClass(/translate-y-0/);

  // Tapping an item in the sheet focuses its card and closes the sheet.
  await sheet.locator('nav[aria-label="Items"] button').first().tap();
  await expect(cards.nth(0)).toHaveClass(/border-ring/);
  await expect(sheet).toHaveClass(/translate-y-full/);
});
