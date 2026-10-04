import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv, normalizeDomain, shopifyEnv, mask } from "./env.mjs";

test("parseEnv strips quotes and ignores comments", () => {
  const env = parseEnv('# c\nA="x y"\nB=\'z\'\n  C = 3 \nnot a line');
  assert.deepEqual(env, { A: "x y", B: "z", C: "3" });
});

test("normalizeDomain accepts bare name, url and trailing slash", () => {
  assert.equal(normalizeDomain("my-store"), "my-store.myshopify.com");
  assert.equal(normalizeDomain("https://my-store.myshopify.com/"), "my-store.myshopify.com");
  assert.equal(normalizeDomain(undefined), "");
});

test("shopifyEnv accepts NEXT_PUBLIC_ names used by this repo", () => {
  const e = shopifyEnv({
    NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "shop",
    NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: "pub",
    SHOPIFY_STOREFRONT_API_VERSION: "2025-01",
  });
  assert.equal(e.domain, "shop.myshopify.com");
  assert.equal(e.storefrontToken, "pub");
  assert.equal(e.apiVersion, "2025-01");
});

test("shopifyEnv prefers the un-prefixed name when both are set", () => {
  const e = shopifyEnv({ SHOPIFY_STORE_DOMAIN: "a", NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "b" });
  assert.equal(e.domain, "a.myshopify.com");
});

test("mask never prints a whole token", () => {
  assert.equal(mask(""), "-");
  assert.ok(!mask("shpat_abcdefghijklmnop").includes("abcdefghijkl"));
});
