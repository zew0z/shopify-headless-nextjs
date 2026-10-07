import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { createCartStore, cartLines } = await loadSdk("cart-store");

const cart = (id, lines = []) => ({ id, checkoutUrl: `https://shop/checkout/${id}`, totalQuantity: lines.length, lines: { edges: lines.map((node) => ({ node })) }, cost: {} });
const memory = (id = null) => ({ id, get() { return this.id; }, set(v) { this.id = v; }, clear() { this.id = null; } });

test("two quick adds create one cart, then add to it", async () => {
  const calls = [];
  const action = async (body) => { calls.push(body.action); await new Promise((r) => setTimeout(r, 5)); return cart("gid://shopify/Cart/1"); };
  const store = createCartStore({ action, storage: memory() });
  await Promise.all([store.add([{ merchandiseId: "v1", quantity: 1 }]), store.add([{ merchandiseId: "v2", quantity: 1 }])]);
  assert.deepEqual(calls, ["create", "add"]);
});

test("a failed change keeps the cart and shows the message; the next success clears it", async () => {
  let fail = true;
  const action = async (body) => { if (body.action === "add" && fail) throw new Error("Out of stock"); return cart("gid://shopify/Cart/1"); };
  const store = createCartStore({ action, storage: memory("gid://shopify/Cart/1") });
  await store.load();
  const before = store.getState().cart;
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.equal(store.getState().cart, before);
  assert.equal(store.getState().error, "Out of stock");
  fail = false;
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.equal(store.getState().error, null);
});

test("a stored cart Shopify no longer has is dropped on load", async () => {
  const storage = memory("gid://shopify/Cart/old");
  const store = createCartStore({ action: async () => null, storage });
  await store.load();
  assert.equal(storage.get(), null);
  assert.equal(store.getState().cart, null);
  assert.equal(store.getState().ready, true);
});

test("adding to a cart Shopify dropped starts a new one with the same lines", async () => {
  const calls = [];
  const action = async (body) => { calls.push(body); return body.action === "add" ? null : cart("gid://shopify/Cart/new"); };
  const storage = memory("gid://shopify/Cart/old");
  const store = createCartStore({ action, storage });
  await store.add([{ merchandiseId: "v1", quantity: 2 }]);
  assert.deepEqual(calls.map((c) => c.action), ["add", "create"]);
  assert.deepEqual(calls[1].lines, [{ merchandiseId: "v1", quantity: 2 }]);
  assert.equal(storage.get(), "gid://shopify/Cart/new");
});

test("checkout goes to Shopify's checkoutUrl", async () => {
  let went;
  const store = createCartStore({ action: async () => cart("gid://shopify/Cart/1"), storage: memory("gid://shopify/Cart/1"), goTo: (u) => (went = u) });
  await store.load();
  store.checkout();
  assert.equal(went, "https://shop/checkout/gid://shopify/Cart/1");
});

test("update and remove with no stored cart change nothing and call nothing", async () => {
  const calls = [];
  const store = createCartStore({ action: async (b) => { calls.push(b); return null; }, storage: memory() });
  await store.update("l1", 3);
  await store.remove("l1");
  assert.deepEqual(calls, []);
  assert.equal(store.getState().cart, null);
});

test("cartLines flattens Shopify's lines and hides 'Default Title'", () => {
  const image = { url: "https://cdn/throw.jpg", altText: null };
  const line = {
    id: "l1",
    quantity: 2,
    cost: { totalAmount: { amount: "20.0", currencyCode: "EUR" } },
    merchandise: { id: "v1", title: "Default Title", selectedOptions: [], price: { amount: "10.0", currencyCode: "EUR" }, product: { id: "p1", title: "Throw", handle: "throw", featuredImage: image } },
  };
  const [view] = cartLines(cart("c", [line]));
  assert.equal(view.productTitle, "Throw");
  assert.equal(view.variantTitle, null);
  assert.equal(view.variantId, "v1");
  assert.equal(view.unitPrice.amount, "10.0");
  assert.equal(view.total.amount, "20.0");
  assert.equal(view.image, image);
  assert.deepEqual(cartLines(null), []);
});
