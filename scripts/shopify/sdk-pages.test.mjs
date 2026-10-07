import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-test-token";
const sdk = await loadSdk();

let sent;
function answer(data) {
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
}
const pageInfo = { hasNextPage: true, hasPreviousPage: false, startCursor: "s", endCursor: "e" };
const product = { id: "gid://shopify/Product/1", handle: "a" };
const filter = { id: "filter.v.option.color", label: "Color", type: "LIST", values: [{ id: "x", label: "Green", count: 3, input: '{"variantOption":{"name":"color","value":"Green"}}' }] };

test("getProductsPage returns the products and the cursor for the next page", async () => {
  answer({ products: { pageInfo, edges: [{ cursor: "c", node: product }] } });
  const page = await sdk.getProductsPage({ limit: 12, cursor: "prev" });
  assert.deepEqual(page.products, [product]);
  assert.equal(page.pageInfo.endCursor, "e");
  assert.deepEqual(page.filters, []);
  assert.equal(sent.variables.after, "prev");
});

test("getCollectionProductsPage sends the filters and returns Shopify's filter list", async () => {
  answer({ collection: { products: { pageInfo, filters: [filter], edges: [{ cursor: "c", node: product }] } } });
  const page = await sdk.getCollectionProductsPage({ handle: "men", filters: [{ available: true }, { variantOption: { name: "color", value: "Green" } }] });
  assert.deepEqual(sent.variables.filters, [{ available: true }, { variantOption: { name: "color", value: "Green" } }]);
  assert.equal(page.filters[0].label, "Color");
  assert.equal(page.pageInfo.hasNextPage, true);
});

test("getCollectionProductsPage is null for a collection that does not exist", async () => {
  answer({ collection: null });
  assert.equal(await sdk.getCollectionProductsPage({ handle: "nope" }), null);
});

test("getCollectionProducts still returns a plain array", async () => {
  answer({ collection: { products: { pageInfo, filters: [], edges: [{ cursor: "c", node: product }] } } });
  assert.deepEqual(await sdk.getCollectionProducts({ handle: "men" }), [product]);
});

test("searchProducts returns products only, with the total and the filters", async () => {
  answer({ search: { totalCount: 29, pageInfo, productFilters: [filter], edges: [{ cursor: "c", node: { __typename: "Product", ...product } }] } });
  const page = await sdk.searchProducts({ query: "shirt", limit: 2 });
  assert.equal(page.totalCount, 29);
  assert.equal(page.products[0].handle, "a");
  assert.equal(page.filters.length, 1);
  assert.equal(sent.variables.query, "shirt");
});

test("paged reads throw when Shopify fails", async () => {
  globalThis.fetch = async () => new Response("down", { status: 500 });
  await assert.rejects(sdk.getProductsPage(), sdk.ShopifyError);
  await assert.rejects(sdk.searchProducts({ query: "x" }), sdk.ShopifyError);
});
