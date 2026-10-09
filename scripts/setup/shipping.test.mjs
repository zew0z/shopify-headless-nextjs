import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyShipping, buildZone, findCountryCollisions } from "./shipping.mjs";

afterEach(() => mock.restoreAll());

const config = {
  currency: "EUR",
  shippingCountries: ["GR"],
  freeShippingThreshold: 500,
  shippingRates: [
    { name: "Standard", price: 5.9, maxWeightKg: 30 },
    { name: "Heavy delivery", price: 29, minWeightKg: 30 },
  ],
};

test("zone covers the configured countries entirely", () => {
  assert.deepEqual(buildZone(config).countries, [{ code: "GR", includeAllProvinces: true }]);
});

test("free shipping is a real rule at the threshold, in the shop currency", () => {
  const free = buildZone(config).methodDefinitionsToCreate.find((m) => m.name === "Free shipping");
  assert.equal(free.rateDefinition.price.amount, "0.00");
  assert.deepEqual(free.priceConditionsToCreate, [
    { operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { amount: "500.00", currencyCode: "EUR" } },
  ]);
});

test("paid rates stop just below the threshold so both options never show together", () => {
  const std = buildZone(config).methodDefinitionsToCreate.find((m) => m.name === "Standard");
  assert.equal(std.rateDefinition.price.amount, "5.90");
  assert.deepEqual(std.priceConditionsToCreate, [
    { operator: "LESS_THAN_OR_EQUAL_TO", criteria: { amount: "499.99", currencyCode: "EUR" } },
  ]);
});

test("weight bounds become weight conditions in kilograms", () => {
  const methods = buildZone(config).methodDefinitionsToCreate;
  assert.deepEqual(methods.find((m) => m.name === "Standard").weightConditionsToCreate, [
    { operator: "LESS_THAN_OR_EQUAL_TO", criteria: { value: 30, unit: "KILOGRAMS" } },
  ]);
  assert.deepEqual(methods.find((m) => m.name === "Heavy delivery").weightConditionsToCreate, [
    { operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { value: 30, unit: "KILOGRAMS" } },
  ]);
});

test("no threshold means no free rule and no price cap", () => {
  const methods = buildZone({ ...config, freeShippingThreshold: null }).methodDefinitionsToCreate;
  assert.equal(methods.some((m) => m.name === "Free shipping"), false);
  assert.equal(methods[0].priceConditionsToCreate, undefined);
});

test("collisions are reported so the applier can refuse instead of duplicating", () => {
  const profile = {
    profileLocationGroups: [
      { locationGroupZones: { nodes: [{ zone: { name: "Domestic", countries: [{ code: { countryCode: "GR" } }] } }] } },
    ],
  };
  assert.deepEqual(findCountryCollisions(profile, ["GR", "CY"]), [{ zone: "Domestic", country: "GR" }]);
  assert.deepEqual(findCountryCollisions(profile, ["CY"]), []);
});

test("a dry run with no store prints the zone offline and calls nothing", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call Shopify");
  });
  mock.method(console, "log", () => {});
  const phoneRate = { currency: "EUR", shippingCountries: ["GR"], freeShippingThreshold: 2000, shippingRates: [{ name: "Delivery cost agreed by phone", price: 0 }] };
  const result = await applyShipping({ config: phoneRate, dryRun: true, env: { domain: "" } });
  assert.equal(result.offline, true);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(result.zone.methodDefinitionsToCreate[0].name, "Delivery cost agreed by phone");
  assert.equal(result.zone.methodDefinitionsToCreate[0].rateDefinition.price.amount, "0.00");
  const printed = console.log.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.match(printed, /no SHOPIFY_STORE_DOMAIN: not checked against the store's existing zones and locations/);
  assert.match(printed, /dry run, nothing written/);
});

test("without --dry-run a missing store is never treated as offline", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call Shopify");
  });
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
  mock.method(process, "exit", (code) => {
    throw new Error(`exit ${code}`);
  });
  // With no store the Admin client exits; if the machine has one configured, the fake fetch refuses. Either way nothing "offline" comes back.
  await assert.rejects(applyShipping({ config, dryRun: false, env: { domain: "" } }), /exit 1|must not call Shopify/);
});
