import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { menuLinks } = await loadSdk("menu");
const item = (title, url, items = []) => ({ id: title, title, url, type: "HTTP", resourceId: null, items });
const menu = { id: "m", title: "Main", items: [
  item("Men", "https://demostore.hydrogen.mock.shop/collections/men"),
  item("News", "https://demostore.hydrogen.mock.shop/blogs/news"),
  item("Instagram", "https://instagram.com/shop"),
  item("Help", "https://shop.example.com/pages/help?x=1", [item("Refunds", "https://shop.example.com/policies/refund-policy")]),
] };
const hosts = ["demostore.hydrogen.mock.shop", "shop.example.com"];

test("links on the shop's own domains become paths; others stay external", () => {
  const { links } = menuLinks(menu, { hosts });
  assert.deepEqual(links.map((l) => [l.href, l.external]), [
    ["/collections/men", false], ["/blogs/news", false], ["https://instagram.com/shop", true], ["/pages/help?x=1", false],
  ]);
  assert.equal(links[3].items[0].href, "/policies/refund-policy");
});

test("internal links the frontend has no route for are dropped and listed", () => {
  const { links, dropped } = menuLinks(menu, { hosts, routes: [/^\/collections\//, /^\/pages\//, /^\/policies\//] });
  assert.deepEqual(dropped.map((l) => l.title), ["News"]);
  assert.deepEqual(links.map((l) => l.title), ["Men", "Instagram", "Help"]);
});

test("no menu gives no links", () => {
  assert.deepEqual(menuLinks(null, { hosts }), { links: [], dropped: [] });
});

// The real menu query asks for three levels and the third level has no `items` key.
const leaf = (title, url) => ({ id: title, title, url, type: "HTTP", resourceId: null });
const threeLevel = { id: "m", title: "Main", items: [
  { ...leaf("Shop", "https://shop.example.com/collections/all"), items: [
    { ...leaf("Men", "https://shop.example.com/collections/men"), items: [leaf("Shirts", "https://shop.example.com/collections/shirts")] },
  ] },
] };

test("a three-level menu from the real query does not crash and keeps the deepest level", () => {
  const { links } = menuLinks(threeLevel, { hosts });
  assert.equal(links[0].items[0].items[0].href, "/collections/shirts");
  assert.deepEqual(links[0].items[0].items[0].items, []);
});

test("routable children of a dropped parent move up to the parent's place", () => {
  const nested = { id: "m", title: "Main", items: [
    item("First", "https://shop.example.com/collections/first"),
    item("Blog", "https://shop.example.com/blogs/news", [
      item("Help", "https://shop.example.com/pages/help"),
      item("Archive", "https://shop.example.com/blogs/archive"),
    ]),
    item("Last", "https://shop.example.com/collections/last"),
  ] };
  const { links, dropped } = menuLinks(nested, { hosts, routes: [/^\/collections\//, /^\/pages\//] });
  assert.deepEqual(links.map((l) => l.title), ["First", "Help", "Last"]);
  assert.deepEqual(dropped.map((l) => l.title).sort(), ["Archive", "Blog"]);
});
