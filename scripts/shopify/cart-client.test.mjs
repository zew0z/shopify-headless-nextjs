import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

/** The browser side of /api/cart. The route answers with the cart itself, never { cart }. */
const { cartAction, isShopifyCartId } = await loadSdk("cart-client");

const CART = { id: "gid://shopify/Cart/c1-abc?key=k", checkoutUrl: "https://checkout.example.gr/cart/c/abc", totalQuantity: 1 };

function stubFetch(status, body, contentType = "application/json") {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
  };
  return calls;
}

test("a successful answer is the cart itself", async () => {
  const calls = stubFetch(200, CART);
  const cart = await cartAction({ action: "add", cartId: CART.id, lines: [{ merchandiseId: "gid://shopify/ProductVariant/1", quantity: 1 }] });
  assert.deepEqual(cart, CART);
  assert.equal(calls[0].url, "/api/cart");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).action, "add");
});

test("null means the shop is not connected to Shopify, and is returned as null", async () => {
  stubFetch(200, null);
  assert.equal(await cartAction({ action: "get", cartId: CART.id }), null);
});

test("an error answer throws Shopify's message", async () => {
  stubFetch(500, { error: "Shopify Cart Error: The merchandise is out of stock" });
  await assert.rejects(cartAction({ action: "add", cartId: CART.id, lines: [] }), /out of stock/);
});

test("a failure that is not JSON still throws, with the status", async () => {
  stubFetch(502, "<html>Bad gateway</html>", "text/html");
  await assert.rejects(cartAction({ action: "get", cartId: CART.id }), /Cart request failed \(502\)/);
});

test("only Shopify cart ids count, so carts saved by older code are dropped", () => {
  assert.equal(isShopifyCartId("gid://shopify/Cart/c1-abc?key=k"), true);
  assert.equal(isShopifyCartId("cart_1791322249666"), false);
  assert.equal(isShopifyCartId(null), false);
});
