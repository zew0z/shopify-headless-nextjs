import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { createAnalyticsTracker } = await loadSdk("analytics-tracker");

const shop = { shopId: "gid://shopify/Shop/1", currency: "EUR", acceptedLanguage: "EN" };
const browser = () => ({
  uniqueToken: "u",
  visitToken: "v",
  url: "https://shop.example.com/x",
  path: "/x",
  search: "",
  referrer: "",
  title: "T",
  userAgent: "UA",
  navigationType: "navigate",
  navigationApi: "PerformanceNavigationTiming",
});

function setup({ allowed = true, banner = false } = {}) {
  const sent = [];
  const consent = { allowed, banner };
  const cp = {
    consentStatus: "loaded",
    currentVisitorConsent: () => ({ analytics: consent.allowed ? "yes" : consent.banner ? "" : "no" }),
    analyticsProcessingAllowed: () => consent.allowed,
    marketingAllowed: () => false,
    saleOfDataAllowed: () => true,
    shouldShowBanner: () => consent.banner,
  };
  const t = createAnalyticsTracker({ send: async (events) => sent.push(events), privacy: () => cp, browser });
  return { t, sent, consent, names: () => sent.map((batch) => batch.map((e) => e.payload.event_name ?? e.schema_id)) };
}

const PAGE = ["trekkie_storefront_page_view/1.4", "page_rendered"];

test("nothing is sent before the shop is known and consent has loaded", () => {
  const { t, sent } = setup();
  t.page("/x");
  t.setShop(shop);
  assert.equal(sent.length, 0);
  t.ready();
  assert.equal(sent.length, 1);
});

test("one page view per page, sent again only after a navigation", () => {
  const { t, names } = setup();
  t.setShop(shop);
  t.ready();
  t.page("/a");
  t.page("/a");
  t.page("/b");
  assert.deepEqual(names(), [PAGE, PAGE]);
});

test("without consent nothing goes out; when the visitor accepts, the current page is sent once", () => {
  const { t, sent, consent } = setup({ allowed: false });
  t.setShop(shop);
  t.ready();
  t.page("/a");
  assert.equal(sent.length, 0);
  consent.allowed = true;
  t.consentChanged();
  t.consentChanged();
  assert.equal(sent.length, 1);
});

test("a shown banner holds events until the visitor chooses", () => {
  const { t, sent, consent } = setup({ allowed: false, banner: true });
  t.setShop(shop);
  t.ready();
  t.page("/a");
  assert.equal(sent.length, 0);
  consent.allowed = true;
  t.consentChanged();
  assert.equal(sent.length, 1);
});

const mug = { productGid: "gid://shopify/Product/11", variantGid: "gid://shopify/ProductVariant/22", name: "Mug", variantName: "Blue", brand: "Acme", price: "12.50", quantity: 1 };

test("a product view registered before its page view goes in the same batch, and the page view says product", () => {
  const { t, sent, names } = setup();
  t.setShop(shop);
  t.ready();
  t.productView("/products/mug", [mug]);
  t.page("/products/mug");
  assert.deepEqual(names(), [["product_page_rendered", ...PAGE]]);
  assert.equal(sent[0][1].payload.pageType, "product");
  assert.equal(sent[0][1].payload.resourceId, 11);
});

test("a product view after its page was sent goes alone", () => {
  const { t, names } = setup();
  t.setShop(shop);
  t.ready();
  t.page("/products/mug");
  t.productView("/products/mug", [mug]);
  assert.deepEqual(names(), [PAGE, ["product_page_rendered"]]);
});

test("a product view for another page waits for that page", () => {
  const { t, names } = setup();
  t.setShop(shop);
  t.ready();
  t.page("/");
  t.productView("/products/mug", [mug]);
  assert.deepEqual(names(), [PAGE]);
});

test("add to cart reports the added variant from Shopify's cart, with the added quantity", () => {
  const { t, sent } = setup();
  t.setShop(shop);
  t.ready();
  const cart = {
    id: "gid://shopify/Cart/c1?key=k",
    lines: {
      edges: [
        {
          node: {
            id: "l1",
            quantity: 3,
            merchandise: {
              id: "gid://shopify/ProductVariant/22",
              title: "Blue",
              sku: "MUG-B",
              price: { amount: "12.5", currencyCode: "EUR" },
              product: { id: "gid://shopify/Product/11", title: "Mug", vendor: "Acme", productType: "Kitchen" },
            },
          },
        },
      ],
    },
  };
  t.addToCart(cart, [{ merchandiseId: "gid://shopify/ProductVariant/22", quantity: 2 }, { merchandiseId: "gid://shopify/ProductVariant/missing", quantity: 1 }]);
  assert.equal(sent.length, 1);
  const event = sent[0][0].payload;
  assert.equal(event.event_name, "product_added_to_cart");
  assert.equal(event.cart_token, "c1?key=k");
  assert.deepEqual(
    event.products.map((s) => JSON.parse(s)),
    [{ product_gid: "gid://shopify/Product/11", name: "Mug", variant: "Blue", brand: "Acme", price: 12.5, quantity: 2, variant_gid: "gid://shopify/ProductVariant/22", category: "Kitchen", sku: "MUG-B", product_id: 11, variant_id: 22 }]
  );
});

test("add to cart without consent sends nothing", () => {
  const { t, sent } = setup({ allowed: false });
  t.setShop(shop);
  t.ready();
  t.addToCart({ id: "gid://shopify/Cart/c1", lines: { edges: [] } }, [{ merchandiseId: "x", quantity: 1 }]);
  assert.equal(sent.length, 0);
});
