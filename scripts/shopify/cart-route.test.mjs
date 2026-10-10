import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { findSdkDir } from "./sdk-dir.mjs";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
// Exercise the actual route with fake SDK operations; no merchant configuration or network.
const appDir = path.dirname(path.dirname(findSdkDir(process.cwd())));
const compiled = ts.transpileModule(readFileSync(path.join(appDir, "app/api/cart/route.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function endpoint(call) {
  const sdk = Object.fromEntries(["createCart", "getCart", "addToCart", "updateCartLines", "removeFromCart", "applyDiscountCode", "addGiftCard", "removeGiftCard", "updateCartBuyerIdentity", "getCheckoutUrl"].map((name) => [name, (...args) => call(name, args)]));
  const mod = { exports: {} };
  new Function("module", "exports", "require", compiled)(mod, mod.exports, (id) => {
    if (id === "next/server") return { NextResponse };
    if (id === "@/lib/shopify" || id === "../../../lib/shopify") return sdk;
    throw new Error(`Unexpected route dependency: ${id}`);
  });
  return mod.exports.POST;
}
const request = (body) => new Request("https://fixture.test/api/cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("Next cart route rejects malformed JSON and non-object bodies before SDK calls", async () => {
  const post = endpoint(async () => { assert.fail("invalid body reached the SDK"); });
  for (const body of ["{", "null", "[]", "\"invalid\""]) {
    const result = await post(new Request("https://fixture.test/api/cart", { method: "POST", headers: { "content-type": "application/json" }, body }));
    assert.equal(result.status, 400);
    assert.deepEqual(await result.json(), { error: "Invalid cart request", code: "invalid" });
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  }
});

test("Next cart route rejects missing, fractional and invalid quantities before SDK calls", async () => {
  const calls = [];
  const post = endpoint(async (...args) => { calls.push(args); return null; });
  for (const action of ["create", "add", "update"]) for (const quantity of [undefined, -0.5, 0.5, 1001, "2"]) {
    const result = await post(request({ action, cartId: "gid://shopify/Cart/1", lines: [{ id: "line", merchandiseId: "gid://shopify/ProductVariant/2", quantity }] }));
    assert.equal(result.status, 400);
    assert.equal((await result.json()).code, "invalid");
  }
  assert.deepEqual(calls, []);
});

test("Next cart route preserves explicit remove intent, whole quantities and uncached responses", async () => {
  const calls = [];
  const post = endpoint(async (name, args) => { calls.push({ name, args }); return { id: "gid://shopify/Cart/1" }; });
  for (const [action, quantity] of [["create", 1], ["add", 2], ["update", 1]]) {
    const result = await post(request({ action, cartId: "gid://shopify/Cart/1", lines: [{ id: "line", merchandiseId: "gid://shopify/ProductVariant/2", quantity }] }));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(calls[2].args[1][0].quantity, 1);
  assert.equal((await post(request({ action: "update", cartId: "gid://shopify/Cart/1", lines: [{ id: "line", quantity: 0 }] }))).status, 400);
  await post(request({ action: "remove", cartId: "gid://shopify/Cart/1", lineIds: ["line"] }));
  assert.equal(calls[3].name, "removeFromCart");
  assert.equal((await post(request({ action: "create" }))).status, 200);
});

test("Next cart route does not expose or log raw backend details", async () => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const result = await endpoint(async () => { throw new Error("PRIVATE-BACKEND-DETAIL-SENTINEL"); })(request({ action: "get", cartId: "gid://shopify/Cart/1" }));
    assert.equal(result.status, 502);
    assert.equal((await result.clone().json()).code, "backend");
    assert.doesNotMatch(await result.text(), /PRIVATE-BACKEND-DETAIL-SENTINEL/);
    assert.equal(logged.length, 0);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  } finally { console.error = original; }
});

test("Next cart route exposes an expired cart as a public code, retaining compatibility", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await endpoint(async () => { throw new Error("Shopify Cart Error: The specified cart does not exist."); })(request({ action: "get", cartId: "gid://shopify/Cart/1" }));
    assert.equal(result.status, 404);
    assert.equal((await result.json()).code, "notFound");
  } finally { console.error = original; }
});


test("ordinary cart responses omit keyed checkout URLs; explicit checkout handoff retains them", async () => {
  const url = "https://fixture.myshopify.com/checkouts/1?key=PRIVATE-CHECKOUT-SENTINEL";
  const post = endpoint(async (name) => name === "getCheckoutUrl" ? url : { id: "gid://shopify/Cart/1?key=cart-fixture", checkoutUrl: url });
  for (const action of ["get", "create", "add", "update", "remove", "discount", "addGiftCard", "removeGiftCard", "buyerIdentity"]) {
    const result = await post(request({ action, cartId: "gid://shopify/Cart/1", lines: [{ id: "line", quantity: 1 }], discountCodes: [], appliedGiftCardIds: [] }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).checkoutUrl, "");
  }
  assert.deepEqual(await (await post(request({ action: "checkout", cartId: "gid://shopify/Cart/1" }))).json(), { checkoutUrl: url });
});

test("blank discount inputs do not clear existing codes; explicit empty list does", async () => {
  const calls = [];
  const post = endpoint(async (name, args) => { calls.push({ name, args }); return null; });
  for (const discountCodes of [undefined, "", [""], ["  "], [null]]) {
    assert.equal((await post(request({ action: "discount", cartId: "id", discountCodes }))).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await post(request({ action: "discount", cartId: "id", discountCodes: [] }))).status, 200);
  assert.deepEqual(calls[0].args[1], []);
});
