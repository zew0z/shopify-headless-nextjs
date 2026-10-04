import test from "node:test";
import assert from "node:assert/strict";
import { summarise, compareToCatalogue } from "./verify.mjs";

const catalog = {
  collections: [{ handle: "sofas", title: "Sofas" }],
  products: [
    { handle: "a", title: "A", images: ["https://x/1.jpg"], variants: [{ sku: "1", price: "1" }] },
    { handle: "b", title: "B", images: ["https://x/2.jpg"], variants: [{ sku: "2", price: "1" }, { sku: "3", price: "1" }] },
    { handle: "draft", title: "D", status: "DRAFT", variants: [{ sku: "4", price: "1" }] },
  ],
};
const seenProducts = [
  { handle: "a", images: ["u"], variantCount: 1 },
  { handle: "b", images: ["u"], variantCount: 2 },
];

test("summarise counts what the storefront returned", () => {
  const s = summarise([...seenProducts, { handle: "c", images: [], variantCount: 1 }], [{ handle: "sofas" }]);
  assert.deepEqual(s, { products: 3, variants: 4, withImage: 2, collections: 1 });
});

test("everything arrived: no problems (drafts are not expected on the storefront)", () => {
  const seen = { handles: ["a", "b"], summary: summarise(seenProducts, [{ handle: "sofas" }]) };
  assert.deepEqual(compareToCatalogue(seen, catalog), []);
});

test("a missing product is named", () => {
  const seen = { handles: ["a"], summary: summarise([seenProducts[0]], [{ handle: "sofas" }]) };
  const text = compareToCatalogue(seen, catalog).join("\n");
  assert.match(text, /missing from the storefront: b/);
  assert.match(text, /never published to the Headless channel/);
});

test("collection and image shortfalls are reported with numbers", () => {
  const noImages = seenProducts.map((p) => ({ ...p, images: [] }));
  const seen = { handles: ["a", "b"], summary: summarise(noImages, []) };
  const text = compareToCatalogue(seen, catalog).join("\n");
  assert.match(text, /collections: expected 1, storefront has 0/);
  assert.match(text, /images: 2 products should have one, storefront shows 0/);
});

test("variant counts are compared up to the 100 the storefront query returns", () => {
  const big = { collections: [], products: [{ handle: "big", title: "B", variants: Array.from({ length: 150 }, (_, i) => ({ sku: `s${i}`, price: "1" })) }] };
  const seen = { handles: ["big"], summary: summarise([{ handle: "big", images: [], variantCount: 100 }], []) };
  assert.deepEqual(compareToCatalogue(seen, big), []);
});
