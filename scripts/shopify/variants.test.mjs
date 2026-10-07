import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { findVariant, defaultVariant, isOptionValueAvailable } = await loadSdk("variants");
const v = (id, sale, opts) => ({ id, availableForSale: sale, selectedOptions: Object.entries(opts).map(([name, value]) => ({ name, value })) });
const product = { variants: { edges: [v("1", false, { Size: "S", Color: "Red" }), v("2", true, { Size: "M", Color: "Red" }), v("3", true, { Size: "S", Color: "Blue" })].map((node) => ({ node })) } };

test("findVariant matches every picked option, names in any case", () => {
  assert.equal(findVariant(product, { size: "M", color: "Red" }).id, "2");
  assert.equal(findVariant(product, { Size: "L", Color: "Red" }), null);
});

test("defaultVariant prefers the first one for sale", () => {
  assert.equal(defaultVariant(product).id, "2");
  assert.equal(defaultVariant({ variants: { edges: [] } }), null);
});

test("isOptionValueAvailable greys out a size that is sold out in the picked colour", () => {
  assert.equal(isOptionValueAvailable(product, { Color: "Red" }, "Size", "S"), false);
  assert.equal(isOptionValueAvailable(product, { Color: "Blue" }, "Size", "S"), true);
});
