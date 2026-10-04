import { test, expect } from "@playwright/test";
import { loadE2E } from "./env.mjs";

const { siteUrl } = loadE2E();
const paths = (process.env.E2E_PATHS ?? "/").split(",").map((p) => p.trim());

for (const path of paths) {
  test(`${path} loads without errors and without horizontal scroll`, async ({ page }) => {
    test.skip(!siteUrl, "needs E2E_SITE_URL");
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    const res = await page.goto(`${siteUrl}${path}`, { waitUntil: "networkidle" });
    expect(res.status()).toBeLessThan(400);
    expect(errors).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
  });
}
