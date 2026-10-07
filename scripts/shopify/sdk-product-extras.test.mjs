import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-test-token";
const sdk = await loadSdk();

let sent;
function answer(data) {
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
}

test("getProduct asks for the extra fields the page names, in order", async () => {
  answer({ product: { id: "p", handle: "a", metafields: [{ namespace: "custom", key: "material", type: "single_line_text_field", value: "Wool" }, null] } });
  const p = await sdk.getProduct("a", { metafields: [{ namespace: "custom", key: "material" }, { namespace: "custom", key: "care" }] });
  assert.deepEqual(sent.variables.metafields, [{ namespace: "custom", key: "material" }, { namespace: "custom", key: "care" }]);
  assert.equal(p.metafields[0].value, "Wool");
  assert.equal(p.metafields[1], null);
});

test("getProduct with no extra fields sends an empty list", async () => {
  answer({ product: null });
  await sdk.getProduct("a");
  assert.deepEqual(sent.variables.metafields, []);
});

test("getProductStock maps variant ids to the quantity Shopify has", async () => {
  answer({ product: { variants: { nodes: [{ id: "v1", quantityAvailable: 3 }, { id: "v2", quantityAvailable: null }] } } });
  assert.deepEqual(await sdk.getProductStock("a"), { v1: 3, v2: null });
});

test("getProductStock says which scope is missing when Shopify refuses", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ message: "Access denied for quantityAvailable field." }] }), { status: 200 });
  await assert.rejects(sdk.getProductStock("a"), /unauthenticated_read_product_inventory/);
});

test("getProductStock throws when Shopify answers with no data", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
  await assert.rejects(sdk.getProductStock("a"), sdk.ShopifyError);
});
