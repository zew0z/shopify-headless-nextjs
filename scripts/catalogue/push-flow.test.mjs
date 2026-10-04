import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pushCatalogue } from "./push.mjs";

/**
 * A fake Shopify Admin API. It proves the push's ORDER OF OPERATIONS (what it
 * calls, in what sequence, with which keys). It cannot prove Shopify's real
 * field names: only a development store can.
 */
function fakeShopify({ existingCollections = new Set(), failProductSet = false, locations } = {}) {
  const calls = [];
  const reply = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { "x-shopify-api-version": "2026-07" } });
  const handler = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (/publications\(first/.test(query)) return reply({ publications: { nodes: [{ id: "gid://pub/1", name: "Online Store" }, { id: "gid://pub/2", name: "Headless" }] } });
    if (/locations\(first/.test(query)) return reply({ locations: { nodes: locations ?? [{ id: "gid://loc/1", name: "Shop", isActive: true }] } });
    if (/collectionByHandle/.test(query)) return reply({ collectionByHandle: existingCollections.has(variables.handle) ? { id: `gid://col/${variables.handle}` } : null });
    if (/collectionCreate/.test(query)) return reply({ collectionCreate: { collection: { id: `gid://col/${variables.input.handle}` }, userErrors: [] } });
    if (/collectionUpdate/.test(query)) return reply({ collectionUpdate: { collection: { id: variables.input.id }, userErrors: [] } });
    if (/productSet/.test(query)) {
      if (failProductSet) return reply({ productSet: { product: null, userErrors: [{ field: ["input"], message: "bad input", code: "INVALID" }] } });
      return reply({ productSet: { product: { id: `gid://prod/${variables.identifier.handle}`, handle: variables.identifier.handle, variants: { nodes: [] } }, userErrors: [] } });
    }
    if (/publishablePublish/.test(query)) return reply({ publishablePublish: { userErrors: [] } });
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  };
  return { handler, calls };
}

const catalog = {
  collections: [{ handle: "sofas", title: "Sofas" }],
  products: [
    { handle: "milano", title: "Milano", collections: ["sofas"], variants: [{ sku: "M-1", price: "899.00", quantity: 2 }] },
    { handle: "roma", title: "Roma", variants: [{ sku: "R-1", price: "499.00", quantity: 5 }] },
  ],
};
const untracked = { tracksInventory: false };
const tracked = { tracksInventory: true };
const count = (calls, pattern) => calls.filter((c) => pattern.test(c.query)).length;

beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "flow-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_flowtest";
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
});
afterEach(() => {
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  mock.restoreAll();
});

test("a dry run makes no network calls at all", async () => {
  const shop = fakeShopify();
  mock.method(globalThis, "fetch", shop.handler);
  await pushCatalogue({ config: untracked, catalog, dryRun: true });
  assert.equal(shop.calls.length, 0);
});

test("a fresh push creates the collection, upserts each product by handle, and publishes everything to every channel", async () => {
  const shop = fakeShopify();
  mock.method(globalThis, "fetch", shop.handler);
  await pushCatalogue({ config: untracked, catalog });

  assert.equal(count(shop.calls, /collectionCreate/), 1);
  assert.equal(count(shop.calls, /collectionUpdate/), 0);
  const sets = shop.calls.filter((c) => /productSet/.test(c.query));
  assert.deepEqual(sets.map((c) => c.variables.identifier), [{ handle: "milano" }, { handle: "roma" }]);
  assert.deepEqual(sets[0].variables.input.collections, ["gid://col/sofas"]);

  const publishes = shop.calls.filter((c) => /publishablePublish/.test(c.query));
  assert.deepEqual(publishes.map((c) => c.variables.id), ["gid://col/sofas", "gid://prod/milano", "gid://prod/roma"]);
  for (const p of publishes) assert.deepEqual(p.variables.input, [{ publicationId: "gid://pub/1" }, { publicationId: "gid://pub/2" }]);
});

test("each product is published immediately after it is written, never before", async () => {
  const shop = fakeShopify();
  mock.method(globalThis, "fetch", shop.handler);
  await pushCatalogue({ config: untracked, catalog });
  const order = shop.calls.map((c) => (/productSet/.test(c.query) ? `set:${c.variables.identifier.handle}` : /publishablePublish/.test(c.query) ? `pub:${c.variables.id.split("/").pop()}` : null)).filter(Boolean);
  assert.deepEqual(order, ["pub:sofas", "set:milano", "pub:milano", "set:roma", "pub:roma"]);
});

test("a re-run updates the existing collection instead of creating a second one", async () => {
  const shop = fakeShopify({ existingCollections: new Set(["sofas"]) });
  mock.method(globalThis, "fetch", shop.handler);
  await pushCatalogue({ config: untracked, catalog });
  assert.equal(count(shop.calls, /collectionCreate/), 0);
  assert.equal(count(shop.calls, /collectionUpdate/), 1);
  assert.equal(count(shop.calls, /productSet/), 2);
});

test("only=collections never touches products", async () => {
  const shop = fakeShopify();
  mock.method(globalThis, "fetch", shop.handler);
  await pushCatalogue({ config: untracked, catalog, only: "collections" });
  assert.equal(count(shop.calls, /productSet/), 0);
  assert.equal(count(shop.calls, /collectionCreate/), 1);
});

test("limit pushes only the first products", async () => {
  const shop = fakeShopify();
  mock.method(globalThis, "fetch", shop.handler);
  await pushCatalogue({ config: untracked, catalog, limit: 1 });
  assert.equal(count(shop.calls, /productSet/), 1);
});

test("a userError from Shopify aborts the push and the failed product is never published", async () => {
  const shop = fakeShopify({ failProductSet: true });
  mock.method(globalThis, "fetch", shop.handler);
  await assert.rejects(pushCatalogue({ config: untracked, catalog }), /userErrors/);
  const publishedProducts = shop.calls.filter((c) => /publishablePublish/.test(c.query) && /prod/.test(c.variables.id));
  assert.equal(publishedProducts.length, 0);
});

test("a shop that tracks stock sets the quantity at its single active location", async () => {
  const shop = fakeShopify();
  mock.method(globalThis, "fetch", shop.handler);
  await pushCatalogue({ config: tracked, catalog });
  const first = shop.calls.find((c) => /productSet/.test(c.query));
  assert.deepEqual(first.variables.input.variants[0].inventoryQuantities, [{ locationId: "gid://loc/1", name: "available", quantity: 2 }]);
  assert.equal(first.variables.input.variants[0].inventoryPolicy, "DENY");
});

test("several active locations stop the push and ask which one", async () => {
  const shop = fakeShopify({ locations: [{ id: "gid://loc/1", name: "A", isActive: true }, { id: "gid://loc/2", name: "B", isActive: true }] });
  mock.method(globalThis, "fetch", shop.handler);
  mock.method(process, "exit", (code) => {
    throw new Error(`exit ${code}`);
  });
  await assert.rejects(pushCatalogue({ config: tracked, catalog }), /exit 1/);
  assert.equal(count(shop.calls, /productSet/), 0);
  await pushCatalogue({ config: tracked, catalog, locationId: "gid://loc/2" });
  assert.equal(shop.calls.find((c) => /productSet/.test(c.query)).variables.input.variants[0].inventoryQuantities[0].locationId, "gid://loc/2");
});

test("an invalid catalogue exits before any network call", async () => {
  const shop = fakeShopify();
  mock.method(globalThis, "fetch", shop.handler);
  mock.method(process, "exit", (code) => {
    throw new Error(`exit ${code}`);
  });
  const broken = { collections: [], products: [{ handle: "Bad Handle", title: "x", variants: [] }] };
  await assert.rejects(pushCatalogue({ config: untracked, catalog: broken }), /exit 1/);
  assert.equal(shop.calls.length, 0);
});
