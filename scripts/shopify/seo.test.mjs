import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const seo = await loadSdk("seo");

test("share images come from Shopify's CDN as JPEG at preview size", () => {
  assert.equal(seo.shareImageUrl("https://cdn.shopify.com/s/files/a.webp?v=1"), "https://cdn.shopify.com/s/files/a.webp?v=1&width=1200&format=jpg");
  assert.equal(seo.shareImageUrl("https://other.example/a.jpg"), "https://other.example/a.jpg");
});

test("descriptions lose their markup and stop at a word", () => {
  assert.equal(seo.plainText("<p>Soft &amp; <b>deep</b> seats</p>"), "Soft & deep seats");
  assert.equal(seo.plainText("one two three four", 9), "one two…");
  assert.equal(seo.plainText(null), "");
});

test("product metadata uses Shopify's SEO fields first, then the product's own", () => {
  const meta = seo.productMetadata(
    { title: "Milano", description: "A deep three-seat sofa.", featuredImage: { url: "https://cdn.shopify.com/m.jpg", altText: "Milano in grey", width: 2000, height: 1500 }, seo: { title: null, description: null } },
    { path: "/products/milano", shopName: "Shop" }
  );
  assert.equal(meta.title, "Milano | Shop");
  assert.equal(meta.description, "A deep three-seat sofa.");
  assert.equal(meta.alternates.canonical, "/products/milano");
  assert.deepEqual(meta.openGraph.images, [{ url: "https://cdn.shopify.com/m.jpg?width=1200&format=jpg", alt: "Milano in grey" }]);
  assert.equal(meta.twitter.card, "summary_large_image");
  const own = seo.productMetadata({ title: "Milano", description: "", featuredImage: null, seo: { title: "Milano sofa", description: "Buy it" } }, { path: "/p", shopName: "Shop" });
  assert.equal(own.title, "Milano sofa | Shop");
  assert.equal(own.openGraph.images, undefined);
  assert.equal(own.twitter.card, "summary");
});
