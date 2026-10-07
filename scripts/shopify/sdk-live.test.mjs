import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

/**
 * The SDK as a deployed shop runs it: Shopify settings present, fetch stubbed.
 * Settings are read when the module loads, so they are set before the import.
 */
process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-test-token";
const sdk = await loadSdk();

const calls = [];
function stubFetch(respond) {
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(JSON.parse(init.body));
  };
}
const json = (data) => new Response(JSON.stringify({ data }), { status: 200 });
const shopifyDown = () => new Response("upstream error", { status: 500 });

const catalogueReads = {
  getProducts: () => sdk.getProducts({ limit: 4 }),
  getProduct: () => sdk.getProduct("real-handle"),
  getProductRecommendations: () => sdk.getProductRecommendations("gid://shopify/Product/1"),
  getCollections: () => sdk.getCollections(),
  getCollection: () => sdk.getCollection("real-collection"),
  getCollectionProducts: () => sdk.getCollectionProducts({ handle: "real-collection" }),
};

for (const [name, read] of Object.entries(catalogueReads)) {
  test(`${name}: a failed Shopify request throws instead of showing mock products`, async () => {
    stubFetch(shopifyDown);
    await assert.rejects(read(), sdk.ShopifyError);
  });
}

test("predictiveSearch: a failed Shopify request throws instead of showing no results", async () => {
  stubFetch(shopifyDown);
  await assert.rejects(sdk.predictiveSearch("shirt"), sdk.ShopifyError);
});

test("predictiveSearch: an empty query makes no request", async () => {
  stubFetch(() => json({}));
  const result = await sdk.predictiveSearch("  ");
  assert.equal(calls.length, 0);
  assert.deepEqual(result.products, []);
});

const emptyCatalogue = {
  products: { edges: [] },
  product: null,
  productRecommendations: [],
  collections: { edges: [] },
  collection: null,
};

for (const [name, read] of Object.entries(catalogueReads)) {
  test(`${name}: cached in the data cache with tags, without the visitor's IP in the key`, async () => {
    stubFetch(() => json(emptyCatalogue));
    await read();
    assert.equal(calls.length, 1);
    const { init } = calls[0];
    assert.equal(init.cache, "force-cache");
    assert.ok(init.next?.tags?.length, "no cache tags, so webhooks cannot purge it");
    assert.equal(init.headers["Shopify-Storefront-Buyer-IP"], undefined);
  });
}

test("product and collection reads carry the tags the revalidate route purges", async () => {
  stubFetch(() => json(emptyCatalogue));
  await sdk.getProduct("real-handle");
  assert.deepEqual(calls[0].init.next.tags.sort(), ["product-real-handle", "products"]);
  await sdk.getCollection("real-collection");
  assert.deepEqual(calls[1].init.next.tags.sort(), ["collection-real-collection", "collections"]);
});

test("a cached read can still be made dynamic by the caller", async () => {
  stubFetch(() => json(emptyCatalogue));
  await sdk.getProducts({ limit: 4, cache: "no-store" });
  assert.equal(calls[0].init.cache, "no-store");
});

test("the cart is never cached", async () => {
  stubFetch(() => json({ cart: null }));
  await sdk.getCart("gid://shopify/Cart/1");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.next, undefined);
});

const networkFailure = () => {
  throw new TypeError("fetch failed");
};

test("a cart change whose request failed is not sent again, so an item is never added twice", async () => {
  stubFetch(networkFailure);
  await assert.rejects(sdk.addToCart("gid://shopify/Cart/1", [{ merchandiseId: "gid://shopify/ProductVariant/1", quantity: 1 }]));
  assert.equal(calls.length, 1);
});

test("a catalogue read whose request failed is tried again", async () => {
  let first = true;
  stubFetch(() => {
    if (first) {
      first = false;
      networkFailure();
    }
    return json(emptyCatalogue);
  });
  await sdk.getProducts({ limit: 4 });
  assert.equal(calls.length, 2);
});

test("prices are shown in the currency Shopify returns, never a hardcoded symbol", () => {
  assert.equal(sdk.formatMoney({ amount: "24.5", currencyCode: "EUR" }, "en"), "€24.50");
  assert.equal(sdk.formatMoney({ amount: "24.5", currencyCode: "EUR" }, "el-GR"), "24,50\u00a0€");
  assert.equal(sdk.formatMoney({ amount: "1200", currencyCode: "USD" }, "en"), "$1,200.00");
});
