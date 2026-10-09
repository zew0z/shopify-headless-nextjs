import test from "node:test";
import assert from "node:assert/strict";
import { listSourceFiles } from "./walk.mjs";
import { findFakeApis, findImporters, findInventedFields, findPaymentChoices, findPaymentForms, findProductData, findShopifyClients, findSiteData } from "./sources.mjs";
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

test("invented fields are reported once per file at their first typed-in value, and not in tests", () => {
  const dir = makeFixture({
    "src/types.ts": "export type P = {\n  title: string;\n  rating?: number;\n  reviewCount: number;\n};\nconst a = { rating: 5 };\nconst b = { rating: 4, reviewCount: 12 };\n",
    "src/Card.tsx": 'const n = open ? rating : 0;\n<Stars rating={4} />\n',
    "src/Card.test.tsx": "const a = { rating: 5 };\n",
  });
  const found = findInventedFields(dir, listSourceFiles(dir));
  assert.deepEqual(found, [
    { file: "src/types.ts", line: 6, what: "rating" },
    { file: "src/types.ts", line: 7, what: "reviewCount" },
  ]);
});

test("an invented field counts only when it holds a literal, not a type or an expression", () => {
  const dir = makeFixture({
    "src/types.ts": "export type P = {\n  rating: number;\n  stockLeft?: number\n};\n",
    "src/load.ts": "const p = { reviews: getReviews(), badge: product.badge };\n",
    "src/data.ts": 'const a = { rating: 4.8 };\nconst b = { reviews: [{ author: "A" }] };\nconst c = { badge: "Sale", subscribable: true };\n',
  });
  const found = findInventedFields(dir, listSourceFiles(dir)).map((f) => `${f.file}:${f.line} ${f.what}`);
  assert.deepEqual(found, ["src/data.ts:1 rating", "src/data.ts:2 reviews", "src/data.ts:3 badge", "src/data.ts:3 subscribable"]);
});

test("every literal key on a line counts, nested ones too; a field already seen and an expression on the same line do not", () => {
  const dir = makeFixture({
    "src/data.ts": [
      'const a = { badge: "New", rating: 5, reviewCount: 3 };',
      "const b = { rating: 4, stockLeft: count, reviewCount: 9 };",
      'const c = { reviews: [{ author: "A", rating: 5 }], subscribable: plan.on };',
      "const d = {stockLeft:{ total: 2 }};",
    ].join("\n"),
  });
  const found = findInventedFields(dir, listSourceFiles(dir)).map((f) => `${f.line} ${f.what}`);
  assert.deepEqual(found, ["1 badge", "1 rating", "1 reviewCount", "3 reviews", "4 stockLeft"]);
});

test("an existing Shopify client is found by its Storefront token header, API path or Shopify package; tests are not", () => {
  const dir = makeFixture({
    "lib/shopify/client.ts": `const x = 1;\nconst headers = { "X-Shopify-Storefront-Access-Token": token };`,
    "lib/other.ts": `fetch(\`https://\${domain}/api/2025-01/graphql.json\`)`,
    "lib/hydrogen.ts": `import { createStorefrontClient } from "@shopify/hydrogen-react";`,
    "lib/nothing.ts": `export const x = 1;`,
    "lib/client.test.ts": `const h = { "X-Shopify-Storefront-Access-Token": "t" };`,
  });
  // The source walk skips lib/shopify as the kit's folder; the audit hands those files in itself.
  const files = [...listSourceFiles(dir), "lib/shopify/client.ts"];
  assert.deepEqual(
    findShopifyClients(dir, files).map((c) => `${c.file}:${c.line} ${c.what}`),
    ["lib/hydrogen.ts:1 uses a Shopify package", "lib/other.ts:1 calls the Storefront API", "lib/shopify/client.ts:2 sends a Storefront token"]
  );
});

test("a site name is not a store claim; an announcement is", () => {
  const dir = makeFixture({
    "src/data/site.ts": 'export const site = { siteName: "x", website: "https://x.gr" };\n',
    "src/data/banner.ts": 'export const banner = { announcement: "Free shipping" };\n',
  });
  const files = listSourceFiles(dir);
  const claims = findSiteData(dir, files, []).filter((s) => /store claim/.test(s.what)).map((s) => s.file);
  assert.deepEqual(claims, ["src/data/banner.ts"]);
});

test("card inputs are found by name, id, placeholder or autocomplete", () => {
  const dir = makeFixture({
    "src/Pay.tsx": '<input id="cvc" />\n<input autoComplete="cc-exp" />\n<input placeholder="Card number" />\n<input name="email" />\n',
  });
  const found = findPaymentForms(dir, listSourceFiles(dir));
  assert.deepEqual(found.map((f) => f.line), [1, 2, 3]);
});

test("payment choices in a checkout page are found, with their fees; the same words elsewhere are not", () => {
  const dir = makeFixture({
    "app/checkout/page.tsx": `const METHODS = [\n  { id: "iris", label: "IRIS" },\n  { id: "cod", label: "Αντικαταβολή (+3€)" },\n  { id: "bank", label: "Τραπεζική κατάθεση" },\n];`,
    "components/Footer.tsx": `<p>Πληρωμή με αντικαταβολή</p>`,
  });
  assert.deepEqual(findPaymentChoices(dir, listSourceFiles(dir)).map((c) => `${c.file}:${c.line} ${c.what}`), [
    "app/checkout/page.tsx:2 IRIS",
    "app/checkout/page.tsx:3 cash on delivery, fee +3€",
    "app/checkout/page.tsx:4 bank transfer",
  ]);
});

test("payment choices: capitals without accents, English labels, pickup, and checkout components count; comments and tests do not", () => {
  const dir = makeFixture({
    "src/components/CheckoutForm.tsx": [
      "<option>ΤΡΑΠΕΖΙΚΗ ΚΑΤΑΘΕΣΗ</option>",
      "// cash on delivery was dropped",
      "<label>Cash on delivery (€ 2.50)</label>",
      "<label>Παραλαβή από το κατάστημα</label>",
      "<label>Pay in 3 installments with Klarna</label>",
      "<label>Your email</label>",
    ].join("\n"),
    "src/components/PaymentMethods.tsx": `export const P = () => <p>PayPal</p>;`,
    "src/components/checkout.test.tsx": `<label>Cash on delivery</label>`,
  });
  assert.deepEqual(findPaymentChoices(dir, listSourceFiles(dir)).map((c) => `${c.file}:${c.line} ${c.what}`), [
    "src/components/CheckoutForm.tsx:1 bank transfer",
    "src/components/CheckoutForm.tsx:3 cash on delivery, fee €2.50",
    "src/components/CheckoutForm.tsx:4 pickup from the shop",
    "src/components/CheckoutForm.tsx:5 instalments",
    "src/components/PaymentMethods.tsx:1 PayPal",
  ]);
});

test("tidy constants, fonts and size lists are not store content; a product image url is not a menu", () => {
  const dir = makeFixture({
    "src/constants/breakpoints.ts": "export const breakpoints = { sm: 640, md: 768 };\n",
    "src/config/fonts.ts": 'export const fonts = ["Inter", "Lora"];\n',
    "src/data/sizes.ts": 'export const sizes = ["S", "M", "L"];\n',
    "src/data/gallery.ts": 'export const gallery = [{ title: "Hero", image: { url: "/a.jpg" } }];\n',
    "src/data/navigation.ts": 'export const headerMenu = [{ label: "Shop", href: "/shop" }];\n',
    "src/data/collections.ts": 'export const collections = [{ handle: "throws", title: "Throws" }];\n',
  });
  const files = listSourceFiles(dir);
  const found = findSiteData(dir, files, findProductData(dir, files));
  assert.deepEqual(found.map((s) => `${s.file}: ${s.what}`), ["src/data/collections.ts: collection list", "src/data/navigation.ts: menu"]);
});

test("gift card fields and a lone expiry field are not card payment forms", () => {
  const dir = makeFixture({
    "src/Gift.tsx": '<input placeholder="Gift card number" />\n<input name="giftCardCode" id="gift-card-number" />\n<input name="expiry" />\n',
    "src/Pay.tsx": '<input name="cardNumber" />\n<input name="expiry" />\n<input autoComplete="cc-csc" />\n<input name="cvc" />\n',
    "src/Far.tsx": '<input name="expiry" />\n<p>a</p>\n<p>b</p>\n<p>c</p>\n<p>d</p>\n<input name="cvv" />\n',
  });
  const found = findPaymentForms(dir, listSourceFiles(dir)).map((f) => `${f.file}:${f.line}`);
  assert.deepEqual(found, ["src/Far.tsx:6", "src/Pay.tsx:1", "src/Pay.tsx:2", "src/Pay.tsx:3", "src/Pay.tsx:4"]);
});

test("a call to a Shopify-backed dynamic route is not a fake API; one serving hardcoded data still is", () => {
  const dir = makeFixture({
    "src/app/api/products/[id]/route.ts": 'import { getProduct } from "@/lib/shopify";\nexport async function GET() {}\n',
    "src/app/api/items/[...slug]/route.ts": 'import { items } from "@/data/items";\nexport async function GET() {}\n',
    "src/data/items.ts": "export const items = [{ title: 'A', price: 1 }, { title: 'B', price: 2 }];\n",
    "src/components/One.tsx": "fetch(`/api/products/${id}`)\n",
    "src/components/Two.tsx": "fetch(`/api/items/${id}`)\n",
  });
  const files = listSourceFiles(dir);
  const apis = findFakeApis(dir, files).map((a) => `${a.file}:${a.kind}`);
  assert.deepEqual(apis, ["src/app/api/items/[...slug]/route.ts:route", "src/components/Two.tsx:fetch"]);
});

const TSCONFIG_WITH_COMMENTS = `{
  // comments and trailing commas are normal in tsconfig
  "compilerOptions": {
    /* the star below is inside strings, not a comment */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./src/data/*"],
      "@site": ["./src/data/site.ts"],
    },
  },
}`;

test("importers: a custom alias from tsconfig paths resolves to its folder, even when the names do not line up", () => {
  const dir = makeFixture({
    "tsconfig.json": TSCONFIG_WITH_COMMENTS,
    "src/app/layout.tsx": 'import { site } from "@shared/site";\nimport { a } from "@site";\nimport { n } from "@/data/nav";\n',
    "src/data/site.ts": "export const site = {};\n",
    "src/data/nav.ts": "export const n = [];\n",
    "src/data/other.ts": "export const o = [];\n",
  });
  const importers = findImporters(dir, listSourceFiles(dir));
  assert.deepEqual(importers.get("src/data/site.ts"), ["src/app/layout.tsx"]);
  assert.deepEqual(importers.get("src/data/nav.ts"), ["src/app/layout.tsx"]);
  assert.deepEqual(importers.get("src/data/other.ts"), []);
});

test("importers: with no tsconfig, @data/site still counts as an import of src/data/site.ts", () => {
  const dir = makeFixture({
    "src/app/layout.tsx": 'import { site } from "@data/site";\nimport cfg from "@config/theme";\n',
    "src/data/site.ts": "export const site = {};\n",
    "src/config/theme.ts": "export default {};\n",
    "src/data/other.ts": "export const o = [];\n",
  });
  const importers = findImporters(dir, listSourceFiles(dir));
  assert.deepEqual(importers.get("src/data/site.ts"), ["src/app/layout.tsx"]);
  assert.deepEqual(importers.get("src/config/theme.ts"), ["src/app/layout.tsx"]);
  assert.deepEqual(importers.get("src/data/other.ts"), []);
});

test("importers: a broken tsconfig is ignored and the name match still works", () => {
  const dir = makeFixture({
    "tsconfig.json": "{ this is not json",
    "src/app/layout.tsx": 'import { site } from "@data/site";\n',
    "src/data/site.ts": "export const site = {};\n",
  });
  assert.deepEqual(findImporters(dir, listSourceFiles(dir)).get("src/data/site.ts"), ["src/app/layout.tsx"]);
});
