import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-test-token";
const sdk = await loadSdk();

const img = (url) => ({ url, altText: null, width: 10, height: 10 });
const field = (key, value, reference = null) => ({ key, value, reference, references: null });
const entry = (handle, fields, updatedAt = "2026-01-01T00:00:00Z") => ({ handle, updatedAt, fields });
const product = { __typename: "Product", handle: "milano", title: "Milano", featuredImage: img("https://cdn.shopify.com/m.jpg") };

let sent;
function answer(nodes) {
  globalThis.fetch = async (_u, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: { metaobjects: { nodes } } }), { status: 200 });
  };
}

test("reviews keep only real ones: a name, a text and a whole rating from 1 to 5", async () => {
  answer([
    entry("r1", [field("author", "Maria"), field("rating", "5"), field("body", "Great sofa"), field("date", "2026-03-02"), field("product", "gid://p/1", product)]),
    entry("r2", [field("author", "Nikos"), field("rating", "7"), field("body", "x")]),
    entry("r3", [field("author", ""), field("rating", "4"), field("body", "x")]),
    entry("r4", [field("author", "Eleni"), field("rating", "4"), field("body", "Good"), field("date", "2026-05-01")]),
  ]);
  const reviews = await sdk.getReviews();
  assert.equal(sent.variables.type, "customer_review");
  assert.deepEqual(reviews.map((r) => r.handle), ["r4", "r1"]);
  assert.deepEqual(reviews[1], { handle: "r1", author: "Maria", rating: 5, body: "Great sofa", location: null, date: "2026-03-02", product: { handle: "milano", title: "Milano", featuredImage: img("https://cdn.shopify.com/m.jpg") } });
});

test("reviews for one product, and their summary", async () => {
  answer([
    entry("r1", [field("author", "Maria"), field("rating", "5"), field("body", "a"), field("product", "gid://p/1", product)]),
    entry("r2", [field("author", "Eleni"), field("rating", "4"), field("body", "b")]),
    entry("r3", [field("author", "Kostas"), field("rating", "4"), field("body", "c"), field("product", "gid://p/1", product)]),
  ]);
  const reviews = await sdk.getReviews({ product: "milano" });
  assert.deepEqual(reviews.map((r) => r.handle).sort(), ["r1", "r3"]);
  assert.deepEqual(sdk.reviewSummary(reviews), { count: 2, average: 4.5 });
  assert.deepEqual(sdk.reviewSummary([]), { count: 0, average: null });
});

test("hero slides: own words and picture first, the product's as fallback, in the owner's order", async () => {
  answer([
    entry("b", [field("rank", "2"), field("product", "gid://p/1", product)]),
    entry("a", [field("rank", "1"), field("title", "Summer sale"), field("subtitle", "Up to the owner"), field("image", "gid://i/1", { __typename: "MediaImage", image: img("https://cdn.shopify.com/hero.jpg") }), field("link", "/collections/sale")]),
    entry("c", [field("title", "No picture at all")]),
    entry("d", [field("product", "gid://p/1", product)]),
  ]);
  const slides = await sdk.getHeroSlides();
  assert.equal(sent.variables.type, "hero_slide");
  assert.deepEqual(slides.map((s) => s.handle), ["a", "b", "d"]);
  assert.deepEqual(slides[0], { handle: "a", title: "Summer sale", subtitle: "Up to the owner", image: img("https://cdn.shopify.com/hero.jpg"), href: "/collections/sale", product: null });
  assert.equal(slides[1].title, "Milano");
  assert.equal(slides[1].image.url, "https://cdn.shopify.com/m.jpg");
  assert.equal(slides[1].href, null);
});

test("a type the shop never defined is an empty list", async () => {
  answer([]);
  assert.deepEqual(await sdk.getMetaobjects("anything"), []);
});

test("entries are content: cached for an hour under the content tag", async () => {
  let init;
  globalThis.fetch = async (_u, i) => { init = i; return new Response(JSON.stringify({ data: { metaobjects: { nodes: [] } } }), { status: 200 }); };
  await sdk.getMetaobjects("hero_slide");
  assert.equal(init.cache, "force-cache");
  assert.deepEqual(init.next.tags, ["content"]);
});

test("referenced entries (a swatch list) come back with their fields", async () => {
  answer([entry("x", [{ key: "colors", value: "[\"gid://e/1\"]", reference: null, references: { nodes: [{ __typename: "Metaobject", handle: "grey", fields: [{ key: "label", value: "Grey" }, { key: "hex", value: "#888" }] }] } }])]);
  const [x] = await sdk.getMetaobjects("anything");
  assert.deepEqual(x.fields.colors.entries, [{ handle: "grey", fields: { label: "Grey", hex: "#888" } }]);
});
