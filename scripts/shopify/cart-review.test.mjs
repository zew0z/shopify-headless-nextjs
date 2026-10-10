import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "  HTTPS://FIXTURE.MYSHOPIFY.COM/  ";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-fixture";
process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN = "";
const sdk = await loadSdk();
const { stockLimit, merchandiseDiscount } = await loadSdk("cart-utils");
const { validateCheckoutUrl } = await loadSdk("checkout");
const { shopifyConfig } = await loadSdk("config");
const id = "gid://shopify/Cart/fixture?key=synthetic";
const money = (amount, currencyCode = "EUR") => ({ amount, currencyCode });
const cart = { id, checkoutUrl: "https://fixture.myshopify.com/checkouts/fixture?key=synthetic", totalQuantity: 1,
  cost: { subtotalAmount: money("20.00"), totalAmount: money("100.00") }, lines: { edges: [] } };
const operations = [
  ["cartCreate", () => sdk.createCart([{ merchandiseId: "variant", quantity: 1 }])],
  ["cartLinesAdd", () => sdk.addToCart(id, [{ merchandiseId: "variant", quantity: 1 }])],
  ["cartLinesUpdate", () => sdk.updateCartLines(id, [{ id: "line", quantity: 0 }])],
  ["cartLinesRemove", () => sdk.removeFromCart(id, ["line"])],
  ["cartDiscountCodesUpdate", () => sdk.applyDiscountCode(id, [" SAVE "])],
  ["cartGiftCardCodesAdd", () => sdk.addGiftCard(id, ["gift-fixture"])],
  ["cartGiftCardCodesRemove", () => sdk.removeGiftCard(id, ["applied-fixture"])],
  ["cartBuyerIdentityUpdate", () => sdk.updateCartBuyerIdentity(id, { countryCode: "GR" })],
];

for (const [name, operation] of operations) test(`Next ${name} keeps a confirmed cart with safe stock warnings and no replay`, async () => {
  const original = fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const { query } = JSON.parse(init.body);
    assert.match(query, /warnings\s*{\s*code\s*}/);
    assert.doesNotMatch(query, /warnings\s*{[^}]*\b(?:message|target)\b/);
    return Response.json({ data: { [name]: { cart, userErrors: [], warnings: [
      { code: "MERCHANDISE_NOT_ENOUGH_STOCK", message: "PRIVATE-MESSAGE", target: "PRIVATE-TARGET" },
      { code: "MERCHANDISE_OUT_OF_STOCK" }, { code: "MERCHANDISE_OUT_OF_STOCK" }, { code: "PRIVATE-CODE" },
    ] } } });
  };
  try {
    const result = await operation();
    assert.equal(result.id, id);
    assert.deepEqual(result.warnings, ["MERCHANDISE_NOT_ENOUGH_STOCK", "MERCHANDISE_OUT_OF_STOCK"]);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-/);
    assert.equal(result.discount, null, "no discount inferred from cost differences");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("Next user errors take precedence over confirmed warning notices", async () => {
  const original = fetch;
  globalThis.fetch = async () => Response.json({ data: { cartLinesAdd: { cart, userErrors: [{ message: "invalid line", field: ["lines"] }], warnings: [{ code: "MERCHANDISE_OUT_OF_STOCK" }] } } });
  try { await assert.rejects(sdk.addToCart(id, []), /invalid line/); } finally { globalThis.fetch = original; }
});

test("positive stock caps remain; still-buyable zero/negative/null counts have no known cap", () => {
  for (const value of [0, -1, null, undefined]) assert.equal(stockLimit(true, value), null);
  assert.equal(stockLimit(true, 7), 7);
  assert.equal(stockLimit(false, 0), 0);
  assert.equal(stockLimit(false, 7), 7);
});

test("returned merchandise discounts exclude shipping/foreign currency and sum decimals exactly", () => {
  const allocation = (amount, targetType = "LINE_ITEM", currencyCode = "EUR") => ({ targetType, discountedAmount: money(amount, currencyCode) });
  assert.deepEqual(merchandiseDiscount([allocation("0.10"), allocation("0.20"), allocation("2.005"), allocation("99", "SHIPPING_LINE"), allocation("99", "LINE_ITEM", "USD")], "EUR"), money("2.305"));
  assert.deepEqual(merchandiseDiscount([allocation("9007199254740993.01"), allocation("0.02")], "EUR"), money("9007199254740993.03"));
  assert.equal(merchandiseDiscount([], "EUR"), null);
  assert.equal(merchandiseDiscount([allocation("0")], "EUR"), null);
});

test("checkout uses normalized config and exact approved hosts while refusing unsafe URLs", () => {
  assert.equal(shopifyConfig.domain, "fixture.myshopify.com");
  assert.equal(validateCheckoutUrl(cart.checkoutUrl, shopifyConfig.domain), cart.checkoutUrl);
  assert.equal(validateCheckoutUrl("https://custom.example/path", shopifyConfig.domain, " CUSTOM.EXAMPLE , "), "https://custom.example/path");
  assert.equal(validateCheckoutUrl("https://checkout.mock.shop/path", "mock.shop"), "https://checkout.mock.shop/path");
  assert.throws(() => validateCheckoutUrl("https://checkout.mock.shop/path", shopifyConfig.domain));
  assert.throws(() => validateCheckoutUrl("https://checkout.mock.shop.evil.test/path", "mock.shop"));
  for (const url of ["http://fixture.myshopify.com/path", "https://fixture.myshopify.com.evil.test/path", "https://user:pass@fixture.myshopify.com/path", "https://fixture.myshopify.com:8443/path", "https://evil.test/path"]) assert.throws(() => validateCheckoutUrl(url, shopifyConfig.domain));
});

test("blank discount applications are refused before writes, and explicit empty list still clears", async () => {
  const original = fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.deepEqual(JSON.parse(init.body).variables.discountCodes, []); return Response.json({ data: { cartDiscountCodesUpdate: { cart, userErrors: [] } } }); };
  try {
    await assert.rejects(sdk.applyDiscountCode(id, ["   "]));
    assert.equal(calls, 0);
    await sdk.applyDiscountCode(id, []);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("checkout re-reads the cart; null/empty checkout is distinct from an upstream failure", async () => {
  const original = fetch;
  try {
    for (const data of [null, { ...cart, totalQuantity: 0 }, { ...cart, checkoutUrl: null }]) {
      globalThis.fetch = async () => Response.json({ data: { cart: data } });
      assert.equal(await sdk.getCheckoutUrl(id), null);
    }
    globalThis.fetch = async () => Response.json({ data: { cart } });
    assert.equal(await sdk.getCheckoutUrl(id), cart.checkoutUrl);
    globalThis.fetch = async () => Response.json({ errors: [{ message: "failure" }] });
    await assert.rejects(sdk.getCheckoutUrl(id));
  } finally { globalThis.fetch = original; }
});
