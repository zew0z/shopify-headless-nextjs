import test from "node:test";
import assert from "node:assert/strict";
import { findBrand, findTypedClaims } from "./claims.mjs";
import { listSourceFiles } from "./walk.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

const scan = (files, options) => {
  const dir = makeFixture(files);
  return findTypedClaims(dir, listSourceFiles(dir), options);
};
const kinds = (found) => found.map((f) => `${f.file}:${f.line} ${f.kind}`);

test("store claims typed into JSX are found; button labels are not", () => {
  const found = scan({
    "src/components/Footer.tsx": `export const Footer = () => (
  <footer>
    <p className="muted small">Taxes included. Shipping calculated at checkout.</p>
    <p>Free returns within 30 days</p>
    <span>4.8 stars from 214 reviews</span>
    <small> Delivered every 3 months. Cancel any time.</small>
    Made in Portugal
    <form className="newsletter"><label htmlFor="newsletter-email">Join the newsletter</label></form>
    <button>Add to cart</button><a href="/collections/all">Shop all</a>
  </footer>
);`,
  });
  assert.deepEqual(kinds(found), [
    "src/components/Footer.tsx:3 claim",
    "src/components/Footer.tsx:4 claim",
    "src/components/Footer.tsx:5 claim",
    "src/components/Footer.tsx:6 claim",
    "src/components/Footer.tsx:7 claim",
    "src/components/Footer.tsx:8 claim",
  ]);
});

test("class names, ids and comments never count as claims", () => {
  const found = scan({
    "src/components/Box.tsx": `// Free shipping banner goes here later
export const Box = () => <div className="newsletter free-shipping" id="newsletter-email" />;`,
  });
  assert.deepEqual(found, []);
});

test("a copyright line with a typed year or name is a claim; one built from Shopify is not", () => {
  const found = scan({
    "src/components/A.tsx": `export const A = () => <div className="footer-bottom">© 2026 Lumen & Loom</div>;`,
    "src/components/B.tsx": `export const B = ({ shop }) => <div>© {new Date().getFullYear()} {shop.name}</div>;`,
  });
  assert.deepEqual(kinds(found), ["src/components/A.tsx:1 claim"]);
});

test("the shop name comes from the site data file, and every typed copy of it is found, even split by a tag", () => {
  const files = {
    "src/data/site.ts": `export const site = {\n  name: "Lumen & Loom",\n  tagline: "Home textiles",\n};`,
    "src/components/Header.tsx": `export const Header = () => (
  <a href="/" className="logo">
    Lumen <span>&</span> Loom
  </a>
);`,
    "src/components/Logo.tsx": `export const Logo = () => <img src="/logo.svg" alt="Lumen & Loom logo" />;`,
  };
  const dir = makeFixture(files);
  assert.deepEqual(findBrand(dir, listSourceFiles(dir)), { name: "Lumen & Loom", file: "src/data/site.ts", line: 2 });
  assert.deepEqual(kinds(findTypedClaims(dir, listSourceFiles(dir), { skip: ["src/data/site.ts"] })), [
    "src/components/Header.tsx:3 shop name",
    "src/components/Logo.tsx:1 shop name",
  ]);
});

test("the shop name can come from a literal title in the root layout's metadata", () => {
  const dir = makeFixture({
    "app/layout.tsx": `export const metadata = {\n  title: { default: "Northwind | Outdoor gear", template: "%s | Northwind" },\n};`,
  });
  assert.equal(findBrand(dir, listSourceFiles(dir))?.name, "Northwind");
});

test("typed metadata in the root layout and a typed home headline are found", () => {
  const found = scan({
    "src/app/layout.tsx": `import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { default: \`\${site.name}\`, template: \`%s | \${site.name}\` },
  description: "Throws, cushions, bed linen and towels in natural fibres.",
};
export default function RootLayout({ children }) { return children; }`,
    "src/app/page.tsx": `export default function Home() {
  return <section><h1>Textiles for slow mornings</h1><h1>{shop.brand?.slogan}</h1></section>;
}`,
  });
  assert.deepEqual(kinds(found), ["src/app/layout.tsx:4 metadata", "src/app/page.tsx:2 headline"]);
});

test("stock photo hosts are found in pages and in next.config", () => {
  const found = scan({
    "src/app/page.tsx": `<Image src="https://images.unsplash.com/photo-1?w=2000" alt="" fill />`,
    "next.config.ts": `export default { images: { remotePatterns: [{ hostname: "images.unsplash.com" }] } };`,
  });
  assert.deepEqual(kinds(found), ["next.config.ts:1 stock photo", "src/app/page.tsx:1 stock photo"]);
});

test("tests and skipped files are not scanned", () => {
  const found = scan(
    {
      "src/components/Footer.test.tsx": `<p>Free returns within 30 days</p>`,
      "src/data/site.ts": `export const site = { announcement: "Free shipping on orders over 60" };`,
    },
    { skip: ["src/data/site.ts"] }
  );
  assert.deepEqual(found, []);
});

test("Greek claims are found: free delivery, VAT included, since a year", () => {
  const found = scan({
    "components/Price.tsx": `export const P = () => (
  <div>
    <span>(Συμπεριλαμβάνει ΦΠΑ 24%)</span>
    <p>Δωρεάν μεταφορά για αγορές άνω των 50€</p>
    <small>ΕΠΙΠΛΑ · ΑΠΟ ΤΟ 2004</small>
    <button>Προσθήκη στο Καλάθι</button>
  </div>
);`,
  });
  assert.deepEqual(kinds(found), ["components/Price.tsx:3 claim", "components/Price.tsx:4 claim", "components/Price.tsx:5 claim"]);
});

test("a legal page with typed text is found; one that reads Shopify is not", () => {
  const para = `<p>${"Τα προσωπικά σας δεδομένα προστατεύονται σύμφωνα με τον κανονισμό. ".repeat(4)}</p>\n`;
  const found = scan({
    "app/privacy/page.tsx": `export default function Privacy() {\n  return (\n    <main>\n${para.repeat(8)}    </main>\n  );\n}`,
    "app/terms/page.tsx": `import { getPolicy } from "@/lib/shopify";\nexport default async function T() { const p = await getPolicy("terms-of-service"); return <main>${para.repeat(8)}</main>; }`,
  });
  assert.deepEqual(kinds(found).filter((k) => k.endsWith("legal page")), ["app/privacy/page.tsx:1 legal page"]);
});

test("a short page under a legal route is not a legal page", () => {
  const found = scan({ "app/shipping/page.tsx": `export default function S() { return <p>Shipping options are shown at checkout.</p>; }` });
  assert.deepEqual(kinds(found).filter((k) => k.endsWith("legal page")), []);
});

test("a module of typed shop details is found when something imports it", () => {
  const dir = makeFixture({
    "lib/store-info.ts": `export const STORE = {\n  name: "Shop",\n  address: "Street 1",\n  phone: "210 0000000",\n  email: "a@b.gr",\n};`,
    "lib/unused-info.ts": `export const X = { address: "Street 2", phone: "1" };`,
    "app/contact/page.tsx": `import { STORE } from "@/lib/store-info";\nexport default function C() { return <p>{STORE.phone}</p>; }`,
  });
  const files = listSourceFiles(dir);
  const importers = new Map(files.map((f) => [f, f === "lib/store-info.ts" ? ["app/contact/page.tsx"] : []]));
  assert.deepEqual(
    findTypedClaims(dir, files, { importers }).filter((c) => c.kind === "shop details").map((c) => `${c.file}:${c.line}`),
    ["lib/store-info.ts:1"]
  );
});

test("shop-detail names in a type, or filled from Shopify, are not typed shop details", () => {
  const found = scan({
    "lib/contact-card.ts": `export type Card = { address: string; phone: string; email?: string };
export const card = {
  address: profile.address,
  phone: profile.phones[0],
};`,
  });
  assert.deepEqual(found.filter((c) => c.kind === "shop details"), []);
});
