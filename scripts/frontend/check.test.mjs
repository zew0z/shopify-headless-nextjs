import test from "node:test";
import assert from "node:assert/strict";
import { checkWiring } from "./check.mjs";
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
});

test("a wired frontend passes every check, even with its old data file still on disk and an uncached cart page", () => {
  const results = checkWiring(makeFixture(WIRED));
  assert.deepEqual(results.filter((r) => !r.ok), []);
  assert.equal(results.length, 6);
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

test("a frontend without the kit fails the first check", () => {
  const r = byWhat(checkWiring(makeFixture({ "package.json": { dependencies: { next: "16" } }, "app/page.tsx": "" })));
  assert.equal(r["The Shopify SDK and /api/cart are installed"].ok, false);
});

test("a layout that switches caching off fails, because every page under it is uncached", () => {
  const r = byWhat(checkWiring(makeFixture({ ...WIRED, "src/app/layout.tsx": `export const fetchCache = "force-no-store";` })));
  assert.deepEqual(r["Pages that show products are cached"].where, ['src/app/layout.tsx:1 fetchCache = "force-no-store"']);
});
