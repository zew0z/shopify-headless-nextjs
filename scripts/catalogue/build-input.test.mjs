import test from "node:test";
import assert from "node:assert/strict";
import { buildProductInput, resolveMetafields } from "./build-input.mjs";

const base = { collectionIds: {}, locationId: "gid://shopify/Location/1", tracksInventory: false, skipImages: false };
const product = {
  handle: "sofa",
  title: "Sofa",
  options: [{ name: "Colour", values: ["Grey", "Beige"] }],
  collections: ["sofas", "ghost"],
  images: ["https://x/1.jpg"],
  variants: [
    { sku: "S-G", price: "899.00", compareAtPrice: "1099.00", options: { Colour: "Grey" }, quantity: 4 },
    { sku: "S-B", price: 899, options: { Colour: "Beige" }, quantity: 0 },
  ],
};

test("handle, title and status default through", () => {
  const input = buildProductInput(product, base);
  assert.equal(input.handle, "sofa");
  assert.equal(input.status, "ACTIVE");
});

test("options become productOptions and variants carry optionValues", () => {
  const input = buildProductInput(product, base);
  assert.deepEqual(input.productOptions, [{ name: "Colour", values: [{ name: "Grey" }, { name: "Beige" }] }]);
  assert.deepEqual(input.variants[0].optionValues, [{ optionName: "Colour", name: "Grey" }]);
});

test("a product with no options sends neither productOptions nor optionValues", () => {
  const input = buildProductInput({ handle: "a", title: "A", variants: [{ sku: "A", price: "1.00" }] }, base);
  assert.equal(input.productOptions, undefined);
  assert.equal(input.variants[0].optionValues, undefined);
});

test("prices are strings and compare-at is null when absent", () => {
  const [grey, beige] = buildProductInput(product, base).variants;
  assert.equal(grey.compareAtPrice, "1099.00");
  assert.equal(beige.price, "899");
  assert.equal(beige.compareAtPrice, null);
});

test("untracked stock never sells out", () => {
  const [v] = buildProductInput(product, base).variants;
  assert.deepEqual(v.inventoryItem, { tracked: false });
  assert.equal(v.inventoryPolicy, "CONTINUE");
  assert.equal(v.inventoryQuantities, undefined);
});

test("tracked stock denies overselling and sets the quantity at the location", () => {
  const [v] = buildProductInput(product, { ...base, tracksInventory: true }).variants;
  assert.deepEqual(v.inventoryItem, { tracked: true });
  assert.equal(v.inventoryPolicy, "DENY");
  assert.deepEqual(v.inventoryQuantities, [{ locationId: "gid://shopify/Location/1", name: "available", quantity: 4 }]);
});

test("tracking stock without a location is an error, not a silent skip", () => {
  assert.throws(() => buildProductInput(product, { ...base, tracksInventory: true, locationId: undefined }), /locationId/);
});

test("only known collections are attached", () => {
  const input = buildProductInput(product, { ...base, collectionIds: { sofas: "gid://shopify/Collection/9" } });
  assert.deepEqual(input.collections, ["gid://shopify/Collection/9"]);
});

test("images become files, and can be skipped", () => {
  assert.deepEqual(buildProductInput(product, base).files, [{ originalSource: "https://x/1.jpg", contentType: "IMAGE" }]);
  assert.equal(buildProductInput(product, { ...base, skipImages: true }).files, undefined);
});

test("metafields pass through untouched", () => {
  const mf = [{ namespace: "custom", key: "material", type: "single_line_text_field", value: "Oak" }];
  assert.deepEqual(buildProductInput({ ...product, metafields: mf }, base).metafields, mf);
});

test("refs become entry ids: a JSON list for list types, one id otherwise", () => {
  const refIds = { "color_swatch/grey": "gid://e/1", "color_swatch/oak": "gid://e/2" };
  assert.deepEqual(
    resolveMetafields(
      [
        { namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey", "color_swatch/oak"] },
        { namespace: "custom", key: "main", type: "metaobject_reference", refs: ["color_swatch/grey"] },
        { namespace: "custom", key: "seats", type: "number_integer", value: "3" },
      ],
      refIds
    ),
    [
      { namespace: "custom", key: "color", type: "list.metaobject_reference", value: '["gid://e/1","gid://e/2"]' },
      { namespace: "custom", key: "main", type: "metaobject_reference", value: "gid://e/1" },
      { namespace: "custom", key: "seats", type: "number_integer", value: "3" },
    ]
  );
});

test("a ref with no id stops the push instead of sending a broken field", () => {
  assert.throws(() => resolveMetafields([{ namespace: "custom", key: "c", type: "metaobject_reference", refs: ["color_swatch/x"] }], {}), /color_swatch\/x has no id/);
});
