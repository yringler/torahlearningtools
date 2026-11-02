import { test, expect } from "@playwright/test";

test("works offline after the first visit", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first load is not controlled by the service worker yet; a reload is.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#app button").first()).toBeVisible();

  // The Hebrew font comes from the cache, not from the network.
  const loaded = await page.evaluate(
    async () => (await document.fonts.load("400 40px 'Noto Serif Hebrew'", "שָׁלוֹם")).length,
  );
  expect(loaded).toBeGreaterThan(0);
});
