import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-test-token";
const sdk = await loadSdk();

let sent;
let sentInit;
function answer(data) {
  globalThis.fetch = async (_url, init) => {
    sentInit = init;
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

test("searchProducts results are cached for five minutes by default, and callers can override", async () => {
  const empty = { search: { totalCount: 0, pageInfo, productFilters: [], edges: [] } };
  answer(empty);
  await sdk.searchProducts({ query: "shirt" });
  assert.equal(sentInit.cache, "force-cache");
  assert.equal(sentInit.next.revalidate, 300);
  await sdk.searchProducts({ query: "shirt", revalidate: 60 });
  assert.equal(sentInit.next.revalidate, 60);
  await sdk.searchProducts({ query: "shirt", cache: "no-store" });
  assert.equal(sentInit.cache, "no-store");
  assert.equal(sentInit.next?.revalidate, undefined, "no-store and a revalidate time together make Next warn");
});

const colorField = {
  namespace: "custom", key: "color", type: "list.metaobject_reference", value: "[]", reference: null,
  references: { nodes: [{ __typename: "Metaobject", handle: "grey", fields: [{ key: "label", value: "Grey" }] }] },
};
const withExtras = { ...product, collections: { nodes: [{ handle: "sofas", title: "Sofas" }] }, metafields: [colorField, null] };
const extras = { metafields: [{ namespace: "custom", key: "color" }, { namespace: "custom", key: "gone" }], withCollections: true };

test("list reads send metafields and withCollections, and map reference entries like getProduct", async () => {
  answer({ products: { pageInfo, edges: [{ cursor: "c", node: withExtras }] } });
  const page = await sdk.getProductsPage({ limit: 2, ...extras });
  assert.deepEqual(sent.variables.metafields, extras.metafields);
  assert.equal(sent.variables.withCollections, true);
  assert.deepEqual(page.products[0].metafields, [{ namespace: "custom", key: "color", type: "list.metaobject_reference", value: "[]", entries: [{ handle: "grey", fields: { label: "Grey" } }] }, null]);
  assert.equal(page.products[0].collections.nodes[0].handle, "sofas");
});

test("collection and search pages carry the same extras", async () => {
  answer({ collection: { products: { pageInfo, filters: [], edges: [{ cursor: "c", node: withExtras }] } } });
  const collection = await sdk.getCollectionProductsPage({ handle: "men", ...extras });
  assert.deepEqual(sent.variables.metafields, extras.metafields);
  assert.equal(sent.variables.withCollections, true);
  assert.deepEqual(collection.products[0].metafields[0].entries, [{ handle: "grey", fields: { label: "Grey" } }]);

  answer({ search: { totalCount: 1, pageInfo, productFilters: [], edges: [{ cursor: "c", node: { __typename: "Product", ...withExtras } }, { cursor: "d", node: { __typename: "Page" } }] } });
  const search = await sdk.searchProducts({ query: "sofa", ...extras });
  assert.equal(sent.variables.withCollections, true);
  assert.equal(search.products.length, 1);
  assert.deepEqual(search.products[0].metafields[0].entries, [{ handle: "grey", fields: { label: "Grey" } }]);
  assert.equal(search.products[0].metafields[0].reference, undefined);
});

test("without the new options the list reads send empty metafields and no collections", async () => {
  answer({ products: { pageInfo, edges: [] } });
  await sdk.getProductsPage();
  assert.deepEqual(sent.variables.metafields, []);
  assert.equal(sent.variables.withCollections, false);

  answer({ collection: { products: { pageInfo, filters: [], edges: [] } } });
  await sdk.getCollectionProductsPage({ handle: "men" });
  assert.deepEqual(sent.variables.metafields, []);
  assert.equal(sent.variables.withCollections, false);

  answer({ search: { totalCount: 0, pageInfo, productFilters: [], edges: [] } });
  await sdk.searchProducts({ query: "x" });
  assert.deepEqual(sent.variables.metafields, []);
  assert.equal(sent.variables.withCollections, false);
});

test("the three list documents spread the extras; recommendations and predictive search do not", () => {
  for (const name of ["getProductsQuery", "getCollectionProductsQuery", "searchProductsQuery"]) {
    const q = sdk[name];
    assert.match(q, /\.\.\.ProductListExtras/, name);
    assert.match(q, /fragment ProductListExtras on Product/, name);
    assert.match(q, /\$metafields: \[HasMetafieldsIdentifier!\]! = \[\]/, name);
    assert.match(q, /\$withCollections: Boolean! = false/, name);
    assert.match(q, /collections\(first: 10\) @include\(if: \$withCollections\)/, name);
  }
  for (const name of ["getProductRecommendationsQuery", "predictiveSearchQuery"]) assert.doesNotMatch(sdk[name], /ProductListExtras|\$withCollections/, name);
  assert.match(sdk.getProductByHandleQuery, /metafields\(identifiers: \$metafields\)\s*\{\s*namespace/);
});

test("paged reads throw when Shopify fails", async () => {
  globalThis.fetch = async () => new Response("down", { status: 500 });
  await assert.rejects(sdk.getProductsPage(), sdk.ShopifyError);
  await assert.rejects(sdk.searchProducts({ query: "x" }), sdk.ShopifyError);
  await assert.rejects(sdk.getProductsPage({ metafields: [{ namespace: "custom", key: "color" }], withCollections: true }), sdk.ShopifyError);
  await assert.rejects(sdk.getCollectionProductsPage({ handle: "men", withCollections: true }), sdk.ShopifyError);
});
