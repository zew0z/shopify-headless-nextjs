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

test("getPolicies returns only the policies the shop has", async () => {
  const p = (handle) => ({ id: handle, title: handle, handle, body: "<p>x</p>", url: `https://s/policies/${handle}` });
  answer({ shop: { privacyPolicy: p("privacy-policy"), refundPolicy: null, shippingPolicy: p("shipping-policy"), termsOfService: p("terms-of-service") } });
  assert.deepEqual((await sdk.getPolicies()).map((x) => x.handle), ["privacy-policy", "shipping-policy", "terms-of-service"]);
});

test("getPolicy finds one by handle, or null", async () => {
  answer({ shop: { privacyPolicy: null, refundPolicy: { id: "r", title: "Refund", handle: "refund-policy", body: "b", url: "u" }, shippingPolicy: null, termsOfService: null } });
  assert.equal((await sdk.getPolicy("refund-policy")).title, "Refund");
  assert.equal(await sdk.getPolicy("nope"), null);
});

test("getMenu sends the handle and returns null for a missing menu", async () => {
  answer({ menu: null });
  assert.equal(await sdk.getMenu("footer"), null);
  assert.equal(sent.variables.handle, "footer");
});

test("getShop returns the shop details", async () => {
  const shop = { name: "Shop", description: null, primaryDomain: { url: "https://s.example", host: "s.example" }, brand: null };
  answer({ shop });
  assert.deepEqual(await sdk.getShop(), shop);
});

test("content reads are cached for an hour under the content tag", async () => {
  let init;
  globalThis.fetch = async (_u, i) => { init = i; return new Response(JSON.stringify({ data: { page: null } }), { status: 200 }); };
  await sdk.getPage("about");
  assert.equal(init.cache, "force-cache");
  assert.deepEqual(init.next.tags, ["content"]);
  assert.equal(init.next.revalidate, 3600);
});

test("content reads throw when Shopify fails", async () => {
  globalThis.fetch = async () => new Response("down", { status: 500 });
  for (const read of [() => sdk.getShop(), () => sdk.getMenu("main-menu"), () => sdk.getPolicies(), () => sdk.getPage("about")]) {
    await assert.rejects(read(), sdk.ShopifyError);
  }
});
