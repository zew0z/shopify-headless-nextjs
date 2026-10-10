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

test("Next timeout covers a hanging response body, with bounded read retries and no mutation replay", async () => {
  const { shopifyConfig } = await loadSdk("config");
  const originalFetch = globalThis.fetch;
  const timeout = shopifyConfig.timeoutMs;
  const delay = shopifyConfig.retryDelayMs;
  shopifyConfig.timeoutMs = 10;
  shopifyConfig.retryDelayMs = 0;
  try {
    for (const mutation of [false, true]) {
      let calls = 0;
      globalThis.fetch = async (_url, { signal }) => {
        calls++;
        return { ok: true, status: 200, headers: new Headers(), json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("body aborted"), { name: "AbortError" })), { once: true })) };
      };
      let guard;
      try {
        await assert.rejects(Promise.race([shopifyFetch({ query: mutation ? "mutation Write { cartCreate { cart { id } } }" : "query Read { shop { id } }", cache: "no-store", retries: 1 }), new Promise((_resolve, reject) => { guard = setTimeout(() => reject(new Error("body timeout did not fire")), 1000); })]), (error) => !error.message.includes("did not fire"));
      } finally { clearTimeout(guard); }
      assert.equal(calls, mutation ? 1 : 2);
    }
  } finally { globalThis.fetch = originalFetch; shopifyConfig.timeoutMs = timeout; shopifyConfig.retryDelayMs = delay; }
});
