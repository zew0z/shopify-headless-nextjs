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
  currentVisitorConsent: () => ({ marketing: "", analytics: "yes", preferences: "", sale_of_data: "" }),
  analyticsProcessingAllowed: () => true,
  marketingAllowed: () => false,
  saleOfDataAllowed: () => true,
  shouldShowBanner: () => false,
  ...over,
});
const options = { storefrontAccessToken: "a".repeat(32), checkoutDomain: "checkout.example.com" };
const quiet = { onReady() {}, onConsent() {} };

test("the shared cookie domain needs at least a registrable name in common", () => {
  assert.equal(p.sharedDomain("www.example.com", "checkout.example.com"), "example.com");
  assert.equal(p.sharedDomain("example.com:3000", "checkout.example.com"), "example.com");
  assert.equal(p.sharedDomain("shop.vercel.app", "checkout.example.com"), undefined);
  assert.equal(p.sharedDomain("a.other.com", "checkout.example.com"), undefined);
  assert.equal(p.sharedDomain("localhost:3000", "checkout.example.com"), undefined);
});

test("configures Shopify for a headless site before loading its script, then loads it once", () => {
  const { doc, win, scripts } = fakePage();
  const stop = p.loadCustomerPrivacy(options, quiet, win, doc);
  assert.deepEqual(
    { ...win.Shopify.customerPrivacy.config },
    { isHeadless: true, asyncConsent: true, asyncVisitorState: true, consentDomain: "shop.example.com", storefrontAccessToken: options.storefrontAccessToken }
  );
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, p.CONSENT_API);
  stop();
  p.loadCustomerPrivacy(options, quiet, win, doc);
  assert.equal(scripts.length, 1, "a second mount reuses the script");
});

test("loads Shopify's cookie banner when asked", () => {
  const { doc, win, scripts } = fakePage();
  p.loadCustomerPrivacy({ ...options, withPrivacyBanner: true }, quiet, win, doc);
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
  assert.deepEqual(cp.calls[0], {
    checkoutRootDomain: "shop.example.com",
    storefrontRootDomain: ".example.com",
    storefrontAccessToken: options.storefrontAccessToken,
    headlessStorefront: true,
    analytics: true,
  });
});

test("after stopping, nothing more is reported", () => {
  const { doc, win } = fakePage();
  const seen = [];
  const stop = p.loadCustomerPrivacy(options, { onReady: () => seen.push("ready"), onConsent: () => seen.push("consent") }, win, doc);
  stop();
  Object.assign(win.Shopify.customerPrivacy, api());
  doc.dispatchEvent(new Event("consentTrackingApiLoaded"));
  doc.dispatchEvent(new Event("visitorConsentCollected"));
  assert.deepEqual(seen, []);
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

test("analytics require an explicit saved yes even in regions that allow processing without a banner", () => {
  assert.equal(p.analyticsAllowed(null), false);
  assert.equal(p.analyticsAllowed(api({ consentStatus: "loading" })), false);
  assert.equal(p.analyticsAllowed(api()), true);
  assert.equal(p.analyticsAllowed(api({ currentVisitorConsent: () => ({ analytics: "" }) })), false);
  assert.equal(p.analyticsAllowed(api({ currentVisitorConsent: () => ({ analytics: "no" }) })), false);
  assert.equal(p.analyticsAllowed(api({ analyticsProcessingAllowed: () => false })), false);
});

test("a shown banner with no choice yet means wait", () => {
  assert.equal(p.waitingForChoice(api({ shouldShowBanner: () => true, currentVisitorConsent: () => ({ analytics: "" }) })), true);
  assert.equal(p.waitingForChoice(api({ shouldShowBanner: () => true, currentVisitorConsent: () => ({ analytics: "yes" }) })), false);
  assert.equal(p.waitingForChoice(api()), false);
});

test("consent flags as Shopify's events expect them", () => {
  assert.deepEqual(p.consentFlags(api()), {
    hasUserConsent: true,
    analyticsAllowed: true,
    marketingAllowed: false,
    saleOfDataAllowed: true,
    ccpaEnforced: false,
    gdprEnforced: true,
  });
});

test("visitor ids come from the privacy API, the old cookies only without it", () => {
  const win = {
    Shopify: { customerPrivacy: { config: { asyncConsent: true }, __internal: { uniqueToken: (o) => (o.generateFallback ? "u-api" : ""), visitToken: () => "v-api" } } },
  };
  assert.deepEqual(p.trackingValues(win, "_shopify_y=u-old; _shopify_s=v-old"), { uniqueToken: "u-api", visitToken: "v-api" });
  assert.deepEqual(p.trackingValues({}, "_shopify_y=u-old; _shopify_s=v-old"), { uniqueToken: "u-old", visitToken: "v-old" });
});
