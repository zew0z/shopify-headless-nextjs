import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Each process imports the real SDK once with synthetic settings; no .env files or network.
const loader = new URL("../test-support/load-sdk.mjs", import.meta.url).href;
function run({ slot, status = 200 }) {
  const source = `
    import assert from "node:assert/strict";
    import { loadSdk } from ${JSON.stringify(loader)};
    const slot = ${JSON.stringify(slot)};
    const status = ${status};
    const { shopifyConfig, isShopifyConfigured, validateShopifyConfig } = await loadSdk("config");
    const { shopifyFetch, ShopifyError } = await loadSdk("client");
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, "https://fixture.myshopify.com/api/2026-07/graphql.json");
      assert.equal(init.headers["X-Shopify-Access-Token"], undefined);
      assert.equal(init.headers[slot === "private" ? "Shopify-Storefront-Private-Token" : "X-Shopify-Storefront-Access-Token"], "shpat_opaque_" + slot + "_fixture");
      assert.equal(init.headers[slot === "private" ? "X-Shopify-Storefront-Access-Token" : "Shopify-Storefront-Private-Token"], undefined);
      assert.equal(init.headers["Shopify-Storefront-Buyer-IP"], slot === "private" ? "192.0.2.1" : undefined);
      return status === 200 ? Response.json({ data: { shop: { name: "Fixture" } } }) : new Response("Fixture authorization failed", { status });
    };
    const request = { query: "query Fixture { shop { name } }", cache: "force-cache", retries: 2, ...(slot === "private" && { buyerIp: "192.0.2.1" }) };
    if (slot === "admin-only") {
      assert.equal(shopifyConfig.publicAccessToken, "");
      assert.equal(shopifyConfig.privateAccessToken, "");
      assert.equal(isShopifyConfigured, false);
      assert.equal(validateShopifyConfig().isValid, false);
      await assert.rejects(shopifyFetch(request), (error) => error instanceof ShopifyError && /not configured/.test(error.message));
      assert.equal(calls, 0);
    } else {
      assert.equal(isShopifyConfigured, true);
      assert.equal(validateShopifyConfig().isValid, true);
      if (status === 200) assert.equal((await shopifyFetch(request)).body.data.shop.name, "Fixture");
      else await assert.rejects(shopifyFetch(request), (error) => error instanceof ShopifyError && error.status === status);
      assert.equal(calls, 1);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 15000,
    env: {
      ...process.env, NODE_ENV: "test",
      NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com", SHOPIFY_STORE_DOMAIN: "",
      NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: slot === "private" ? "public-alternative-fixture" : slot === "public" ? "shpat_opaque_public_fixture" : "",
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: "", SHOPIFY_STOREFRONT_TOKEN: "",
      SHOPIFY_STOREFRONT_PRIVATE_TOKEN: slot === "private" ? "shpat_opaque_private_fixture" : "",
      SHOPIFY_STOREFRONT_API_VERSION: "2026-07", SHOPIFY_ADMIN_TOKEN: "shpat_unrelated_admin_fixture", SHOPIFY_WEBHOOK_SECRET: "fixture-webhook",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
}

for (const slot of ["private", "public"]) {
  test(`Next accepts an opaque ${slot} Storefront token and uses its configured header`, () => run({ slot }));
  test(`Next preserves an HTTP authorization failure for an opaque ${slot} token`, () => run({ slot, status: slot === "private" ? 403 : 401 }));
}
test("Next never substitutes Admin-only credentials for a missing Storefront token", () => run({ slot: "admin-only" }));
