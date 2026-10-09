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

/** An entry as toEntry returns it, for the pure mappers. */
const mapped = (handle, fields) => ({
  handle,
  updatedAt: "2026-10-09T00:00:00Z",
  fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v, image: null, product: null, collection: null, entries: [] }])),
});

test("a shop profile needs a business name; lists come from JSON; a bank needs an IBAN", () => {
  const p = sdk.toStoreProfile(mapped("main", {
    legal_name: "Shop Ltd", phones: '["210 1","694 2"]', opening_hours: '["Mon-Fri 9-5"]', founded_year: "2004", bank_iban: null, bank_beneficiary: "X",
  }));
  assert.deepEqual(p, { legalName: "Shop Ltd", address: null, phones: ["210 1", "694 2"], email: null, openingHours: ["Mon-Fri 9-5"], mapUrl: null, foundedYear: 2004, deliveryNote: null, priceNote: null, bank: null });
  assert.equal(sdk.toStoreProfile(mapped("x", { address: "Street" })), null);
  assert.deepEqual(sdk.toStoreProfile(mapped("main", { legal_name: "S", phones: "not json" })).phones, []);
  assert.deepEqual(sdk.toStoreProfile(mapped("main", { legal_name: "S", phones: '["", " 210 3 ", 5]' })).phones, ["210 3"]);
  assert.equal(sdk.toStoreProfile(mapped("main", { legal_name: "S", founded_year: "19.5" })).foundedYear, null);
  assert.deepEqual(sdk.toStoreProfile(mapped("main", { legal_name: "S", bank_iban: "GR00 TEST" })).bank, { beneficiary: null, iban: "GR00 TEST" });
});

test("FAQ items need a question and an answer, and follow the owner's order", () => {
  const items = sdk.toFaqItems([
    mapped("b", { question: "B?", answer: "b", rank: "2" }),
    mapped("a", { question: "A?", answer: "a", rank: "1" }),
    mapped("c", { question: "C?", answer: null }),
    mapped("d", { question: "D?", answer: "d" }),
  ]);
  assert.deepEqual(items, [{ handle: "a", question: "A?", answer: "a" }, { handle: "b", question: "B?", answer: "b" }, { handle: "d", question: "D?", answer: "d" }]);
});

test("getStoreProfile reads the newest store_profile entry, or null when there is none or it has no business name", async () => {
  answer([]);
  assert.equal(await sdk.getStoreProfile(), null);
  assert.equal(sent.variables.type, "store_profile");
  assert.equal(sent.variables.first, 1);

  answer([entry("main", [field("legal_name", "  "), field("address", "Street 1")])]);
  assert.equal(await sdk.getStoreProfile(), null);

  answer([entry("main", [field("legal_name", "Shop Ltd"), field("phones", '["210 1"]'), field("map_url", "https://maps.example/x"), field("price_note", "VAT included")])]);
  const profile = await sdk.getStoreProfile();
  assert.equal(profile.legalName, "Shop Ltd");
  assert.deepEqual(profile.phones, ["210 1"]);
  assert.equal(profile.mapUrl, "https://maps.example/x");
  assert.equal(profile.priceNote, "VAT included");
  assert.equal(profile.address, null);
});

test("getFaq reads faq_item entries in the owner's order, and is empty when there are none", async () => {
  answer([]);
  assert.deepEqual(await sdk.getFaq(), []);
  assert.equal(sent.variables.type, "faq_item");
  assert.equal(sent.variables.first, 100);

  answer([
    entry("later", [field("question", "Later?"), field("answer", "Yes")]),
    entry("first", [field("question", "First?"), field("answer", "Yes"), field("rank", "1")]),
    entry("blank", [field("question", "No answer?"), field("answer", "")]),
  ]);
  assert.deepEqual((await sdk.getFaq()).map((f) => f.handle), ["first", "later"]);
});

test("the shop details and FAQ reads throw when Shopify fails", async () => {
  globalThis.fetch = async () => new Response("down", { status: 500 });
  await assert.rejects(sdk.getStoreProfile(), sdk.ShopifyError);
  await assert.rejects(sdk.getFaq(), sdk.ShopifyError);
});

test("entries are asked for most recently saved first, so a long list never drops the newest", async () => {
  answer([]);
  await sdk.getMetaobjects("customer_review", { first: 250 });
  assert.match(sent.query, /sortKey:\s*"updated_at"/);
  assert.match(sent.query, /reverse:\s*true/);
});
