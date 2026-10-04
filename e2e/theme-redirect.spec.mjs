import { test, expect } from "@playwright/test";
import { loadE2E } from "./env.mjs";

const { config, env } = loadE2E();

test("the default Shopify theme URL ends up on the frontend", async ({ page }) => {
  test.skip(!config || !env.domain, "needs store-setup.config.json and SHOPIFY_STORE_DOMAIN");
  await page.goto(`https://${env.domain}/`, { waitUntil: "commit" });
  await page.waitForURL((url) => url.hostname === config.siteDomain, { timeout: 20_000 });
  expect(new URL(page.url()).hostname).toBe(config.siteDomain);
});

test("the redirect leaves customer account pages on Shopify", async ({ page }) => {
  test.skip(!config || !env.domain, "needs store-setup.config.json and SHOPIFY_STORE_DOMAIN");
  await page.goto(`https://${env.domain}/account/login`, { waitUntil: "commit" });
  // A late JS redirect would land after the load; give it a fair chance before concluding it did not happen.
  await page.waitForTimeout(5000);
  expect(new URL(page.url()).hostname).not.toBe(config.siteDomain);
});
