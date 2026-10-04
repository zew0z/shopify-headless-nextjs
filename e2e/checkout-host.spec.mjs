import { test, expect } from "@playwright/test";
import { checkoutHost, isOnHost, loadE2E } from "./env.mjs";

const { config, env, siteUrl } = loadE2E();

/** First purchasable variant, read straight from the Storefront API with the public token. */
async function firstVariantId() {
  const res = await fetch(`https://${env.domain}/api/${env.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": env.storefrontToken },
    body: JSON.stringify({ query: "{ products(first: 20) { nodes { variants(first: 5) { nodes { id availableForSale } } } } }" }),
  });
  const json = await res.json();
  for (const product of json.data?.products?.nodes ?? []) {
    for (const variant of product.variants.nodes) if (variant.availableForSale) return variant.id;
  }
  return null;
}

test("a cart created through the site hands customers to the checkout subdomain", async ({ request }) => {
  test.skip(!config || !siteUrl || !env.domain || !env.storefrontToken, "needs store-setup.config.json, E2E_SITE_URL and a storefront token");
  const variantId = await firstVariantId();
  test.skip(!variantId, "the storefront has no purchasable variant yet");

  const res = await request.post(`${siteUrl}/api/cart`, {
    data: { action: "create", lines: [{ merchandiseId: variantId, quantity: 1 }] },
  });
  expect(res.ok(), `POST /api/cart returned ${res.status()}`).toBeTruthy();
  const cart = await res.json();
  expect(isOnHost(cart.checkoutUrl, checkoutHost(config)), `checkoutUrl was ${cart.checkoutUrl}`).toBe(true);
});
