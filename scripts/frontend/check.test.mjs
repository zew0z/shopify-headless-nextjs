import test from "node:test";
import assert from "node:assert/strict";
import { checkWiring, smokeSite } from "./check.mjs";
import { readFileSync } from "node:fs";
import { makeFixture } from "../test-support/fixture.mjs";

const KIT = {
  "package.json": { name: "received", dependencies: { next: "16.2.0" } },
  "src/lib/shopify/index.ts": "export async function getProducts() { return []; }",
  "src/app/api/cart/route.ts": `import { createCart } from "../../../lib/shopify";`,
  "src/data/products.ts": `export const products = [{ title: "A", price: 1 }, { title: "B", price: 2 }];`,
};

const UNWIRED = {
  ...KIT,
  "next.config.ts": `export default {};`,
  "src/app/page.tsx": `import { products } from "@/data/products";
import { getProducts } from "@/lib/shopify";
export const dynamic = "force-dynamic";
export default async function Home() { const live = await getProducts(); return null; }`,
  "src/components/Grid.tsx": `const res = await fetch("/api/products");`,
  "src/components/Cart.tsx": `export const Cart = () => <a href="/checkout">Checkout</a>;`,
  "src/components/Price.tsx": `export const Price = ({ p }) => <span>€{p}</span>;`,
  "src/data/navigation.ts": `export const navigation = [{ label: "Shop", href: "/shop" }, { label: "About", href: "/about" }];`,
  "src/app/layout.tsx": `import { navigation } from "@/data/navigation";
export default function Layout({ children }) { return <nav>{navigation.length}{children}</nav>; }`,
  "src/components/Card.tsx": `export const Card = ({ p }) => <span>{p.rating}</span>;
const sample = { title: "A", rating: 4.5 };`,
  "src/components/Pay.tsx": `export const Pay = () => <input name="cardNumber" autoComplete="cc-number" />;`,
};

const WIRED = {
  ...KIT,
  "next.config.ts": `export default { images: { remotePatterns: [{ hostname: "cdn.shopify.com" }] } };`,
  "src/app/page.tsx": `import { getProducts } from "@/lib/shopify";
import { toCard } from "@/lib/shopify-adapter";
export default async function Home() { const products = (await getProducts()).map(toCard); return null; }`,
  "src/app/cart/page.tsx": `export const dynamic = "force-dynamic";`,
  "src/context/cart.tsx": `const res = await fetch("/api/cart", { method: "POST", body: JSON.stringify({ action: "add" }) });
const go = (cart) => { window.location.href = cart.checkoutUrl; };`,
};

// The kit's own SDK files, as kit-install copies them into a received frontend.
const KIT_SDK = Object.fromEntries(
  ["cart-client.ts", "cart-provider.tsx", "cart-store.ts", "types.ts", "index.ts"].map((f) => [
    `src/lib/shopify/${f}`,
    readFileSync(new URL(`../../src/lib/shopify/${f}`, import.meta.url), "utf8"),
  ])
);

const byWhat = (results) => Object.fromEntries(results.map((r) => [r.what, r]));

test("a frontend still on its own data fails every wiring check, with places", () => {
  const r = byWhat(checkWiring(makeFixture(UNWIRED)));
  assert.equal(r["The Shopify SDK and /api/cart are installed"].ok, true);
  assert.equal(r["No page or component imports the hardcoded products"].ok, false);
  assert.deepEqual(r["No page or component imports the hardcoded products"].where, ["src/app/page.tsx:1 imports src/data/products.ts"]);
  assert.deepEqual(r["No fake product APIs are called"].where, ["src/components/Grid.tsx:1 /api/products"]);
  assert.deepEqual(r["Pages that show products are cached"].where, ['src/app/page.tsx:3 dynamic = "force-dynamic"']);
  assert.equal(r["Shopify images are allowed"].ok, false);
  assert.equal(r["The cart talks to Shopify and checkout uses Shopify's checkoutUrl"].ok, false);
  assert.deepEqual(r["Prices use the currency Shopify returns, not a hardcoded symbol"].where, ["src/components/Price.tsx:1 €{"]);
});

test("a frontend with hardcoded menus, invented ratings and a card form fails the three new checks, with places", () => {
  const r = byWhat(checkWiring(makeFixture(UNWIRED)));
  assert.deepEqual(r["No page or component imports hardcoded menus, policies, pages or store claims"].where, ["src/data/navigation.ts:1 menu"]);
  assert.deepEqual(r["No invented ratings, reviews, stock or badges"].where, ["src/components/Card.tsx:2 rating"]);
  assert.deepEqual(r["No payment form: Shopify's checkout takes the payment"].where, ['src/components/Pay.tsx:1 name="cardNumber"']);
});

test("an unused menu file and an unused type declaration do not fail, but an unused file under components does", () => {
  const r = byWhat(
    checkWiring(
      makeFixture({
        ...WIRED,
        "src/data/navigation.ts": `export const navigation = [{ label: "Shop", href: "/shop" }];`,
        "src/types/product.ts": `export type Product = { title: string; rating?: number };`,
      })
    )
  );
  assert.deepEqual(r["No page or component imports hardcoded menus, policies, pages or store claims"].where, []);
  assert.deepEqual(r["No invented ratings, reviews, stock or badges"].where, []);
  const imported = byWhat(
    checkWiring(
      makeFixture({
        ...WIRED,
        "src/types/product.ts": `export type Product = { title: string; rating?: number };`,
        "src/app/page.tsx": `import type { Product } from "@/types/product";`,
      })
    )
  );
  assert.deepEqual(imported["No invented ratings, reviews, stock or badges"].where, ["src/types/product.ts:1 rating"]);
});

test("a wired frontend passes every check, even with its old data file still on disk and an uncached cart page", () => {
  const results = checkWiring(makeFixture(WIRED));
  assert.deepEqual(results.filter((r) => !r.ok), []);
  assert.equal(results.length, 10);
});

test("with the kit's own files installed, a cart that never calls Shopify still fails the cart check", () => {
  const files = { ...WIRED, ...KIT_SDK, "src/context/cart.tsx": `export const useCart = () => ({ add: () => {} });` };
  delete files["src/app/cart/page.tsx"];
  const r = byWhat(checkWiring(makeFixture(files)));
  assert.deepEqual(r["The cart talks to Shopify and checkout uses Shopify's checkoutUrl"].where, ["nothing calls /api/cart", "nothing uses cart.checkoutUrl"]);
});

test("with the kit's own files installed, a component using the kit's cart provider passes the cart check", () => {
  const r = byWhat(
    checkWiring(
      makeFixture({
        ...WIRED,
        ...KIT_SDK,
        "src/context/cart.tsx": `export const none = 1;`,
        "src/components/Bag.tsx": `import { useCart } from "@/lib/shopify/cart-provider";
export const Bag = () => { const { checkout } = useCart(); return <button onClick={() => checkout()}>Pay</button>; };`,
      })
    )
  );
  assert.deepEqual(r["The cart talks to Shopify and checkout uses Shopify's checkoutUrl"].where, []);
});

test("the kit's own files do not trip the other checks", () => {
  const results = checkWiring(makeFixture({ ...WIRED, ...KIT_SDK }));
  assert.deepEqual(results.filter((r) => !r.ok), []);
});

test("a cart wired through the kit's cartAction, as the wiring guide shows, talks to Shopify", () => {
  const r = byWhat(
    checkWiring(
      makeFixture({
        ...WIRED,
        "src/context/cart.tsx": `import { cartAction } from "@/lib/shopify/cart-client";
const add = (lines) => cartAction({ action: "create", lines });
const go = (cart) => { window.location.href = cart.checkoutUrl; };`,
      })
    )
  );
  assert.deepEqual(r["The cart talks to Shopify and checkout uses Shopify's checkoutUrl"].where, []);
});

test("a cart wired through the kit's cart provider passes the checkout check without naming checkoutUrl", () => {
  const r = byWhat(
    checkWiring(
      makeFixture({
        ...WIRED,
        "src/context/cart.tsx": `import { useCart } from "../lib/shopify/cart-provider";
export const Go = () => { const { checkout } = useCart(); return <button onClick={() => checkout()}>Pay</button>; };`,
      })
    )
  );
  assert.deepEqual(r["The cart talks to Shopify and checkout uses Shopify's checkoutUrl"].where, []);
});

test("an old product data file with prices in it is left to the hardcoded-products check", () => {
  const r = byWhat(checkWiring(makeFixture({ ...WIRED, "src/data/products.ts": `export const products = [{ title: "A", price: "€1" }, { title: "B", price: "€2" }];` })));
  assert.deepEqual(r["Prices use the currency Shopify returns, not a hardcoded symbol"].where, []);
});

test("a frontend without the kit fails the first check", () => {
  const r = byWhat(checkWiring(makeFixture({ "package.json": { dependencies: { next: "16" } }, "app/page.tsx": "" })));
  assert.equal(r["The Shopify SDK and /api/cart are installed"].ok, false);
});

test("a layout that switches caching off fails, because every page under it is uncached", () => {
  const r = byWhat(checkWiring(makeFixture({ ...WIRED, "src/app/layout.tsx": `export const fetchCache = "force-no-store";` })));
  assert.deepEqual(r["Pages that show products are cached"].where, ['src/app/layout.tsx:1 fetchCache = "force-no-store"']);
});

test("a page wired with the paged or content reads is checked for uncached settings too", () => {
  for (const call of ["getProductsPage", "getCollectionProductsPage", "searchProducts", "getShop", "getMenu", "getPolicies", "getPolicy", "getPage"]) {
    const page = `import { ${call} } from "@/lib/shopify";
export const dynamic = "force-dynamic";
export default async function P() { await ${call}({}); return null; }`;
    const r = byWhat(checkWiring(makeFixture({ ...WIRED, "src/app/page.tsx": page })));
    assert.deepEqual(r["Pages that show products are cached"].where, ['src/app/page.tsx:2 dynamic = "force-dynamic"'], call);
  }
});

test("smokeSite passes when the home page and a product page show Shopify images", async () => {
  const pages = {
    "http://x/": '<a href="/products/slides">x</a><img src="https://cdn.shopify.com/a.jpg">',
    "http://x/products/slides": '<img src="https://cdn.shopify.com/b.jpg">',
  };
  const fetchFn = async (u) => new Response(pages[u] ?? "missing", { status: pages[u] ? 200 : 404 });
  assert.ok((await smokeSite("http://x", fetchFn)).every((r) => r.ok));
  assert.ok((await smokeSite("http://x/", fetchFn)).every((r) => r.ok));
});

test("smokeSite fails when the page has no Shopify image", async () => {
  const fetchFn = async () => new Response('<a href="/products/a">a</a><img src="https://images.unsplash.com/a.jpg">', { status: 200 });
  assert.ok((await smokeSite("http://x", fetchFn)).some((r) => !r.ok));
});

test("smokeSite fails when the home page has no product link", async () => {
  const fetchFn = async () => new Response('<img src="https://cdn.shopify.com/a.jpg">', { status: 200 });
  const results = await smokeSite("http://x", fetchFn);
  assert.ok(results.some((r) => !r.ok && r.what.includes("product")));
  assert.ok(results.some((r) => r.where.some((w) => w.includes("no product link on the home page"))));
});

test("smokeSite reports a network error as a failing result", async () => {
  const fetchFn = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  const results = await smokeSite("http://x", fetchFn);
  assert.equal(results.length > 0 && results.every((r) => !r.ok), true);
  assert.ok(results[0].where.join(" ").includes("ECONNREFUSED"));
});
