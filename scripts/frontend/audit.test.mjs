import test from "node:test";
import assert from "node:assert/strict";
import { listSourceFiles } from "./walk.mjs";
import { auditFrontend, checkImages, findCachingOff, findCart, summariseAudit } from "./audit.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

const scan = (files, fn) => {
  const dir = makeFixture(files);
  return fn(dir, listSourceFiles(dir));
};

test("a cart context, its localStorage and the checkout button are found", () => {
  const cart = scan(
    {
      "src/context/CartContext.tsx": `"use client";
import { createContext, useState } from "react";
export const CartContext = createContext(null);
export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  useEffect(() => localStorage.setItem("shop-cart", JSON.stringify(items)), [items]);
}`,
      "src/components/CartDrawer.tsx": `export function CartDrawer() {
  return <div><button onClick={() => router.push("/checkout")}>
    Proceed to Checkout
  </button><a aria-label="Go to checkout" href="/checkout">→</a></div>;
}`,
      "src/components/Footer.tsx": `export const Footer = () => <footer>Secure shopping</footer>;`,
    },
    findCart
  );
  assert.deepEqual(cart.files, [
    { file: "src/context/CartContext.tsx", line: 3, why: "cart context" },
    { file: "src/context/CartContext.tsx", line: 6, why: "cart kept in localStorage" },
  ]);
  assert.deepEqual(cart.checkoutButtons, [
    { file: "src/components/CartDrawer.tsx", line: 3, text: "Proceed to Checkout" },
    { file: "src/components/CartDrawer.tsx", line: 4, text: "Go to checkout" },
  ]);
});

test("Greek checkout labels are checkout buttons", () => {
  const cart = scan({ "app/cart/page.tsx": `<button>Ολοκλήρωση παραγγελίας</button>\n<Link href="/x">Ταμείο</Link>` }, findCart);
  assert.deepEqual(cart.checkoutButtons.map((b) => b.text), ["Ολοκλήρωση παραγγελίας", "Ταμείο"]);
});

test("everything that switches caching off is found, and imports alone are not", () => {
  const off = scan(
    {
      "src/app/page.tsx": `export const dynamic = "force-dynamic";\nexport const revalidate = 0;`,
      "src/app/layout.tsx": `export const fetchCache = 'default-no-store';`,
      "src/lib/data.ts": `import { unstable_noStore as noStore } from "next/cache";\nnoStore();\nawait fetch(url, { cache: "no-store" });\nawait connection();`,
      "src/app/shop/page.tsx": `export const revalidate = 60;\nexport const dynamic = "auto";`,
    },
    findCachingOff
  );
  assert.deepEqual(off, [
    { file: "src/app/layout.tsx", line: 1, what: 'fetchCache = "default-no-store"' },
    { file: "src/app/page.tsx", line: 1, what: 'dynamic = "force-dynamic"' },
    { file: "src/app/page.tsx", line: 2, what: "revalidate = 0" },
    { file: "src/lib/data.ts", line: 2, what: "noStore()" },
    { file: "src/lib/data.ts", line: 3, what: 'cache: "no-store"' },
    { file: "src/lib/data.ts", line: 4, what: "connection()" },
  ]);
});

test("images need cdn.shopify.com allowed, or optimisation off", () => {
  assert.equal(checkImages(makeFixture({ "next.config.ts": `images: { remotePatterns: [{ hostname: "cdn.shopify.com" }] }` })).ok, true);
  assert.equal(checkImages(makeFixture({ "next.config.mjs": `images: { unoptimized: true }` })).ok, true);
  const missing = checkImages(makeFixture({ "next.config.js": `module.exports = { images: { remotePatterns: [{ hostname: "images.unsplash.com" }] } }` }));
  assert.equal(missing.ok, false);
  assert.match(missing.note, /cdn\.shopify\.com/);
  assert.equal(checkImages(makeFixture({ "package.json": "{}" })).ok, false);
});

const RECEIVED = {
  "package.json": { name: "received", dependencies: { next: "16.2.0", react: "19.2.0" } },
  "next.config.ts": `export default { images: { remotePatterns: [{ hostname: "images.unsplash.com" }] } };`,
  "src/data/products.ts": `export const products = [
  { id: 1, title: "A", price: 10 }, { id: 2, title: "B", price: 20 },
  { id: 3, title: "C", price: 30 }, { id: 4, title: "D", price: 40 },
];`,
  "src/app/page.tsx": `import { products } from "@/data/products";\nexport const dynamic = "force-dynamic";\nexport default function Home() { return null; }`,
  "src/context/cart.tsx": `export const CartContext = createContext(null);\nlocalStorage.getItem("cart");`,
  "src/components/Cart.tsx": `export const Cart = () => <button>Checkout</button>;`,
};

test("a typical received frontend is described in one audit", () => {
  const audit = auditFrontend(makeFixture(RECEIVED));
  assert.equal(audit.stack.supported, true);
  assert.equal(audit.stack.appRoot, "src/");
  assert.deepEqual(audit.productData, [{ file: "src/data/products.ts", line: 1, kind: "array", count: 4 }]);
  assert.deepEqual(audit.fakeApis, []);
  assert.deepEqual(audit.dataReaders, [{ file: "src/app/page.tsx", line: 1, target: "src/data/products.ts" }]);
  assert.equal(audit.cart.files.length, 2);
  assert.equal(audit.cart.checkoutButtons.length, 1);
  assert.deepEqual(audit.cachingOff, [{ file: "src/app/page.tsx", line: 2, what: 'dynamic = "force-dynamic"' }]);
  assert.equal(audit.images.ok, false);
});

test("the summary leads with whether the kit fits and gives counts with places", () => {
  const lines = summariseAudit(auditFrontend(makeFixture(RECEIVED)));
  assert.match(lines[0], /^Kit fits: Next\.js 16/);
  assert.ok(lines.some((l) => /4 hardcoded products in 1 place/.test(l)));
  assert.ok(lines.some((l) => l.includes("src/data/products.ts:1")));
  assert.ok(lines.some((l) => /read by src\/app\/page\.tsx:1/.test(l)), "the summary must say which files read the products");
  const stopped = summariseAudit(auditFrontend(makeFixture({ "package.json": { devDependencies: { vite: "7" } } })));
  assert.match(stopped[0], /^Stop: Built with vite/);
});

test("sentences that mention checkout are not buttons; short labels are", () => {
  const cart = scan(
    {
      "src/app/page.tsx": `<p>Fast pages, real-time cart state and direct checkout redirection.</p>\n<button>Proceed to Shopify Checkout</button>`,
    },
    findCart
  );
  assert.deepEqual(cart.checkoutButtons.map((b) => b.text), ["Proceed to Shopify Checkout"]);
});

test("a cart kept in localStorage is reported once per file, at its first use", () => {
  const cart = scan(
    { "src/context/cart.tsx": `localStorage.getItem(CART_KEY);\nlocalStorage.setItem(CART_KEY, x);\nlocalStorage.removeItem(CART_KEY);` },
    findCart
  );
  assert.deepEqual(cart.files, [{ file: "src/context/cart.tsx", line: 1, why: "cart kept in localStorage" }]);
});

test("the kit's own API routes are not part of the received frontend's audit, its other routes are", () => {
  const audit = auditFrontend(
    makeFixture({
      ...RECEIVED,
      "src/app/api/health/route.ts": `import { checkShopifyConnection } from "../../../lib/shopify";\nexport const dynamic = "force-dynamic";`,
      "src/app/api/search/route.ts": `export const dynamic = "force-dynamic";\nexport async function GET() {}`,
    })
  );
  assert.deepEqual(
    audit.cachingOff.map((c) => c.file),
    ["src/app/api/search/route.ts", "src/app/page.tsx"]
  );
});
