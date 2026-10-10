import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { createCartStore: createStore, cartLines } = await loadSdk("cart-store");
const createCartStore = (options) => createStore({ checkoutUrl: async (id) => `https://shop/checkout/${id}`, ...options });
const { CartRequestError } = await loadSdk("cart-client");

const cart = (id, lines = []) => ({ id, checkoutUrl: `https://shop/checkout/${id}`, totalQuantity: Math.max(1, lines.length), lines: { edges: lines.map((node) => ({ node })) }, cost: {} });
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

test("a successful add is reported with Shopify's cart and the added lines; a failed one is not", async () => {
  const added = [];
  let fail = false;
  const action = async () => { if (fail) throw new Error("Out of stock"); return cart("gid://shopify/Cart/1"); };
  const store = createCartStore({ action, storage: memory(), onAdd: (c, lines) => added.push([c.id, lines]) });
  await store.add([{ merchandiseId: "v1", quantity: 2 }]);
  fail = true;
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.deepEqual(added, [["gid://shopify/Cart/1", [{ merchandiseId: "v1", quantity: 2 }]]]);
});

test("a broken add report never breaks the cart", async () => {
  const store = createCartStore({ action: async () => cart("gid://shopify/Cart/1"), storage: memory(), onAdd: () => { throw new Error("analytics down"); } });
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().cart.id, "gid://shopify/Cart/1");
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
  await store.checkout();
  assert.equal(went, "https://shop/checkout/gid://shopify/Cart/1");
});

test("checkout stays blocked during queued writes, including before the first microtask", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const went = [];
  const store = createCartStore({ action: async (body) => { if (body.action === "update") await held; return cart("gid://shopify/Cart/1"); }, storage: memory("gid://shopify/Cart/1"), goTo: (url) => went.push(url) });
  await store.load();
  const update = store.update("line", 2);
  await store.checkout();
  await Promise.resolve();
  await store.checkout();
  assert.deepEqual(went, []);
  release();
  await update;
  await store.checkout();
  assert.equal(went.length, 1);
});

test("a read outage retains an inert cart until a fresh read succeeds", async () => {
  let fail = false;
  const went = [];
  const storage = memory("gid://shopify/Cart/1");
  const store = createCartStore({ action: async () => { if (fail) throw new Error("Cart unavailable"); return cart(storage.id); }, storage, goTo: (url) => went.push(url) });
  await store.load();
  const before = store.getState().cart;
  fail = true;
  await store.load();
  assert.equal(store.getState().cart, before);
  assert.equal(storage.id, before.id);
  await store.checkout();
  assert.deepEqual(went, []);
  fail = false;
  await store.load();
  await store.checkout();
  assert.equal(went.length, 1);
});

test("busy stays true until every queued mutation settles", async () => {
  const gates = Array.from({ length: 2 }, () => {
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    return { wait, release };
  });
  let next = 0;
  const store = createCartStore({ action: async (body) => { if (body.action !== "get") await gates[next++].wait; return cart("gid://shopify/Cart/1"); }, storage: memory("gid://shopify/Cart/1") });
  await store.load();
  const busy = [];
  store.subscribe(() => busy.push(store.getState().busy));
  const first = store.update("line", 2);
  const second = store.remove("line");
  gates[0].release();
  await first;
  assert.equal(store.getState().busy, true);
  gates[1].release();
  await second;
  assert.equal(store.getState().busy, false);
  assert.ok(busy.slice(0, -1).every(Boolean), "no idle notification between queued writes");
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
    cost: { totalAmount: { amount: "20.0", currencyCode: "EUR" }, amountPerQuantity: { amount: "10.0", currencyCode: "EUR" } },
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

test("cartLines unit price is what the shopper pays per item (a subscription price), falling back to the variant price", () => {
  const product = { id: "p1", title: "Coffee", handle: "coffee", featuredImage: null };
  const merchandise = { id: "v1", title: "Bag", selectedOptions: [], price: { amount: "10.0", currencyCode: "EUR" }, product };
  const withPlan = { id: "l1", quantity: 2, cost: { totalAmount: { amount: "18.0", currencyCode: "EUR" }, amountPerQuantity: { amount: "9.0", currencyCode: "EUR" } }, merchandise };
  const without = { id: "l2", quantity: 1, cost: { totalAmount: { amount: "10.0", currencyCode: "EUR" } }, merchandise };
  const [a, b] = cartLines(cart("c", [withPlan, without]));
  assert.equal(a.unitPrice.amount, "9.0");
  assert.equal(b.unitPrice.amount, "10.0");
});

test("the cart fragment asks Shopify for the price per quantity of each line", async () => {
  const { cartFragment } = await loadSdk("queries");
  assert.match(cartFragment, /amountPerQuantity\s*{\s*amount\s*currencyCode\s*}/);
});

const GONE = "Shopify Cart Error: The specified cart does not exist.";

test("public notFound codes recover an expired cart without matching provider text", async () => {
  const calls = [];
  const storage = memory("gid://shopify/Cart/old");
  const action = async (body) => {
    calls.push(body.action);
    if (body.action !== "create") throw new CartRequestError("Your cart expired. Add the items again.", "notFound");
    return cart("gid://shopify/Cart/new");
  };
  const store = createCartStore({ action, storage });
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.deepEqual(calls, ["add", "create"]);
  assert.equal(storage.get(), "gid://shopify/Cart/new");
  await store.remove("line");
  assert.equal(storage.get(), null);
  assert.equal(store.getState().cart, null);
  assert.equal(store.getState().error, "Your cart expired. Add the items again.");
});

test("add to a cart Shopify reports as not existing (an error, not null) starts a new one", async () => {
  const calls = [];
  const action = async (body) => {
    calls.push(body.action);
    if (body.action === "add") throw new Error(GONE);
    return cart("gid://shopify/Cart/new");
  };
  const storage = memory("gid://shopify/Cart/old");
  const store = createCartStore({ action, storage });
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.deepEqual(calls, ["add", "create"]);
  assert.equal(storage.get(), "gid://shopify/Cart/new");
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().cart.id, "gid://shopify/Cart/new");
});

test("update, remove and discount on a cart that no longer exists drop it and say so", async () => {
  for (const change of [(s) => s.update("l1", 2), (s) => s.remove("l1"), (s) => s.applyDiscountCodes(["X"])]) {
    const storage = memory("gid://shopify/Cart/old");
    const store = createCartStore({ action: async () => { throw new Error(GONE); }, storage });
    await change(store);
    assert.equal(store.getState().cart, null);
    assert.equal(storage.get(), null);
    assert.equal(store.getState().error, "Your cart expired. Add the items again.");
  }
});

test("other errors on update leave the stored cart alone", async () => {
  const storage = memory("gid://shopify/Cart/1");
  const store = createCartStore({ action: async () => { throw new Error("Out of stock"); }, storage });
  await store.update("l1", 2);
  assert.equal(storage.get(), "gid://shopify/Cart/1");
  assert.equal(store.getState().error, "Out of stock");
});

test("a subscriber that throws once does not freeze later changes", async () => {
  const store = createCartStore({ action: async () => cart("gid://shopify/Cart/1"), storage: memory() });
  let first = true;
  store.subscribe(() => { if (first) { first = false; throw new Error("listener bug"); } });
  await store.add([{ merchandiseId: "v1", quantity: 1 }]).catch(() => {});
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.equal(store.getState().cart.id, "gid://shopify/Cart/1");
  assert.equal(store.getState().busy, false);
});


test("checkout keeps its navigation lock and refuses further writes until a persisted restore", async () => {
  const calls = [];
  const storage = memory("gid://shopify/Cart/1");
  let reads = 0;
  const store = createCartStore({ action: async (body) => { calls.push(body.action); return reads++ ? cart("gid://shopify/Cart/1", [{ id: "restored" }]) : cart("gid://shopify/Cart/1"); }, storage, goTo: () => {} });
  await store.load();
  await store.checkout();
  assert.equal(store.getState().busy, true);
  await store.add([{ merchandiseId: "v", quantity: 1 }]);
  await store.update("line", 2);
  await store.remove("line");
  await store.applyDiscountCodes(["SAVE"]);
  await store.checkout();
  assert.deepEqual(calls, ["get"]);
  await store.restore();
  assert.deepEqual(calls, ["get", "get"]);
  assert.equal(store.getState().busy, false);
  assert.equal(store.getState().cart.lines.edges[0].node.id, "restored");
});

test("checkout failure or a null handoff releases the lock without navigating", async () => {
  for (const checkoutUrl of [async () => null, async () => { throw new Error("handoff unavailable"); }]) {
    const store = createCartStore({ action: async () => cart("gid://shopify/Cart/1"), checkoutUrl, storage: memory("gid://shopify/Cart/1"), goTo: () => assert.fail("must not navigate") });
    await store.load();
    await store.checkout();
    assert.equal(store.getState().busy, false);
    assert.ok(store.getState().error);
    assert.equal(store.getState().cart.id, "gid://shopify/Cart/1");
  }
});

test("confirmed warning cart replaces state, preserves storage, and requires review before checkout", async () => {
  const storage = memory();
  const adjusted = { ...cart("gid://shopify/Cart/adjusted"), warnings: ["MERCHANDISE_NOT_ENOUGH_STOCK"] };
  const store = createCartStore({ action: async (body) => body.action === "get" ? cart(adjusted.id) : adjusted, storage, goTo: () => assert.fail("review required") });
  await store.add([{ merchandiseId: "v", quantity: 5 }]);
  assert.equal(store.getState().cart, adjusted);
  assert.equal(storage.id, adjusted.id);
  assert.match(store.getState().error, /Review your cart/);
  await store.checkout();
  await store.load();
  assert.equal(store.getState().error, null);
});

test("quantity edits and whitespace discount attempts do not become remove/clear mutations", async () => {
  const calls = [];
  const store = createCartStore({ action: async (body) => { calls.push(body); return cart("gid://shopify/Cart/1"); }, storage: memory("gid://shopify/Cart/1") });
  for (const quantity of ["", "  ", 0, -1, NaN, 1.5, 1001]) await store.update("line", quantity);
  await store.applyDiscountCodes(["  "]);
  assert.deepEqual(calls, []);
  await store.remove("line");
  await store.applyDiscountCodes([]);
  assert.deepEqual(calls.map((c) => c.action), ["remove", "discount"]);
  assert.deepEqual(calls[1].discountCodes, []);
});

test("a persisted restore cancels an older in-flight checkout handoff", async () => {
  let resolveUrl;
  const handoff = new Promise((resolve) => { resolveUrl = resolve; });
  const store = createCartStore({ action: async () => cart("gid://shopify/Cart/1"), checkoutUrl: async () => handoff, storage: memory("gid://shopify/Cart/1"), goTo: () => assert.fail("stale navigation") });
  await store.load();
  const leaving = store.checkout();
  await store.restore();
  resolveUrl("https://shop/checkout/old");
  await leaving;
  assert.equal(store.getState().busy, false);
});
