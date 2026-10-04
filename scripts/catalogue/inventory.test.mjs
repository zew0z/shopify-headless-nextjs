import test from "node:test";
import assert from "node:assert/strict";
import { inventoryMismatches } from "./inventory.mjs";

test("everything matches the config: no problems", () => {
  assert.deepEqual(inventoryMismatches([{ sku: "A", tracked: true }], true), []);
  assert.deepEqual(inventoryMismatches([{ sku: "A", tracked: false }], false), []);
});

test("skus that disagree with the config are named and counted", () => {
  const [p] = inventoryMismatches([{ sku: "A", tracked: false }, { sku: "B", tracked: true }, { sku: "C", tracked: false }], true);
  assert.match(p, /2 of 3 variants/);
  assert.match(p, /A, C/);
});

import { mock, beforeEach, afterEach } from "node:test";
import { fetchVariantTracking } from "./inventory.mjs";

beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "inv-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_invtest";
});
afterEach(() => {
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  mock.restoreAll();
});

test("fetchVariantTracking follows pagination and flattens the tracked flag", async () => {
  const afters = [];
  mock.method(globalThis, "fetch", async (_url, init) => {
    const { variables } = JSON.parse(init.body);
    afters.push(variables.after);
    const nodes = variables.after
      ? [{ sku: "C", inventoryItem: { tracked: true } }]
      : [{ sku: "A", inventoryItem: { tracked: false } }, { sku: "B", inventoryItem: { tracked: true } }];
    const pageInfo = { hasNextPage: !variables.after, endCursor: "c1" };
    return new Response(JSON.stringify({ data: { productVariants: { pageInfo, nodes } } }), { status: 200 });
  });
  assert.deepEqual(await fetchVariantTracking(), [
    { sku: "A", tracked: false },
    { sku: "B", tracked: true },
    { sku: "C", tracked: true },
  ]);
  assert.deepEqual(afters, [null, "c1"]);
});
