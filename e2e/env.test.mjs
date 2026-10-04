import test from "node:test";
import assert from "node:assert/strict";
import { checkoutHost, isOnHost } from "./env.mjs";

test("checkoutHost joins subdomain and site domain", () => {
  assert.equal(checkoutHost({ checkoutSubdomain: "checkout", siteDomain: "example.gr" }), "checkout.example.gr");
});

test("isOnHost matches the exact hostname only", () => {
  assert.equal(isOnHost("https://checkout.example.gr/checkouts/cn/abc", "checkout.example.gr"), true);
  assert.equal(isOnHost("https://shop.myshopify.com/checkouts/cn/abc", "checkout.example.gr"), false);
  assert.equal(isOnHost("https://checkout.example.gr.evil.com/", "checkout.example.gr"), false);
  assert.equal(isOnHost("not a url", "checkout.example.gr"), false);
});
