import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalog } from "./format.mjs";

const variant = (over = {}) => ({ sku: "A-1", price: "10.00", ...over });
const product = (over = {}) => ({ handle: "chair", title: "Chair", variants: [variant()], ...over });
const catalog = (products = [product()], collections = []) => ({ collections, products });
const problems = (c, o) => validateCatalog(c, o).join("\n");

test("a minimal catalogue is pushable", () => {
  assert.deepEqual(validateCatalog(catalog()), []);
});

test("handles must be url-safe and unique", () => {
  assert.match(problems(catalog([product({ handle: "Bad Handle" })])), /handle not url-safe/);
  assert.match(problems(catalog([product(), product({ variants: [variant({ sku: "B" })] })])), /duplicate product handle/);
});

test("skus are required and unique across the catalogue", () => {
  assert.match(problems(catalog([product({ variants: [{ price: "1" }] })])), /without a sku/);
  assert.match(problems(catalog([product(), product({ handle: "sofa" })])), /duplicate sku/);
});

test("price must be positive and compare-at must exceed it", () => {
  assert.match(problems(catalog([product({ variants: [variant({ price: "0" })] })])), /price must be a positive number/);
  assert.match(problems(catalog([product({ variants: [variant({ compareAtPrice: "10.00" })] })])), /compareAtPrice must exceed price/);
  assert.deepEqual(validateCatalog(catalog([product({ variants: [variant({ compareAtPrice: "12.00" })] })])), []);
});

test("compare-at prices fail when the owner said they are not real", () => {
  const catalog = {
    collections: [],
    products: [{ handle: "chair", title: "Chair", variants: [{ sku: "C-1", price: "100.00", compareAtPrice: "150.00" }] }],
  };
  assert.deepEqual(validateCatalog(catalog, { compareAtIsReal: false }), [
    "chair/C-1: compareAtPrice is set, but the owner said was-prices are not real (compareAtIsReal is false); stop setting it in the source",
  ]);
  assert.deepEqual(validateCatalog(catalog, { compareAtIsReal: true }), []);
  assert.deepEqual(validateCatalog(catalog), [], "callers that do not pass the answer keep the old rule");
});

test("without was-prices, compareAtIsReal false passes, and each variant with one is named", () => {
  const variants = [variant({ sku: "A-1" }), variant({ sku: "A-2", compareAtPrice: "15.00" }), variant({ sku: "A-3", compareAtPrice: null })];
  assert.deepEqual(validateCatalog(catalog([product({ variants: [variant()] })]), { compareAtIsReal: false }), []);
  assert.deepEqual(
    validateCatalog(catalog([product({ variants })]), { compareAtIsReal: false }).filter((p) => /compareAtPrice/.test(p)).map((p) => p.split(":")[0]),
    ["chair/A-2"]
  );
});

test("images must be https url strings, at most 20", () => {
  assert.match(problems(catalog([product({ images: ["http://x/a.jpg"] })])), /not https/);
  assert.match(problems(catalog([product({ images: [{ huge: "https://x" }] })])), /expected a url string/);
  assert.match(problems(catalog([product({ images: Array.from({ length: 21 }, (_, i) => `https://x/${i}.jpg`) })])), /first 20/);
});

test("options: variants must use declared options and values, with no duplicate combinations", () => {
  const withOptions = (variants) => product({ options: [{ name: "Colour", values: ["Grey", "Beige"] }], variants });
  assert.match(problems(catalog([withOptions([variant({ options: { Colour: "Red" } })])])), /not in the declared values/);
  assert.match(problems(catalog([withOptions([variant({ options: { Size: "L" } })])])), /not declared/);
  assert.match(problems(catalog([withOptions([variant()])])), /sets 0 option/);
  const dup = withOptions([variant({ options: { Colour: "Grey" } }), variant({ sku: "A-2", options: { Colour: "Grey" } })]);
  assert.match(problems(catalog([dup])), /share the option combination/);
});

test("more than three options or 2048 variants is rejected", () => {
  const four = ["a", "b", "c", "d"].map((name) => ({ name, values: ["x"] }));
  assert.match(problems(catalog([product({ options: four, variants: [variant({ options: { a: "x", b: "x", c: "x", d: "x" } })] })])), /options; Shopify allows 3/);
  const many = Array.from({ length: 2049 }, (_, i) => variant({ sku: `S${i}` }));
  assert.match(problems(catalog([product({ variants: many })])), /2049 variants/);
});

test("collections must exist, with unique url-safe handles", () => {
  assert.match(problems(catalog([product({ collections: ["nope"] })])), /unknown collection/);
  assert.match(problems(catalog([], [{ handle: "a", title: "A" }, { handle: "a", title: "A2" }])), /duplicate collection handle/);
  assert.deepEqual(validateCatalog(catalog([product({ collections: ["a"] })], [{ handle: "a", title: "A" }])), []);
});

test("list metafields must be JSON-encoded arrays", () => {
  const bad = { namespace: "custom", key: "colors", type: "list.single_line_text_field", value: "red" };
  assert.match(problems(catalog([product({ metafields: [bad] })])), /JSON-encoded array/);
});

test("descriptions must not link out to the vendor's shop", () => {
  const html = '<p>Buy at <a href="https://vendor.example/p/1">vendor</a></p>';
  assert.match(problems(catalog([product({ descriptionHtml: html })])), /links out/);
  assert.deepEqual(validateCatalog(catalog([product({ descriptionHtml: "<p>Nice chair</p>" })])), []);
});

test("a shop that tracks stock needs an integer quantity on every variant", () => {
  assert.match(problems(catalog(), { tracksInventory: true }), /integer quantity/);
  const ok = catalog([product({ variants: [variant({ quantity: 3 })] })]);
  assert.deepEqual(validateCatalog(ok, { tracksInventory: true }), []);
});

test("a shop that does not track stock rejects variants claiming tracked: true", () => {
  const c = catalog([product({ variants: [variant({ tracked: true })] })]);
  assert.match(problems(c, { tracksInventory: false }), /does not track inventory/);
});

test("a reference metafield names its entries in refs, and they must exist", () => {
  const catalog = {
    collections: [],
    metaobjects: [{ type: "color_swatch", handle: "grey", fields: { label: "Grey" } }],
    products: [
      { handle: "a", title: "A", variants: [{ sku: "1", price: "1" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }] },
      { handle: "b", title: "B", variants: [{ sku: "2", price: "1" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/blue"] }] },
      { handle: "c", title: "C", variants: [{ sku: "3", price: "1" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", value: "[\"gid://x\"]" }] },
      { handle: "d", title: "D", variants: [{ sku: "4", price: "1" }], metafields: [{ namespace: "custom", key: "main", type: "metaobject_reference", refs: ["color_swatch/grey", "color_swatch/grey"] }] },
    ],
  };
  assert.deepEqual(validateCatalog(catalog), [
    "b: metafield color refers to color_swatch/blue, which is not in the catalogue's metaobjects",
    "c: metafield color is a reference, so it needs refs: [\"<type>/<handle>\"] instead of a value",
    "d: metafield main holds one reference, refs has 2",
  ]);
});

test("refs on a metafield that is not a reference type is a problem", () => {
  const c = catalog([product({ metafields: [{ namespace: "custom", key: "seats", type: "number_integer", value: "3", refs: ["color_swatch/grey"] }] })]);
  assert.match(problems(c), /chair: metafield seats has refs but is not a reference type/);
});
