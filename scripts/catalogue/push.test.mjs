import test from "node:test";
import assert from "node:assert/strict";
import { describePlan } from "./push.mjs";

const catalog = {
  collections: [{ handle: "sofas", title: "Sofas" }],
  products: [
    { handle: "a", title: "A", collections: ["sofas"], images: ["https://x/1.jpg"], variants: [{ sku: "1", price: "1" }] },
    { handle: "b", title: "B", variants: [{ sku: "2", price: "1" }, { sku: "3", price: "1" }] },
  ],
};

test("the plan lists collections and every product with variant and image counts", () => {
  const lines = describePlan(catalog, {});
  assert.equal(lines.length, 3);
  assert.match(lines[0], /collection sofas/);
  assert.match(lines[1], /product\s+a\s+1v\s+1 img\s+\[sofas\]/);
  assert.match(lines[2], /product\s+b\s+2v\s+0 img/);
});

test("limit trims products but not collections", () => {
  const lines = describePlan(catalog, { limit: 1 });
  assert.equal(lines.length, 2);
});
