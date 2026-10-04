import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyShopifyWebhook } from "../../src/lib/shopify/webhook.ts";

const secret = "client-secret";
const body = JSON.stringify({ id: 1, handle: "milano-sofa" });
const sign = (b, s = secret) => createHmac("sha256", s).update(b, "utf8").digest("base64");

test("a correctly signed body is accepted", () => {
  assert.deepEqual(verifyShopifyWebhook(body, sign(body), secret), { ok: true });
});

test("no secret configured refuses everything with 503 instead of accepting unsigned requests", () => {
  const r = verifyShopifyWebhook(body, sign(body), undefined);
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.match(r.reason, /SHOPIFY_WEBHOOK_SECRET/);
  assert.equal(verifyShopifyWebhook(body, null, "").status, 503);
});

test("a missing signature header is a 401", () => {
  assert.equal(verifyShopifyWebhook(body, null, secret).status, 401);
});

test("a body changed after signing, or signed with another secret, is a 401", () => {
  assert.equal(verifyShopifyWebhook(body + " ", sign(body), secret).status, 401);
  assert.equal(verifyShopifyWebhook(body, sign(body, "other"), secret).status, 401);
});

test("a signature of the wrong length does not throw", () => {
  assert.equal(verifyShopifyWebhook(body, "short", secret).status, 401);
});
