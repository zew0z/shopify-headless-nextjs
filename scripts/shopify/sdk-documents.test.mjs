import test from "node:test";
import assert from "node:assert/strict";
import { loadSdkDocuments } from "./validate-storefront.mjs";

/**
 * Offline guards for problems found by `pnpm shop-setup validate-queries`
 * against Shopify's real 2026 schemas. The live check is the proof; these stop
 * the same mistakes returning without a network call.
 */
const docs = Object.fromEntries(loadSdkDocuments().map((d) => [d.name, d.query]));

test("no document defines the same fragment twice", () => {
  for (const [name, query] of Object.entries(docs)) {
    const names = [...query.matchAll(/^\s*fragment\s+(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(names, [...new Set(names)], `${name} defines a fragment more than once`);
  }
});

test("predictive search still pulls in the product, collection and image fragments", () => {
  const q = docs.predictiveSearchQuery;
  for (const fragment of ["ProductFragment", "CollectionFragment", "ImageFragment"]) {
    assert.match(q, new RegExp(`fragment ${fragment} on`), `${fragment} went missing`);
  }
});

test("discount codes are a required list, so clearing codes sends an empty array", () => {
  assert.match(docs.updateCartDiscountCodesMutation, /\$discountCodes: \[String!\]!/);
});

test("removing a gift card needs the applied card ids, and the cart query returns them", () => {
  const remove = docs.removeCartGiftCardCodesMutation;
  assert.match(remove, /\$appliedGiftCardIds: \[ID!\]!/);
  assert.match(remove, /appliedGiftCardIds: \$appliedGiftCardIds/);
  assert.doesNotMatch(remove, /giftCardCodes/);
  assert.match(docs.getCartQuery, /appliedGiftCards\s*\{\s*id\b/);
});

test("product options carry swatches, and only the product page asks for subscriptions and extra fields", () => {
  assert.match(docs.getProductsQuery, /optionValues\s*\{[^}]*swatch/s);
  assert.match(docs.getProductByHandleQuery, /sellingPlanGroups/);
  assert.match(docs.getProductByHandleQuery, /metafields\(identifiers: \$metafields\)/);
  assert.doesNotMatch(docs.getProductsQuery, /sellingPlanGroups|quantityAvailable/);
});
