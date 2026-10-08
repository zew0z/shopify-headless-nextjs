# Shopify Analytics (Live View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A storefront built on the kit shows up in the shop's Shopify analytics (Live View, sessions, page and product views, add to cart), with the visitor's consent, the way a Hydrogen storefront does.

**Architecture:** Three browser-safe SDK modules and one server module. `analytics-events.ts` builds and sends Shopify's analytics events (copied from `@shopify/hydrogen-react` 2026.4.4, checked against a fixture that package produced). `privacy.ts` loads Shopify's Customer Privacy API and cookie banner the way Hydrogen does. `analytics-tracker.ts` decides when to send what. `storefront-proxy.ts` plus the route `app/api/[version]/graphql.json/route.ts` pass the privacy API's requests through the site's own domain, which Shopify now requires (without it no visitor is counted). `analytics.tsx` is the thin React glue; `getShopAnalytics()` reads what it needs from Shopify.

**Tech Stack:** TypeScript SDK (Next.js 16.3.4, React 19.2.8), Node ESM `.mjs` tooling, `node --test`.

**Spec:** this session's research, summarised here:
- Hydrogen 2026.4.7 `useCustomerPrivacy` loads `consent-tracking-api.js` (or `storefront-banner.js` with Shopify's banner) after setting `window.Shopify.customerPrivacy.config = { isHeadless, asyncConsent, asyncVisitorState, consentDomain: location.host, storefrontAccessToken }`, and wraps `setTrackingConsent` with `{ checkoutRootDomain: location.host, storefrontRootDomain: "."+shared domain, storefrontAccessToken, headlessStorefront: true }`.
- Its own source says consent and analytics "do not work without" the same-origin Storefront API proxy at `/api/(unstable|YYYY-MM)/graphql.json` (changelog: shopify.dev/changelog/posts/tracking-cookie-deprecation-hydrogen).
- Visitor ids now come from `customerPrivacy.__internal.uniqueToken/visitToken`; `_shopify_y`/`_shopify_s` are deprecated fallbacks.
- `sendShopifyAnalytics` posts `{ events, metadata }` as `text/plain` to `https://monorail-edge.shopifysvc.com/unstable/produce_batch`. Page view = `trekkie_storefront_page_view/1.4` + `custom_storefront_customer_tracking/1.2` `page_rendered`; product view and add to cart are `custom_storefront_customer_tracking/1.2` events. Sales channel `headless` maps to app id `12875497473`.
- Visits from `localhost` or `*.myshopify.dev` are flagged `isMerchantRequest`, so Live View can only be checked on a deployed domain.

## Global Constraints

- No new npm dependencies (owner's decision 2026-10-08: copy the sender, do not add `@shopify/hydrogen-react`).
- Browser-safe SDK files import nothing server-only; add every new browser file to `BROWSER_SAFE` in `scripts/shopify/client-boundary.test.mjs`.
- Nothing is sent before Shopify's privacy API has loaded the visitor's consent, and nothing at all without consent to analytics.
- Analytics never breaks a page: no function in this feature throws into the page; failures log one plain message.
- Nothing hardcoded: shop id, currency, language and checkout domain come from Shopify.
- Every new or changed GraphQL document is a `const ...Query`/fragment in `queries.ts` and passes `pnpm shop-setup validate-queries` (2026-07) and `--version=2026-10`.
- `pnpm build`, `pnpm lint` and `pnpm test:scripts` pass after every task that touches `src/`.
- Say "unverified" for anything not run against a deployed real store (Live View in particular).
- Work on branch `shopify-analytics`; merge to `main` the same day.

## File map

| File | Responsibility | Task |
|---|---|---|
| `scripts/shopify/fixtures/monorail-hydrogen-react.json` (new, done) | events `@shopify/hydrogen-react` 2026.4.4 sent for fixed input | 1 |
| `src/lib/shopify/analytics-events.ts` (new) + `scripts/shopify/analytics-events.test.mjs` | event format and sending | 1 |
| `src/lib/shopify/privacy.ts` (new) + `scripts/shopify/privacy.test.mjs` | Customer Privacy API and banner loader, consent flags, visitor ids | 2 |
| `src/lib/shopify/analytics-tracker.ts` (new) + `scripts/shopify/analytics-tracker.test.mjs` | when to send which event | 3 |
| `src/lib/shopify/storefront-proxy.ts` (new), `src/app/api/[version]/graphql.json/route.ts` (new), `scripts/frontend/kit.mjs` + tests | same-origin Storefront API proxy, shipped by kit-install | 4 |
| `queries.ts`, `types.ts`, `index.ts`, `cart-store.ts`, `cart-provider.tsx`, `analytics.tsx` (new) + tests | shop read, cart line fields, React glue, add-to-cart hook | 5 |
| demo `layout.tsx`, product page, `cart-context.tsx`; `steps.mjs`; `docs/frontend-wiring.md`; connect skill | wiring and instructions | 6 |

---

### Task 1: Event format and sending

**Files:**
- Create: `src/lib/shopify/analytics-events.ts`
- Test: `scripts/shopify/analytics-events.test.mjs` (fixture already at `scripts/shopify/fixtures/monorail-hydrogen-react.json`)

**Interfaces:**
- Produces: `AnalyticsShop { shopId; currency; acceptedLanguage }`, `BrowserParameters`, `ConsentFlags`, `AnalyticsProduct`, `AnalyticsPayload`, `MonorailEvent`, `pageViewEvents(p)`, `productViewEvents(p)`, `addToCartEvents(p)` (each `MonorailEvent[]`), `sendToShopify(events, send = fetch): Promise<boolean>`, `MONORAIL_URL`, `parseGid`.

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { pageViewEvents, productViewEvents, addToCartEvents, sendToShopify, MONORAIL_URL } = await loadSdk("analytics-events");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/monorail-hydrogen-react.json", import.meta.url), "utf8"));
const VOLATILE = new Set(fixture.volatile);
const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, strip(x)])) : v;

for (const [name, build] of [["pageView", pageViewEvents], ["productView", productViewEvents], ["addToCart", addToCartEvents]]) {
  test(`${name} events match what Shopify's own package sends`, () => {
    const { input, events } = fixture.cases[name];
    assert.deepEqual(strip(build(input)), events);
  });
}

test("events go to Shopify's analytics address as plain text", async () => {
  const calls = [];
  const ok = await sendToShopify(pageViewEvents(fixture.cases.pageView.input), async (url, init) => { calls.push({ url, init }); return new Response(""); });
  assert.equal(ok, true);
  assert.equal(calls[0].url, MONORAIL_URL);
  assert.equal(calls[0].url, fixture.cases.pageView.url);
  assert.equal(calls[0].init.headers["content-type"], "text/plain");
  assert.equal(JSON.parse(calls[0].init.body).events.length, 2);
});

test("a failed send never throws into the page", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(await sendToShopify(pageViewEvents(fixture.cases.pageView.input), async () => { throw new Error("offline"); }), false);
    assert.equal(await sendToShopify(pageViewEvents(fixture.cases.pageView.input), async () => new Response("", { status: 500 })), false);
    assert.equal(await sendToShopify(pageViewEvents(fixture.cases.pageView.input), async () => new Response(JSON.stringify({ result: [{ status: 400, message: "bad" }] }))), false);
  } finally { console.warn = warn; }
});
```

- [ ] **Step 2: Run it to see it fail** — `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/shopify/analytics-events.test.mjs`. Expected: fails, module not found.

- [ ] **Step 3: Write `analytics-events.ts`** — a line-by-line port of hydrogen-react's `analytics.ts`, `analytics-schema-trekkie-storefront-page-view.ts`, `analytics-schema-custom-storefront-customer-tracking.ts`, `analytics-utils.ts` and `buildUUID`, keeping key order (the product entries are JSON strings, so order matters). `sendToShopify` logs and returns `false` instead of throwing. Header comment names the source version and how to regenerate the fixture.

- [ ] **Step 4: Run the test** — expected PASS.

- [ ] **Step 5: Commit** — `feat(kit): Shopify analytics events, copied from hydrogen-react 2026.4.4 and checked against its output`

### Task 2: Customer Privacy API loader

**Files:**
- Create: `src/lib/shopify/privacy.ts`
- Test: `scripts/shopify/privacy.test.mjs`

**Interfaces:**
- Consumes: `ConsentFlags` (type) from Task 1.
- Produces: `CONSENT_API`, `CONSENT_API_WITH_BANNER`, `CustomerPrivacy`, `ShopifyWindow`, `PrivacyOptions { storefrontAccessToken; checkoutDomain; withPrivacyBanner?; country?; locale? }`, `sharedDomain(host, checkoutDomain): string | undefined`, `customerPrivacy(win?)`, `analyticsAllowed(cp)`, `waitingForChoice(cp)`, `consentFlags(cp): ConsentFlags`, `trackingValues(win?, cookie?)`, `loadCustomerPrivacy(options, { onReady, onConsent }, win?, doc?): () => void`.

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const p = await loadSdk("privacy");

function fakePage(host = "shop.example.com") {
  const doc = new EventTarget();
  const scripts = [];
  doc.head = { appendChild: (s) => scripts.push(s) };
  doc.createElement = () => new EventTarget();
  doc.getElementById = (id) => scripts.find((s) => s.id === id) ?? null;
  return { doc, win: { location: { host } }, scripts };
}
const api = (over = {}) => ({
  consentStatus: "loaded",
  calls: [],
  setTrackingConsent(c, cb) { this.calls.push(c); cb?.(); },
  currentVisitorConsent: () => ({ marketing: "", analytics: "", preferences: "", sale_of_data: "" }),
  analyticsProcessingAllowed: () => true, marketingAllowed: () => false, saleOfDataAllowed: () => true, shouldShowBanner: () => false,
  ...over,
});
const options = { storefrontAccessToken: "a".repeat(32), checkoutDomain: "checkout.example.com" };

test("the shared cookie domain needs at least a registrable name in common", () => {
  assert.equal(p.sharedDomain("www.example.com", "checkout.example.com"), "example.com");
  assert.equal(p.sharedDomain("example.com:3000", "checkout.example.com"), "example.com");
  assert.equal(p.sharedDomain("shop.vercel.app", "checkout.example.com"), undefined);
  assert.equal(p.sharedDomain("a.other.com", "checkout.example.com"), undefined);
  assert.equal(p.sharedDomain("localhost:3000", "checkout.example.com"), undefined);
});

test("configures Shopify for a headless site before loading its script, then loads it once", () => {
  const { doc, win, scripts } = fakePage();
  const stop = p.loadCustomerPrivacy(options, { onReady() {}, onConsent() {} }, win, doc);
  assert.deepEqual(
    { ...win.Shopify.customerPrivacy.config },
    { isHeadless: true, asyncConsent: true, asyncVisitorState: true, consentDomain: "shop.example.com", storefrontAccessToken: options.storefrontAccessToken },
  );
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, p.CONSENT_API);
  stop();
  p.loadCustomerPrivacy(options, { onReady() {}, onConsent() {} }, win, doc);
  assert.equal(scripts.length, 1, "a second mount reuses the script");
});

test("loads Shopify's cookie banner when asked", () => {
  const { doc, win, scripts } = fakePage();
  p.loadCustomerPrivacy({ ...options, withPrivacyBanner: true }, { onReady() {}, onConsent() {} }, win, doc);
  assert.equal(scripts[0].src, p.CONSENT_API_WITH_BANNER);
});

test("ready once consent is loaded; every later choice is reported, and consent is set for the site's domain", () => {
  const { doc, win } = fakePage();
  const seen = [];
  p.loadCustomerPrivacy(options, { onReady: () => seen.push("ready"), onConsent: () => seen.push("consent") }, win, doc);
  const cp = Object.assign(win.Shopify.customerPrivacy, api());
  doc.dispatchEvent(new Event("consentTrackingApiLoaded"));
  doc.dispatchEvent(new Event("consentTrackingApiLoaded"));
  doc.dispatchEvent(new Event("visitorConsentCollected"));
  assert.deepEqual(seen, ["ready", "consent"]);
  cp.setTrackingConsent({ analytics: true });
  assert.deepEqual(cp.calls[0], { checkoutRootDomain: "shop.example.com", storefrontRootDomain: ".example.com", storefrontAccessToken: options.storefrontAccessToken, headlessStorefront: true, analytics: true });
});

test("with the banner, ready waits for the banner too", () => {
  const { doc, win } = fakePage();
  const seen = [];
  p.loadCustomerPrivacy({ ...options, withPrivacyBanner: true }, { onReady: () => seen.push("ready"), onConsent() {} }, win, doc);
  Object.assign(win.Shopify.customerPrivacy, api());
  doc.dispatchEvent(new Event("consentTrackingApiLoaded"));
  assert.deepEqual(seen, []);
  win.privacyBanner = { loadBanner() {}, showPreferences() {} };
  doc.dispatchEvent(new Event("consentTrackingApiLoaded"));
  assert.deepEqual(seen, ["ready"]);
});

test("analytics are allowed only once consent is loaded and not refused", () => {
  assert.equal(p.analyticsAllowed(null), false);
  assert.equal(p.analyticsAllowed(api({ consentStatus: "loading" })), false);
  assert.equal(p.analyticsAllowed(api()), true);
  assert.equal(p.analyticsAllowed(api({ currentVisitorConsent: () => ({ analytics: "no" }) })), false);
  assert.equal(p.analyticsAllowed(api({ analyticsProcessingAllowed: () => false })), false);
});

test("a shown banner with no choice yet means wait", () => {
  assert.equal(p.waitingForChoice(api({ shouldShowBanner: () => true })), true);
  assert.equal(p.waitingForChoice(api({ shouldShowBanner: () => true, currentVisitorConsent: () => ({ analytics: "yes" }) })), false);
  assert.equal(p.waitingForChoice(api()), false);
});

test("consent flags as Shopify's events expect them", () => {
  assert.deepEqual(p.consentFlags(api()), { hasUserConsent: true, analyticsAllowed: true, marketingAllowed: false, saleOfDataAllowed: true, ccpaEnforced: false, gdprEnforced: true });
});

test("visitor ids come from the privacy API, the old cookies only without it", () => {
  const win = { Shopify: { customerPrivacy: { config: { asyncConsent: true }, __internal: { uniqueToken: (o) => (o.generateFallback ? "u-api" : ""), visitToken: () => "v-api" } } } };
  assert.deepEqual(p.trackingValues(win, "_shopify_y=u-old; _shopify_s=v-old"), { uniqueToken: "u-api", visitToken: "v-api" });
  assert.deepEqual(p.trackingValues({}, "_shopify_y=u-old; _shopify_s=v-old"), { uniqueToken: "u-old", visitToken: "v-old" });
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write `privacy.ts`** as described in the spec block (Hydrogen's `useCustomerPrivacy`, `getCustomerPrivacy`, `getPrivacyBanner`, `hasAnalyticsConsent`, `shouldWaitForPrivacyBanner`, `getTrackingValues`, without React). `sharedDomain` keeps only a contiguous suffix of 2+ labels (Hydrogen's version can return a bare TLD). The script is added only when none with id `customer-privacy-api` exists; an existing one gets a `load` listener.
- [ ] **Step 4: Run the test** — PASS.
- [ ] **Step 5: Commit** — `feat(kit): load Shopify's Customer Privacy API and cookie banner for a headless site`

### Task 3: Tracker

**Files:**
- Create: `src/lib/shopify/analytics-tracker.ts`
- Test: `scripts/shopify/analytics-tracker.test.mjs`

**Interfaces:**
- Consumes: Task 1 builders and types, Task 2 `customerPrivacy`, `consentFlags`, `waitingForChoice`, `trackingValues`, `CustomerPrivacy`; `Cart`, `CartItemInput` from `types.ts`.
- Produces: `TrackerDeps { send(events); privacy(); browser() }`, `AnalyticsTracker { setShop; ready; consentChanged; page(path); productView(path, products); addToCart(cart, lines) }`, `createAnalyticsTracker(deps?)`, `browserParameters()`.

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { createAnalyticsTracker } = await loadSdk("analytics-tracker");

const shop = { shopId: "gid://shopify/Shop/1", currency: "EUR", acceptedLanguage: "EN" };
const browser = () => ({ uniqueToken: "u", visitToken: "v", url: "https://shop.example.com/x", path: "/x", search: "", referrer: "", title: "T", userAgent: "UA", navigationType: "navigate", navigationApi: "PerformanceNavigationTiming" });
function setup({ allowed = true, banner = false } = {}) {
  const sent = [];
  const consent = { allowed, banner };
  const cp = {
    consentStatus: "loaded",
    currentVisitorConsent: () => ({ analytics: consent.allowed ? "yes" : banner ? "" : "no" }),
    analyticsProcessingAllowed: () => consent.allowed, marketingAllowed: () => false, saleOfDataAllowed: () => true,
    shouldShowBanner: () => consent.banner,
  };
  const t = createAnalyticsTracker({ send: async (e) => sent.push(e), privacy: () => cp, browser });
  return { t, sent, consent, names: () => sent.map((batch) => batch.map((e) => e.payload.event_name ?? e.schema_id)) };
}

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
  t.setShop(shop); t.ready();
  t.page("/a"); t.page("/a"); t.page("/b");
  assert.deepEqual(names(), [["trekkie_storefront_page_view/1.4", "page_rendered"], ["trekkie_storefront_page_view/1.4", "page_rendered"]]);
});

test("without consent nothing goes out; when the visitor accepts, the current page is sent once", () => {
  const { t, sent, consent } = setup({ allowed: false });
  t.setShop(shop); t.ready(); t.page("/a");
  assert.equal(sent.length, 0);
  consent.allowed = true;
  t.consentChanged(); t.consentChanged();
  assert.equal(sent.length, 1);
});

test("a shown banner holds events until the visitor chooses", () => {
  const { t, sent, consent } = setup({ allowed: true, banner: true });
  consent.allowed = false;
  t.setShop(shop); t.ready(); t.page("/a");
  assert.equal(sent.length, 0);
  consent.allowed = true;
  t.consentChanged();
  assert.equal(sent.length, 1);
});

const mug = { productGid: "gid://shopify/Product/11", variantGid: "gid://shopify/ProductVariant/22", name: "Mug", variantName: "Blue", brand: "Acme", price: "12.50", quantity: 1 };

test("a product view registered before its page view goes in the same batch, and the page view says product", () => {
  const { t, sent, names } = setup();
  t.setShop(shop); t.ready();
  t.productView("/products/mug", [mug]);
  t.page("/products/mug");
  assert.deepEqual(names(), [["product_page_rendered", "trekkie_storefront_page_view/1.4", "page_rendered"]]);
  assert.equal(sent[0][1].payload.pageType, "product");
  assert.equal(sent[0][1].payload.resourceId, 11);
});

test("a product view after its page was sent goes alone", () => {
  const { t, names } = setup();
  t.setShop(shop); t.ready(); t.page("/products/mug");
  t.productView("/products/mug", [mug]);
  assert.deepEqual(names(), [["trekkie_storefront_page_view/1.4", "page_rendered"], ["product_page_rendered"]]);
});

test("add to cart reports the added variant from Shopify's cart, with the added quantity", () => {
  const { t, sent } = setup();
  t.setShop(shop); t.ready();
  const cart = { id: "gid://shopify/Cart/c1?key=k", lines: { edges: [{ node: { id: "l1", quantity: 3, merchandise: { id: "gid://shopify/ProductVariant/22", title: "Blue", sku: "MUG-B", price: { amount: "12.5", currencyCode: "EUR" }, product: { id: "gid://shopify/Product/11", title: "Mug", vendor: "Acme", productType: "Kitchen" } } } }] } };
  t.addToCart(cart, [{ merchandiseId: "gid://shopify/ProductVariant/22", quantity: 2 }, { merchandiseId: "gid://shopify/ProductVariant/missing", quantity: 1 }]);
  assert.equal(sent.length, 1);
  const event = sent[0][0].payload;
  assert.equal(event.event_name, "product_added_to_cart");
  assert.equal(event.cart_token, "c1?key=k");
  assert.deepEqual(event.products.map((s) => JSON.parse(s)), [{ product_gid: "gid://shopify/Product/11", name: "Mug", variant: "Blue", brand: "Acme", price: 12.5, quantity: 2, variant_gid: "gid://shopify/ProductVariant/22", category: "Kitchen", sku: "MUG-B", product_id: 11, variant_id: 22 }]);
});

test("add to cart without consent sends nothing", () => {
  const { t, sent } = setup({ allowed: false });
  t.setShop(shop); t.ready();
  t.addToCart({ id: "gid://shopify/Cart/c1", lines: { edges: [] } }, [{ merchandiseId: "x", quantity: 1 }]);
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write `analytics-tracker.ts`**: state `shop`, `isReady`, `current { path, sent }`, `product { path, products }`; `base()` returns null without shop, readiness, privacy API, consent, or while `waitingForChoice`; `flush()` sends the current page (with the product view first and `pageType: "product"`, `resourceId` when one was registered for that path). Sales channel `headless`. `browserParameters()` reads `location`, `document`, `navigator`, `performance` and `trackingValues()`.
- [ ] **Step 4: Run the test** — PASS.
- [ ] **Step 5: Commit** — `feat(kit): analytics tracker sends page, product and add-to-cart events only with consent`

### Task 4: Same-origin Storefront API proxy, shipped by kit-install

**Files:**
- Create: `src/lib/shopify/storefront-proxy.ts`, `src/app/api/[version]/graphql.json/route.ts`
- Modify: `scripts/frontend/kit.mjs` (`ROUTES` gains `"[version]/graphql.json"`; the import rewrite counts the route's depth)
- Test: `scripts/shopify/storefront-proxy.test.mjs`, `scripts/frontend/kit.test.mjs`

**Interfaces:**
- Produces: `forwardStorefrontRequest(request: Request, version: string, options?: { domain?: string; fetch?: typeof fetch }): Promise<Response>`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/shopify/storefront-proxy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { forwardStorefrontRequest } = await loadSdk("storefront-proxy");

function upstream(capture, response = new Response("{}")) {
  return async (url, init) => { capture.push({ url, init }); return response; };
}
const request = (headers = {}, method = "POST") => new Request("https://shop.example.com/api/unstable/graphql.json", { method, headers, body: method === "POST" ? '{"query":"{ shop { id } }"}' : undefined });

test("forwards to the shop's Storefront API with only the headers Shopify accepts", async () => {
  const calls = [];
  await forwardStorefrontRequest(request({ "content-type": "application/json", cookie: "a=1", "x-shopify-storefront-access-token": "tok", "shopify-storefront-consent-management": "1", "x-shopify-visittoken": "v", authorization: "Bearer secret", "x-forwarded-for": "1.2.3.4, 10.0.0.1" }), "unstable", { domain: "shop.myshopify.com", fetch: upstream(calls) });
  assert.equal(calls[0].url, "https://shop.myshopify.com/api/unstable/graphql.json");
  const sent = Object.fromEntries(calls[0].init.headers.entries());
  assert.deepEqual(sent, { "content-type": "application/json", cookie: "a=1", "x-shopify-storefront-access-token": "tok", "shopify-storefront-consent-management": "1", "x-shopify-visittoken": "v", "x-forwarded-for": "1.2.3.4" });
  assert.equal(new TextDecoder().decode(calls[0].init.body), '{"query":"{ shop { id } }"}');
});

test("only Storefront API versions are passed on", async () => {
  const calls = [];
  for (const v of ["2026-07", "unstable"]) assert.notEqual((await forwardStorefrontRequest(request(), v, { domain: "s.myshopify.com", fetch: upstream(calls) })).status, 404);
  for (const v of ["admin", "2026-7", "../x"]) assert.equal((await forwardStorefrontRequest(request(), v, { domain: "s.myshopify.com", fetch: upstream(calls) })).status, 404);
  assert.equal(calls.length, 2);
});

test("keeps Shopify's cookies and drops headers Node's fetch has already acted on", async () => {
  const headers = new Headers([["set-cookie", "_shopify_analytics=1; Path=/"], ["set-cookie", "_shopify_marketing=1; Path=/"], ["content-encoding", "gzip"], ["content-length", "99"], ["server-timing", "x"], ["content-type", "application/json"]]);
  const res = await forwardStorefrontRequest(request(), "unstable", { domain: "s.myshopify.com", fetch: upstream([], new Response("{}", { status: 200, headers })) });
  assert.deepEqual(res.headers.getSetCookie(), ["_shopify_analytics=1; Path=/", "_shopify_marketing=1; Path=/"]);
  for (const h of ["content-encoding", "content-length", "server-timing"]) assert.equal(res.headers.get(h), null);
  assert.equal(res.headers.get("content-type"), "application/json");
});

test("Shopify unreachable is a 502, not a crash", async () => {
  const res = await forwardStorefrontRequest(request(), "unstable", { domain: "s.myshopify.com", fetch: async () => { throw new Error("down"); } });
  assert.equal(res.status, 502);
});
```

Add to `scripts/frontend/kit.test.mjs`:

```js
test("the Storefront API proxy route is installed with its import pointing four levels up", () => {
  for (const appRoot of ["", "src/"]) {
    const plan = planKitInstall({ kitRoot, target: received(appRoot ? { "src/app/page.tsx": "" } : {}), appRoot });
    const route = plan.write.find((w) => w.to === `${appRoot}app/api/[version]/graphql.json/route.ts`);
    assert.ok(route, "proxy route missing");
    assert.match(route.text, /"\.\.\/\.\.\/\.\.\/\.\.\/lib\/shopify\/storefront-proxy"/);
  }
});
```

- [ ] **Step 2: Run both to see them fail.**
- [ ] **Step 3: Write `storefront-proxy.ts`** (header allowlist from Hydrogen's `storefront.forward`; first `x-forwarded-for` hop or `x-real-ip`; body as `ArrayBuffer`; drop `content-encoding`, `content-length`, `transfer-encoding`, `server-timing` from the answer; 404 for other versions; 503 without a configured shop; 502 when the fetch throws), the route file (GET, POST, OPTIONS → `forwardStorefrontRequest(req, (await params).version)`), and in `kit.mjs` compute the import prefix as `"../".repeat(2 + r.split("/").length)`.
- [ ] **Step 4: Run the tests** — PASS; also `pnpm test:scripts`.
- [ ] **Step 5: Commit** — `feat(kit): same-origin Storefront API proxy for Shopify's privacy API, installed by kit-install`

### Task 5: Shop read, cart line fields, React glue

**Files:**
- Modify: `src/lib/shopify/queries.ts` (new `shopAnalyticsQuery`; cart line `product { vendor productType }` and variant `sku`), `types.ts` (`ShopAnalytics`; `CartLineMerchandise.sku?`, `product.vendor?`, `product.productType?`), `index.ts` (`getShopAnalytics`), `cart-store.ts` (`onAdd` option), `cart-provider.tsx` (passes `trackAddToCart`)
- Create: `src/lib/shopify/analytics.tsx` (`ShopifyAnalytics`, `ShopifyProductView`, `trackAddToCart`)
- Test: `scripts/shopify/cart-store.test.mjs`, `scripts/shopify/client-boundary.test.mjs`

**Interfaces:**
- Produces: `ShopAnalytics { shopId; currency; acceptedLanguage; checkoutDomain; storefrontAccessToken }`; `getShopAnalytics(): Promise<ShopAnalytics | null>` (never throws; null with one console error saying why); `createCartStore({ onAdd?: (cart: Cart, lines: CartItemInput[]) => void })`; `<ShopifyAnalytics shop withPrivacyBanner? />`; `<ShopifyProductView product variant />`; `trackAddToCart(cart, lines)`.

- [ ] **Step 1: Failing tests** in `cart-store.test.mjs`:

```js
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
```

and add `"analytics-events.ts", "privacy.ts", "analytics-tracker.ts", "analytics.tsx"` to `BROWSER_SAFE` in `client-boundary.test.mjs`.

- [ ] **Step 2: Run them to see them fail** (boundary test fails on the missing files).
- [ ] **Step 3: Implement**: query `shop { id primaryDomain { host } paymentSettings { currencyCode } } localization { language { isoCode } }`, cached `force-cache`, `revalidate: 86400`, tag `shop`; null without a public token. `cart-store` calls `onAdd` inside a try/catch after the cart comes back. `analytics.tsx` holds one module-level tracker; `ShopifyAnalytics` sets the shop, loads privacy (banner on by default) and reports `usePathname()`; `ShopifyProductView` reports the selected variant.
- [ ] **Step 4: Run** `pnpm test:scripts`, `pnpm shop-setup validate-queries`, `pnpm shop-setup validate-queries --version=2026-10`, `pnpm lint`, `pnpm build`.
- [ ] **Step 5: Commit** — `feat(kit): ShopifyAnalytics component, shop read and add-to-cart reporting`

### Task 6: Wiring, setup step and docs

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/products/[handle]/page.tsx` (or `ProductForm.tsx` where the selected variant lives), `src/context/cart-context.tsx`, `scripts/setup/steps.mjs` (+ test), `docs/frontend-wiring.md`, `.claude/skills/shopify-connect-frontend/SKILL.md`

- [ ] **Step 1:** In `steps.test.mjs` add: the `cookie-consent` step names `ShopifyAnalytics` and Shopify's cookie banner setting; a `live-view` human step needs `hosting` and `cookie-consent`, and `go-live` waits for it. Run, see it fail.
- [ ] **Step 2:** Rewrite the `cookie-consent` instructions (the kit ships it: add `<ShopifyAnalytics shop={await getShopAnalytics()} />` to the root layout and `<ShopifyProductView>` to the product page; the owner turns on Shopify's cookie banner under Settings > Customer privacy; allow `cdn.shopify.com` scripts and `monorail-edge.shopifysvc.com` connections in any content security policy). Add the `live-view` step (open the deployed site, not localhost, in a private window, accept cookies, see the visit in Analytics > Live View within a few minutes). Run, PASS.
- [ ] **Step 3:** Wire the demo: layout renders `<ShopifyAnalytics>`; product page renders `<ShopifyProductView>`; the demo cart context calls `trackAddToCart` after a successful add.
- [ ] **Step 4:** `docs/frontend-wiring.md` gets a "Shopify analytics (Live View)" section (what to add, consent, CSP, proxy route, localhost does not count, how to regenerate the fixture); the connect skill gets one line pointing at it.
- [ ] **Step 5:** `pnpm test:scripts`, `pnpm lint`, `pnpm build`; run the site against mock.shop in the browser pane and check: the privacy script loads, `/api/unstable/graphql.json` answers through the proxy, no console errors. Live View itself stays **unverified** until a deployed real store.
- [ ] **Step 6: Commit** — `feat(kit): wire Shopify analytics into the demo, setup steps and wiring guide`; merge `shopify-analytics` into `main`.
