import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "./intake.mjs";

const answers = {
  profile: "gr",
  siteDomain: "example.gr",
  tracksInventory: false,
  freeShippingThreshold: 500,
  shippingRates: [{ name: "Standard", price: 5.9 }],
  compareAtIsReal: false,
  wantsReviews: false,
};

const without = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

test("greece profile fills the market defaults and reports what it assumed", () => {
  const r = validateConfig(answers);
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.config.currency, "EUR");
  assert.equal(r.config.pricesIncludeTax, true);
  assert.deepEqual(r.config.shippingCountries, ["GR"]);
  assert.equal(r.config.invoicing, "app");
  assert.equal(r.config.checkoutSubdomain, "checkout");
  assert.deepEqual(r.assumed.sort(), ["checkoutSubdomain", "currency", "invoicing", "pricesIncludeTax", "shippingCountries"]);
});

test("siteDomain is required and must be a bare hostname, not a URL", () => {
  const rest = without(answers, "siteDomain");
  assert.match(validateConfig(rest).errors.join("\n"), /siteDomain/);
  assert.match(validateConfig({ ...answers, siteDomain: "https://example.gr/" }).errors.join("\n"), /siteDomain/);
  assert.equal(validateConfig({ ...answers, siteDomain: "shop.example.gr" }).ok, true);
});

test("checkoutSubdomain must be a single DNS label", () => {
  assert.match(validateConfig({ ...answers, checkoutSubdomain: "a.b" }).errors.join("\n"), /checkoutSubdomain/);
  assert.equal(validateConfig({ ...answers, checkoutSubdomain: "pay" }).ok, true);
});

test("business decisions have no defaults and must be answered", () => {
  const rest = without(answers, "tracksInventory");
  const r = validateConfig(rest);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /tracksInventory/);
});

test("freeShippingThreshold may be an explicit null but not absent", () => {
  assert.equal(validateConfig({ ...answers, freeShippingThreshold: null }).ok, true);
  const rest = without(answers, "freeShippingThreshold");
  assert.equal(validateConfig(rest).ok, false);
});

test("rejects a negative price and inverted weight bounds", () => {
  const bad = validateConfig({
    ...answers,
    shippingRates: [{ name: "x", price: -1 }, { name: "y", price: 1, minWeightKg: 10, maxWeightKg: 5 }],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join("\n"), /price/);
  assert.match(bad.errors.join("\n"), /weight/);
});

test("unknown profile is an error", () => {
  assert.match(validateConfig({ ...answers, profile: "zz" }).errors.join("\n"), /profile/);
});
