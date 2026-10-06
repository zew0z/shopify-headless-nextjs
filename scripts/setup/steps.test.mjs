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
    for (const n of byId[id].needs) {
      if (seen.has(n)) continue;
      seen.add(n);
      walk(n);
    }
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

test("catalogue and inventory name the commands that do them", () => {
  assert.equal(byId.catalogue.automation, "catalogue");
  assert.match(byId.catalogue.instructions, /pnpm shop-setup catalogue-build/);
  assert.match(byId.catalogue.instructions, /catalogue-verify/);
  assert.equal(byId.inventory.automation, "inventory-check");
});

test("the SDK query check needs no credentials, starts immediately, and go-live waits for it", () => {
  assert.equal(byId["sdk-queries"].owner, "api");
  assert.deepEqual(byId["sdk-queries"].needs, []);
  assert.equal(byId["sdk-queries"].automation, "validate-queries");
  assert.match(byId["sdk-queries"].instructions, /pnpm shop-setup validate-queries/);
  assert.ok(byId["go-live"].needs.includes("sdk-queries"));
});

test("the admin connection steps name the commands, and the scopes cover every step that writes", () => {
  assert.match(byId.oauth.instructions, /pnpm shop-setup token/);
  assert.match(byId.oauth.instructions, /pnpm shop-setup oauth/);
  assert.equal(byId.webhooks.automation, "webhooks");
  assert.match(byId.webhooks.instructions, /pnpm shop-setup webhooks/);
  for (const scope of ["write_shipping", "write_legal_policies", "write_products", "write_publications", "write_inventory", "read_locations"]) {
    assert.match(byId["dev-app"].instructions, new RegExp(scope), `dev-app must list ${scope}`);
  }
});

test("a received frontend is audited, gets the kit, is wired and checked, in that order", () => {
  const chain = ["frontend-audit", "kit-install", "frontend-catalogue", "frontend-cart", "frontend-check"];
  for (const id of chain) assert.equal(byId[id]?.owner, "code", `${id} must exist and be agent code work`);
  for (let i = 1; i < chain.length; i++) assert.ok(byId[chain[i]].needs.includes(chain[i - 1]), `${chain[i]} must need ${chain[i - 1]}`);
  assert.equal(byId["frontend-audit"].automation, "frontend-audit");
  assert.equal(byId["kit-install"].automation, "kit-install");
  assert.equal(byId["frontend-check"].automation, "frontend-check");
  assert.ok(byId["frontend-check"].needs.includes("headless-channel"), "the check needs a store to show real products");
  assert.match(byId["frontend-check"].instructions, /pnpm build/);
});

test("an unwired frontend is never deployed", () => {
  assert.ok(byId.hosting.needs.includes("frontend-check"));
});

test("every automation names a command the CLI has", async () => {
  const { readFileSync } = await import("node:fs");
  const cli = readFileSync(new URL("./cli.mjs", import.meta.url), "utf8");
  const commands = new Set([...cli.matchAll(/case "([\w-]+)":/g)].map((m) => m[1]));
  for (const s of STEPS) if (s.automation) assert.ok(commands.has(s.automation), `${s.id} names unknown command ${s.automation}`);
});
