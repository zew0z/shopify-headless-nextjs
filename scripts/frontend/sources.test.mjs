import test from "node:test";
import assert from "node:assert/strict";
import { listSourceFiles } from "./walk.mjs";
import { findFakeApis, findImporters, findInventedFields, findPaymentForms, findProductData, findSiteData } from "./sources.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

const PRODUCTS_TS = `import type { Product } from "@/types";

// shop data
export const products: Product[] = [
  { id: "1", title: "Linen shirt", price: 49, image: "/a.jpg", sizes: ["S", "M"] },
  { id: "2", title: "Wool coat", price: 180, image: "/b.jpg", variants: [{ title: "S", price: 180 }, { title: "M", price: 180 }] },
  { id: "3", name: "Canvas bag", price: { amount: 25 }, image: "/c.jpg" },
];
`;

function scan(files) {
  const dir = makeFixture(files);
  const list = listSourceFiles(dir);
  return { dir, list, data: findProductData(dir, list), apis: findFakeApis(dir, list) };
}

test("a hardcoded product array is found once, with its count and line, and its nested variants are not counted again", () => {
  const { data } = scan({ "src/data/products.ts": PRODUCTS_TS });
  assert.deepEqual(data, [{ file: "src/data/products.ts", line: 4, kind: "array", count: 3 }]);
});

test("a single object array and a nav-link array are not product data", () => {
  const { data } = scan({
    "src/data/one.ts": `export const featured = [{ title: "Only", price: 10 }];`,
    "src/components/Nav.tsx": `const links = [{ label: "Shop", href: "/shop" }, { label: "About", href: "/about" }];`,
  });
  assert.deepEqual(data, []);
});

test("a products.json file is product data, plain or wrapped in an object", () => {
  const { data } = scan({
    "data/products.json": [{ name: "A", price: 1 }, { name: "B", price: 2 }],
    "data/catalog.json": { products: [{ title: "A", amount: 1 }, { title: "B", amount: 2 }, { title: "C", amount: 3 }] },
    "package.json": { name: "x", dependencies: { next: "16" } },
  });
  assert.deepEqual(
    data.map(({ file, kind, count }) => ({ file, kind, count })),
    [
      { file: "data/catalog.json", kind: "json", count: 3 },
      { file: "data/products.json", kind: "json", count: 2 },
    ]
  );
});

test("strings, comments and type annotations do not confuse the bracket matching", () => {
  const { data } = scan({
    "src/data/p.ts": `// [ not an array
const note = "a ] in a string";
const t: string[] = [];
export const list = [
  { title: "A [x]", price: 1 }, /* ] */
  { title: \`B \${note}]\`, price: 2 },
];`,
  });
  assert.deepEqual(data.map((d) => [d.line, d.count]), [[4, 2]]);
});

test("fetches of product data and of known mock hosts are fake APIs; the cart is not", () => {
  const { apis } = scan({
    "src/app/page.tsx": `const res = await fetch("/api/products");\nconst all = await fetch(\`\${BASE}/catalog/items\`);`,
    "src/lib/api.ts": `export const get = () => fetch('https://fakestoreapi.com/carts/5');\nexport const x = axios.get("https://dummyjson.com/users");`,
    "src/components/Cart.tsx": `await fetch("/api/cart", { method: "POST" });\nawait fetch("/api/newsletter");`,
  });
  assert.deepEqual(
    apis.map(({ file, line, kind, target }) => ({ file, line, kind, target })),
    [
      { file: "src/app/page.tsx", line: 1, kind: "fetch", target: "/api/products" },
      { file: "src/app/page.tsx", line: 2, kind: "fetch", target: "${BASE}/catalog/items" },
      { file: "src/lib/api.ts", line: 1, kind: "fetch", target: "https://fakestoreapi.com/carts/5" },
      { file: "src/lib/api.ts", line: 2, kind: "fetch", target: "https://dummyjson.com/users" },
    ]
  );
});

test("an API route that serves the hardcoded products is a fake API", () => {
  const { data, apis } = scan({
    "src/data/products.ts": PRODUCTS_TS,
    "src/app/api/products/route.ts": `import { products } from "@/data/products";\nexport async function GET() { return Response.json(products); }`,
    "src/app/api/contact/route.ts": `export async function POST() { return Response.json({ ok: true }); }`,
  });
  assert.equal(data.length, 1);
  assert.deepEqual(apis, [{ file: "src/app/api/products/route.ts", line: 1, kind: "route", target: "src/data/products.ts" }]);
});

test("the kit's own files, dependencies and build output are never scanned", () => {
  const { list } = scan({
    "src/lib/shopify/mock-data.ts": PRODUCTS_TS,
    "scripts/catalogue/x.mjs": "",
    "e2e/a.spec.mjs": "",
    "node_modules/x/index.js": "",
    ".next/server/page.js": "",
    "public/data.json": "[]",
    "src/types.d.ts": "",
    "tsconfig.json": "{}",
    "store-setup.config.example.json": { shippingRates: [{ name: "Standard", price: 5.9 }, { name: "Heavy", price: 29 }] },
    "store-setup.config.json": "{}",
    "store-setup.state.json": "{}",
    "frontend-audit.json": "{}",
    "playwright.config.mjs": "",
    "src/app/page.tsx": "",
  });
  assert.deepEqual(list, ["src/app/page.tsx"]);
});

test("a Shopify-backed route and the calls to it are not fake APIs", () => {
  const dir = makeFixture({
    "src/app/api/products/route.ts": 'import { getProductsPage } from "@/lib/shopify";\nexport async function GET() {}\n',
    "src/components/LoadMore.tsx": 'fetch("/api/products?page=2")\n',
    "src/components/Old.tsx": 'fetch("https://fakestoreapi.com/products")\n',
  });
  const files = ["src/app/api/products/route.ts", "src/components/LoadMore.tsx", "src/components/Old.tsx"];
  assert.deepEqual(findFakeApis(dir, files, []).map((a) => a.file), ["src/components/Old.tsx"]);
});

test("importers: every import on a line counts, with aliases, relative paths and dynamic imports", () => {
  const dir = makeFixture({
    "src/a.ts": 'import { x } from "@/data/one"; import { y } from "./two"; const z = import("../src/data/three");\n',
    "src/data/one.ts": "export const x = [];\n",
    "src/two.ts": "export const y = [];\n",
    "src/data/three.ts": "export const t = [];\n",
    "src/data/lonely.ts": "export const l = [];\n",
  });
  const importers = findImporters(dir, listSourceFiles(dir));
  assert.deepEqual(importers.get("src/data/one.ts"), ["src/a.ts"]);
  assert.deepEqual(importers.get("src/two.ts"), ["src/a.ts"]);
  assert.deepEqual(importers.get("src/data/three.ts"), ["src/a.ts"]);
  assert.deepEqual(importers.get("src/data/lonely.ts"), []);
});

test("site data: exported menus, long text and claims are found; components that only render links are not", () => {
  const dir = makeFixture({
    "src/data/nav.ts": 'export const links = [{ label: "A", href: "/a" }];\n',
    "src/content/about.ts": `export const about = { body: "${"y".repeat(250)}" };\n`,
    "src/lib/site.ts": 'export const site = { announcement: "Free shipping" };\n',
    "src/data/types.ts": "export type Link = { href: string };\n",
    "src/components/Footer.tsx": 'export const Footer = () => <a href="/a">A</a>;\n',
    "src/data/products.ts": 'export const products = [{ title: "A", price: 1 }, { title: "B", price: 2 }];\n',
  });
  const files = listSourceFiles(dir);
  const found = findSiteData(dir, files, findProductData(dir, files));
  const byFile = Object.fromEntries(found.map((s) => [s.file, s]));
  assert.deepEqual(Object.keys(byFile).sort(), ["src/content/about.ts", "src/data/nav.ts", "src/lib/site.ts"]);
  assert.match(byFile["src/data/nav.ts"].what, /menu/);
  assert.match(byFile["src/content/about.ts"].what, /policy or page text/);
  assert.match(byFile["src/lib/site.ts"].what, /store claim/);
  assert.equal(byFile["src/data/nav.ts"].line, 1);
});

test("invented fields are reported once per file at their first line, and not in tests", () => {
  const dir = makeFixture({
    "src/types.ts": "export type P = {\n  title: string;\n  rating?: number;\n  reviewCount: number;\n};\nconst a = { rating: 5 };\n",
    "src/Card.tsx": 'const n = open ? rating : 0;\n<Stars rating={4} />\n',
    "src/Card.test.tsx": "const a = { rating: 5 };\n",
  });
  const found = findInventedFields(dir, listSourceFiles(dir));
  assert.deepEqual(found, [
    { file: "src/types.ts", line: 3, what: "rating" },
    { file: "src/types.ts", line: 4, what: "reviewCount" },
  ]);
});

test("card inputs are found by name, id, placeholder or autocomplete", () => {
  const dir = makeFixture({
    "src/Pay.tsx": '<input id="cvc" />\n<input autoComplete="cc-exp" />\n<input placeholder="Card number" />\n<input name="email" />\n',
  });
  const found = findPaymentForms(dir, listSourceFiles(dir));
  assert.deepEqual(found.map((f) => f.line), [1, 2, 3]);
});
