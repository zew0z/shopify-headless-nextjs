import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { forwardStorefrontRequest } = await loadSdk("storefront-proxy");

const upstream = (calls, response = new Response("{}")) => async (url, init) => {
  calls.push({ url, init });
  return response;
};
const request = (headers = {}, method = "POST") =>
  new Request("https://shop.example.com/api/unstable/graphql.json", { method, headers, body: method === "POST" ? '{"query":"{ shop { id } }"}' : undefined });

test("forwards to the shop's Storefront API with only the headers Shopify accepts", async () => {
  const calls = [];
  await forwardStorefrontRequest(
    request({
      "content-type": "application/json",
      cookie: "a=1",
      "x-shopify-storefront-access-token": "tok",
      "shopify-storefront-consent-management": "1",
      "x-shopify-visittoken": "v",
      authorization: "Bearer secret",
      "x-forwarded-for": "1.2.3.4, 10.0.0.1",
    }),
    "unstable",
    { domain: "shop.myshopify.com", fetch: upstream(calls) }
  );
  assert.equal(calls[0].url, "https://shop.myshopify.com/api/unstable/graphql.json");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(Object.fromEntries(calls[0].init.headers.entries()), {
    "content-type": "application/json",
    cookie: "a=1",
    "x-shopify-storefront-access-token": "tok",
    "shopify-storefront-consent-management": "1",
    "x-shopify-visittoken": "v",
    "x-forwarded-for": "1.2.3.4",
  });
  assert.equal(new TextDecoder().decode(calls[0].init.body), '{"query":"{ shop { id } }"}');
});

test("only Storefront API versions are passed on", async () => {
  const calls = [];
  for (const v of ["2026-07", "unstable"]) {
    assert.notEqual((await forwardStorefrontRequest(request(), v, { domain: "s.myshopify.com", fetch: upstream(calls) })).status, 404);
  }
  for (const v of ["admin", "2026-7", "../x"]) {
    assert.equal((await forwardStorefrontRequest(request(), v, { domain: "s.myshopify.com", fetch: upstream(calls) })).status, 404);
  }
  assert.equal(calls.length, 2);
});

test("keeps Shopify's cookies and drops headers Node's fetch has already acted on", async () => {
  const headers = new Headers([
    ["set-cookie", "_shopify_analytics=1; Path=/"],
    ["set-cookie", "_shopify_marketing=1; Path=/"],
    ["content-encoding", "gzip"],
    ["content-length", "99"],
    ["server-timing", "x"],
    ["content-type", "application/json"],
  ]);
  const res = await forwardStorefrontRequest(request(), "unstable", { domain: "s.myshopify.com", fetch: upstream([], new Response("{}", { status: 200, headers })) });
  assert.deepEqual(res.headers.getSetCookie(), ["_shopify_analytics=1; Path=/", "_shopify_marketing=1; Path=/"]);
  for (const h of ["content-encoding", "content-length", "server-timing"]) assert.equal(res.headers.get(h), null);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(await res.text(), "{}");
});

test("Shopify unreachable is a 502, not a crash", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    const res = await forwardStorefrontRequest(request(), "unstable", { domain: "s.myshopify.com", fetch: async () => { throw new Error("down"); } });
    assert.equal(res.status, 502);
  } finally {
    console.error = error;
  }
});

test("no shop configured is a 503", async () => {
  const res = await forwardStorefrontRequest(request(), "unstable", { domain: "", fetch: upstream([]) });
  assert.equal(res.status, 503);
});
