import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "fixture.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "test-public";
const { shopifyFetch } = await loadSdk("client");
for (const [name, respond] of [
  ["HTTP 429", () => new Response("unavailable", { status: 429 })],
  ["HTTP 503", () => new Response("unavailable", { status: 503 })],
  ["GraphQL THROTTLED", () => Response.json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] })],
]) test(`Next transport never replays a cart mutation after ${name}`, async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return respond(); };
  try {
    await assert.rejects(shopifyFetch({ query: "mutation CartWrite { cartCreate { cart { id } } }", cache: "no-store", retries: 1 }));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("Next transport still retries an unavailable read", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return calls === 1 ? new Response("unavailable", { status: 503, headers: { "retry-after": "0" } }) : Response.json({ data: { shop: { id: "1" } } }); };
  try {
    assert.equal((await shopifyFetch({ query: "query Read { shop { id } }", cache: "no-store", retries: 1 })).body.data.shop.id, "1");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
