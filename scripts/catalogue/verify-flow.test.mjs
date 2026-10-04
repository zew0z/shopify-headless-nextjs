import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchStorefront } from "./verify.mjs";

const product = (handle) => ({ handle, images: { nodes: [{ url: "u" }] }, variants: { nodes: [{ id: "v1" }, { id: "v2" }] } });

/** Products come in two pages; collections in one. Records headers and cursors. */
function fakeStorefront() {
  const seen = [];
  const handler = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    seen.push({ token: init.headers["X-Shopify-Storefront-Access-Token"], after: variables.after });
    const headers = { "x-shopify-api-version": "2026-07" };
    const page = (key, nodes, next) => new Response(JSON.stringify({ data: { [key]: { pageInfo: { hasNextPage: Boolean(next), endCursor: next }, nodes } } }), { status: 200, headers });
    if (/products\(first/.test(query)) return variables.after ? page("products", [product("c")], null) : page("products", [product("a"), product("b")], "cursor-1");
    return page("collections", [{ handle: "sofas" }], null);
  };
  return { handler, seen };
}

beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "verify-test";
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-token";
});
afterEach(() => {
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  mock.restoreAll();
});

test("follows pagination, uses only the public token, and reports the served version", async () => {
  const shop = fakeStorefront();
  mock.method(globalThis, "fetch", shop.handler);
  const result = await fetchStorefront();
  assert.deepEqual(result.products.map((p) => p.handle), ["a", "b", "c"]);
  assert.equal(result.products[0].variantCount, 2);
  assert.deepEqual(result.collections, [{ handle: "sofas" }]);
  assert.equal(result.served, "2026-07");
  assert.deepEqual(shop.seen.map((s) => s.after), [null, "cursor-1", null]);
  assert.ok(shop.seen.every((s) => s.token === "public-token"));
});

test("a missing token is a readable error before any request", async () => {
  delete process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const shop = fakeStorefront();
  mock.method(globalThis, "fetch", shop.handler);
  await assert.rejects(fetchStorefront(), /public Storefront token/);
  assert.equal(shop.seen.length, 0);
});

test("a GraphQL error from the Storefront API is thrown, not swallowed", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ errors: [{ message: "Access denied" }] }), { status: 200 }));
  await assert.rejects(fetchStorefront(), /Access denied/);
});
