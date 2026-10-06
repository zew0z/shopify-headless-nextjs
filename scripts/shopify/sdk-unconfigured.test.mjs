import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

/**
 * The SDK with no Shopify settings at all. Mock products are a development
 * convenience; a production build must never show them to a customer.
 */
for (const name of [
  "NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_STORE_DOMAIN",
  "NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN",
  "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
  "SHOPIFY_STOREFRONT_PRIVATE_TOKEN",
]) {
  delete process.env[name];
}
const sdk = await loadSdk();

function withNodeEnv(value, fn) {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  return fn().finally(() => {
    process.env.NODE_ENV = before;
  });
}

const catalogueReads = {
  getProducts: () => sdk.getProducts({ limit: 4 }),
  getProduct: () => sdk.getProduct("mock-handle"),
  getProductRecommendations: () => sdk.getProductRecommendations("gid://shopify/Product/1"),
  getCollections: () => sdk.getCollections(),
  getCollection: () => sdk.getCollection("mock-collection"),
  getCollectionProducts: () => sdk.getCollectionProducts({ handle: "mock-collection" }),
};

for (const [name, read] of Object.entries(catalogueReads)) {
  test(`${name}: a production build with no Shopify settings refuses to serve mock products`, () =>
    withNodeEnv("production", () =>
      assert.rejects(read(), (err) => err instanceof sdk.ShopifyError && /not configured/.test(err.message))
    ));
}

test("development with no Shopify settings still shows the mock catalogue", () =>
  withNodeEnv("development", async () => {
    const products = await sdk.getProducts({ limit: 2 });
    assert.equal(products.length, 2);
  }));
