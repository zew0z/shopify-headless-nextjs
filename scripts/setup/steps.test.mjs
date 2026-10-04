import test from "node:test";
import assert from "node:assert/strict";
import { STEPS } from "./steps.mjs";
import { validateSteps } from "./engine.mjs";

test("registry is internally consistent", () => {
  assert.deepEqual(validateSteps(STEPS), []);
});

test("every step explains itself and every browser step has a human fallback", () => {
  for (const s of STEPS) {
    assert.ok(s.instructions.length > 20, `${s.id} needs instructions`);
    if (s.owner === "browser") assert.ok(/If the browser is unavailable/.test(s.instructions), `${s.id} needs a fallback`);
  }
});

test("money cannot be taken before tax, shipping, domain, emails and a browser run exist", () => {
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));
  const required = ["tax-inclusive", "shipping", "payments", "invoicing", "e2e", "theme-redirect", "email-templates-install", "email-sender"];
  for (const need of required) {
    assert.ok(byId["test-order"].needs.includes(need), `test-order must need ${need}`);
  }
});

const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));

test("the core setup and the shop connection are still there", () => {
  const core = [
    "intake", "store-basics", "tax-inclusive", "headless-channel", "dev-app", "oauth", "preflight", "shipping",
    "policies-draft", "policies-approve", "checkout-domain", "e2e", "theme-redirect", "email-templates-generate",
    "email-templates-install", "email-sender", "payments", "invoicing", "webhooks", "test-order", "rotate-secrets",
  ];
  for (const id of core) assert.ok(byId[id], `core step ${id} is missing`);
  // the path to the Admin API is intact: channel + app + install + scope check come before any write
  for (const writer of ["shipping", "policies-draft", "catalogue", "inventory", "webhooks"]) {
    assert.ok(byId[writer].needs.includes("preflight") || byId[writer].needs.includes("catalogue"), `${writer} must sit behind preflight`);
  }
  assert.deepEqual(byId.preflight.needs, ["oauth"]);
  assert.deepEqual(byId.oauth.needs, ["dev-app"]);
});

test("owners are only api, browser, code or human", () => {
  for (const s of STEPS) assert.ok(["api", "browser", "code", "human"].includes(s.owner), `${s.id} has owner ${s.owner}`);
});

test("go-live transitively waits for everything a shop needs", () => {
  const seen = new Set();
  const walk = (id) => {
    for (const n of byId[id].needs) if (!seen.has(n)) (seen.add(n), walk(n));
  };
  walk("go-live");
  const needed = [
    "intake", "store-basics", "tax-inclusive", "shipping", "payments", "invoicing", "e2e", "theme-redirect",
    "email-templates-install", "email-sender", "policies-approve", "legal-details", "catalogue", "inventory",
    "cod-payment", "courier", "withdrawal-button", "cookie-consent", "hosting", "customer-accounts",
    "staff-alerts", "languages", "eu-vat", "search-console", "test-order", "rotate-secrets",
  ];
  for (const id of needed) assert.ok(seen.has(id), `go-live must wait for ${id}`);
});

test("webhooks and the browser run need a deployed site", () => {
  assert.ok(byId.webhooks.needs.includes("hosting"));
  assert.ok(byId.e2e.needs.includes("hosting"));
});
