import test from "node:test";
import assert from "node:assert/strict";
import { mintAdminToken, explainTokenError } from "./token.mjs";

const creds = { domain: "shop.myshopify.com", clientId: "id", clientSecret: "secret" };

test("posts the client credentials grant, form-encoded, to the store's token endpoint", async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ access_token: "shpat_abc", scope: "write_products", expires_in: 86399 }), { status: 200 });
  };
  const minted = await mintAdminToken({ ...creds, fetchFn });
  assert.equal(seen.url, "https://shop.myshopify.com/admin/oauth/access_token");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen.init.body)), { grant_type: "client_credentials", client_id: "id", client_secret: "secret" });
  assert.deepEqual(minted, { token: "shpat_abc", scope: "write_products", expiresIn: 86399 });
});

test("a refusal explains the same-organization rule and names the fallback", async () => {
  const fetchFn = async () => new Response('{"error":"shop_not_permitted"}', { status: 400 });
  await assert.rejects(mintAdminToken({ ...creds, fetchFn }), (error) => {
    assert.match(error.message, /HTTP 400/);
    assert.match(error.message, /same Shopify organization/);
    assert.match(error.message, /pnpm shop-setup oauth/);
    return true;
  });
});

test("explainTokenError never prints more than a short slice of the body", () => {
  assert.ok(explainTokenError(500, "x".repeat(5000)).length < 900);
});
