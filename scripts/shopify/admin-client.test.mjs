import test from "node:test";
import assert from "node:assert/strict";
import { SCOPES, missingScopes, collectUserErrors } from "./admin-client.mjs";

test("collectUserErrors finds nested userErrors", () => {
  const data = { a: { userErrors: [{ message: "x" }] }, b: [{ c: { userErrors: [{ message: "y" }] } }] };
  assert.deepEqual(collectUserErrors(data).map((e) => e.message), ["x", "y"]);
});

test("collectUserErrors returns [] for clean data", () => {
  assert.deepEqual(collectUserErrors({ a: { userErrors: [] } }), []);
});

test("a write scope satisfies its read counterpart", () => {
  assert.deepEqual(missingScopes(["write_shipping", "read_locations"], SCOPES.shipping), []);
});

test("missing scopes are reported by name", () => {
  assert.deepEqual(missingScopes(["read_locations"], SCOPES.shipping), ["write_shipping"]);
});

import { mock, beforeEach, afterEach } from "node:test";
import { allScopes, resolveAdminToken, resetTokenCache } from "./admin-client.mjs";

const clearEnv = () => {
  for (const key of ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_APP_CLIENT_ID", "SHOPIFY_APP_CLIENT_SECRET"]) delete process.env[key];
};
beforeEach(() => {
  clearEnv();
  resetTokenCache();
  process.env.SHOPIFY_STORE_DOMAIN = "tok-test";
});
afterEach(() => {
  clearEnv();
  mock.restoreAll();
});

test("allScopes covers shipping, policies, the catalogue push and content definitions", () => {
  const all = allScopes();
  for (const scope of ["write_shipping", "write_legal_policies", "write_products", "write_publications", "write_inventory", "read_locations", "write_metaobject_definitions", "write_metaobjects"]) {
    assert.ok(all.includes(scope), `${scope} missing`);
  }
});

test("an explicit SHOPIFY_ADMIN_TOKEN wins and nothing is minted", async () => {
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_explicit";
  process.env.SHOPIFY_APP_CLIENT_ID = "id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "secret";
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call the network");
  });
  assert.deepEqual(await resolveAdminToken(), { token: "shpat_explicit", source: "SHOPIFY_ADMIN_TOKEN" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("without a token it mints one from the client credentials, once, and reuses it", async () => {
  process.env.SHOPIFY_APP_CLIENT_ID = "id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "secret";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ access_token: "shpat_minted", scope: "x", expires_in: 86399 }), { status: 200 }));
  assert.deepEqual(await resolveAdminToken(), { token: "shpat_minted", source: "client credentials" });
  assert.deepEqual(await resolveAdminToken(), { token: "shpat_minted", source: "client credentials" });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("a token about to expire is minted again", async () => {
  process.env.SHOPIFY_APP_CLIENT_ID = "id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "secret";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ access_token: "shpat_short", scope: "x", expires_in: 30 }), { status: 200 }));
  await resolveAdminToken();
  await resolveAdminToken();
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("with no token and no client credentials it stops with a readable message", async () => {
  mock.method(console, "error", () => {});
  mock.method(process, "exit", (code) => {
    throw new Error(`exit ${code}`);
  });
  await assert.rejects(resolveAdminToken(), /exit 1/);
});
