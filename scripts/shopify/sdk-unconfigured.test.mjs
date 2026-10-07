import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

/**
 * The SDK with no Shopify settings at all. Nothing is made up: every product
 * comes from Shopify, so without settings every read fails and says why,
 * in development as well as production.
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

catalogueReads.predictiveSearch = () => sdk.predictiveSearch("anything");

for (const env of ["production", "development"]) {
  for (const [name, read] of Object.entries(catalogueReads)) {
    test(`${name}: with no Shopify settings in ${env}, it refuses instead of making up products`, () =>
      withNodeEnv(env, () =>
        assert.rejects(read(), (err) => err instanceof sdk.ShopifyError && /not configured/.test(err.message))
      ));
  }
}
