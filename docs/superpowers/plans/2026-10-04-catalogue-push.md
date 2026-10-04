# Catalogue Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent tools to get a client's products into Shopify (collections, products, variants, images, stock), publish them to the Headless channel, and prove through the same API the storefront uses that they arrived.

**Architecture:** One validated file, `data/catalog.json`, is the only thing pushed. Per-client "source" modules turn a vendor feed, sheet or scrape into that shape (pure, testable, no network). A pure builder turns a catalogue product into a `productSet` input. A thin applier writes through the Admin API keyed on handle (a re-run updates, never duplicates). Two read-back checks prove it: the Storefront API (what customers see) and the Admin API (stock tracking).

**Tech Stack:** Node ESM `.mjs`, `node --test`, Shopify Admin and Storefront GraphQL. No new dependencies.

**Spec:** Section "Design decisions" below. Builds on `2026-10-04-store-setup-foundation.md` (the `catalogue` and `inventory` steps in `scripts/setup/steps.mjs`).

## Design decisions

- Generic kit, not a furniture importer. The Epipleon/Woodwell normalisers in `xristos-store` are client-specific; the agent writes new source modules per client from `scripts/catalogue/sources/_template.mjs` and `docs/catalogue-import.md`.
- Ported from `landing-template` (`scripts/shopify/catalog.mjs`, `push.mjs`), which was verified against the Admin API there. Differences, from checking shopify.dev on 2026-10-04: the variant limit is 2048 (the old code said 100); API version default moves off an expired version.
- Stock comes from `store-setup.config.json` (`tracksInventory`) as the single source of truth. A catalogue that disagrees with it fails validation.
- Publishing: every product and collection is published to every publication the store has, including Headless. This is the classic "Admin has 200 products, site shows none" cause.
- **API version guard.** Shopify supports 2026-01, 2026-04, 2026-07 and 2026-10 (checked 2026-10-04). A request for an expired version is **silently served by the oldest supported one**, with an `X-Shopify-API-Version` header saying which. The scripts default to `2026-07` and compare requested against served. This repo's SDK defaults to `2025-01`, which is expired; **changing the SDK default is a separate decision for the owner** and is not part of this plan.

## Global Constraints

- No new npm dependencies. Unit tests use `node:test`; run with `pnpm test:scripts`.
- Every JS file in this plan's code blocks starts with its path as a `// comment` line.
- Admin token only from `.env.local`; never log a token; use `mask()`.
- Nothing is "verified" until it has run against a real (development) store. Say "unverified" otherwise.
- Writes need `--dry-run` first. The CLI treats a bare flag as `true` (`parseArgs`).

## Known risks, stated up front

- `productSet` identifier by `{ handle }`, the `inventoryQuantities` shape and `files` are from docs and from `landing-template`, not from a live call here. Task 4 Step 1 introspects the live schema first.
- From API version 2026-04, `inventorySetQuantities` requires an `@idempotent` directive. Whether `productSet` with `inventoryQuantities` does too is **not known**; the first real call answers it. If it does, add the directive and record it in `docs/shopify-api-gotchas.md`.
- Storefront reads nested `variants(first: 100)`; products with more than 100 variants are compared up to 100.

## File structure

```
scripts/shopify/version.mjs               pure: versionStatus(), shopMismatches()
scripts/shopify/version.test.mjs
scripts/shopify/admin-client.mjs          modify: capture served version, add publicationInputs()
scripts/shopify/env.mjs                   modify: default API version 2026-07
scripts/catalogue/format.mjs              the catalogue shape + validateCatalog()
scripts/catalogue/format.test.mjs
scripts/catalogue/build-input.mjs         pure: buildProductInput()
scripts/catalogue/build-input.test.mjs
scripts/catalogue/push.mjs                describePlan() + pushCatalogue()
scripts/catalogue/push.test.mjs
scripts/catalogue/verify.mjs              Storefront read-back: summarise(), compareToCatalogue()
scripts/catalogue/verify.test.mjs
scripts/catalogue/inventory.mjs           Admin read-back: inventoryMismatches()
scripts/catalogue/inventory.test.mjs
scripts/catalogue/build.mjs               merge sources -> data/catalog.json
scripts/catalogue/build.test.mjs
scripts/catalogue/sources/_template.mjs   what a source module looks like (ignored by the build)
scripts/setup/config.mjs                  loadConfig() moved out of cli.mjs
scripts/setup/cli.mjs                     modify: new commands
scripts/setup/steps.mjs                   modify: catalogue + inventory automation
docs/catalogue-import.md                  how to read a feed and what goes wrong
docs/shopify-api-gotchas.md               exact error text and fixes
.claude/skills/shopify-store-setup/SKILL.md   modify: catalogue section
.gitignore                                modify: /data/catalog.json
```

---

### Task 1: API version guard and shop read-back

**Files:**
- Create: `scripts/shopify/version.mjs`, `scripts/shopify/version.test.mjs`
- Modify: `scripts/shopify/env.mjs` (default version), `scripts/shopify/env.test.mjs`, `scripts/shopify/admin-client.mjs`, `scripts/setup/cli.mjs` (preflight)

**Interfaces:**
- Produces: `versionStatus(requested: string, served: string|null): { ok: boolean; note: string }`, `shopMismatches(shop: {currencyCode, taxesIncluded}, config: Config): string[]`, `servedVersion(): string|null` and `publicationInputs(): Promise<{ nodes: {id, name}[]; input: {publicationId: string}[] }>` from `admin-client.mjs`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/shopify/version.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { versionStatus, shopMismatches } from "./version.mjs";

test("a matching served version is fine", () => {
  assert.deepEqual(versionStatus("2026-07", "2026-07"), { ok: true, note: "Shopify served 2026-07" });
});

test("a different served version means the requested one is expired or unreleased", () => {
  const r = versionStatus("2025-01", "2026-01");
  assert.equal(r.ok, false);
  assert.match(r.note, /2025-01/);
  assert.match(r.note, /2026-01/);
});

test("a missing header cannot confirm anything", () => {
  assert.equal(versionStatus("2026-07", null).ok, false);
});

const config = { currency: "EUR", pricesIncludeTax: true };

test("matching shop and config give no problems", () => {
  assert.deepEqual(shopMismatches({ currencyCode: "EUR", taxesIncluded: true }, config), []);
});

test("currency mismatch says stop and ask", () => {
  const [p] = shopMismatches({ currencyCode: "USD", taxesIncluded: true }, config);
  assert.match(p, /USD/);
  assert.match(p, /ask the owner/);
});

test("tax mismatch points at the tax-inclusive step because the API cannot change it", () => {
  const [p] = shopMismatches({ currencyCode: "EUR", taxesIncluded: false }, config);
  assert.match(p, /tax-inclusive/);
});
```

Add to `scripts/shopify/env.test.mjs`:

```js
test("the default API version is one Shopify still supports", () => {
  assert.equal(shopifyEnv({}).apiVersion, "2026-07");
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm test:scripts`
Expected: FAIL (`Cannot find module './version.mjs'`; env default test fails with `2025-07`).

- [ ] **Step 3: Implement**

```js
// scripts/shopify/version.mjs
/**
 * Shopify never rejects an expired API version: it silently serves the oldest
 * supported one and says so in the X-Shopify-API-Version response header.
 * Comparing requested against served is the only reliable way to notice.
 */
export function versionStatus(requested, served) {
  if (!served) return { ok: false, note: `no X-Shopify-API-Version header, cannot confirm ${requested} was used` };
  if (served === requested) return { ok: true, note: `Shopify served ${served}` };
  return { ok: false, note: `asked for ${requested} but Shopify served ${served}; ${requested} is expired or unreleased, so this ran on a version nobody tested against` };
}

/** Facts the API can read but not change. A mismatch is a human decision, not a fix-it-in-code. */
export function shopMismatches(shop, config) {
  const problems = [];
  if (shop.currencyCode !== config.currency) {
    problems.push(`store currency is ${shop.currencyCode} but the config says ${config.currency}. Currency cannot change after the first order: stop and ask the owner.`);
  }
  if (shop.taxesIncluded !== config.pricesIncludeTax) {
    problems.push(`store says taxesIncluded=${shop.taxesIncluded} but the config says pricesIncludeTax=${config.pricesIncludeTax}. The API cannot change this; it is the tax-inclusive step (Settings > Taxes and duties).`);
  }
  return problems;
}
```

In `scripts/shopify/env.mjs` change `export const API_VERSION_DEFAULT = "2025-07";` to `"2026-07"`.

In `scripts/shopify/admin-client.mjs`:

1. Below the `sleep` helper add:

```js
let served = null;
/** The API version Shopify actually used for the most recent Admin call. */
export const servedVersion = () => served;
```

2. In `adminGraphQL`, directly after the `fetch(...)` call add: `served = response.headers.get("x-shopify-api-version") ?? served;`

3. Append at the end of the file:

```js
export const PUBLICATIONS_QUERY = `query { publications(first: 25) { nodes { id name } } }`;

/** Every sales channel the store can publish to, including Headless. */
export async function publicationInputs() {
  const nodes = (await adminGraphQL(PUBLICATIONS_QUERY)).publications.nodes;
  return { nodes, input: nodes.map((publication) => ({ publicationId: publication.id })) };
}
```

In `scripts/setup/cli.mjs` extend the `preflight` case: after the scope check (`ok(\`admin token has: ...\`)`) add

```js
    const shop = (await adminGraphQL("{ shop { name currencyCode taxesIncluded } }")).shop;
    ok(`shop ${shop.name}: ${shop.currencyCode}, taxesIncluded ${shop.taxesIncluded}`);
    const version = versionStatus(shopifyEnv().apiVersion, servedVersion());
    (version.ok ? ok : warn)(version.note);
    const mismatches = shopMismatches(shop, config);
    mismatches.forEach((m) => bad(m));
    if (mismatches.length) process.exit(1);
```

and add the imports `adminGraphQL`, `servedVersion` (from `../shopify/admin-client.mjs`), `shopifyEnv` (from `../shopify/env.mjs`) and `{ versionStatus, shopMismatches } from "../shopify/version.mjs"`.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test:scripts && node --check scripts/setup/cli.mjs`
Expected: all pass, no syntax error.

- [ ] **Step 5: Commit**

```bash
git add scripts/shopify scripts/setup/cli.mjs
git commit -m "feat(setup): detect expired API versions and read the shop back in preflight"
```

---

### Task 2: Catalogue format and validator

**Files:**
- Create: `scripts/catalogue/format.mjs`
- Test: `scripts/catalogue/format.test.mjs`

**Interfaces:**
- Produces: `HANDLE_PATTERN: RegExp`, `validateCatalog(catalog: {collections, products}, options?: { tracksInventory?: boolean }): string[]` (human-readable problems; empty means pushable).

Catalogue shape (each product: `handle, title, descriptionHtml?, vendor?, productType?, status?, tags?, collections?: handle[], options?: {name, values[]}[], variants: {sku, price, compareAtPrice?, options?: {name: value}, tracked?, quantity?, taxable?}[], images?: https url[], metafields?: {namespace, key, type, value}[]`; each collection: `handle, title, description?, image?`). A product with no options: omit `options` and give one variant with no `options` key.

- [ ] **Step 1: Write the failing test**

```js
// scripts/catalogue/format.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalog } from "./format.mjs";

const variant = (over = {}) => ({ sku: "A-1", price: "10.00", ...over });
const product = (over = {}) => ({ handle: "chair", title: "Chair", variants: [variant()], ...over });
const catalog = (products = [product()], collections = []) => ({ collections, products });
const problems = (c, o) => validateCatalog(c, o).join("\n");

test("a minimal catalogue is pushable", () => {
  assert.deepEqual(validateCatalog(catalog()), []);
});

test("handles must be url-safe and unique", () => {
  assert.match(problems(catalog([product({ handle: "Bad Handle" })])), /handle not url-safe/);
  assert.match(problems(catalog([product(), product({ variants: [variant({ sku: "B" })] })])), /duplicate product handle/);
});

test("skus are required and unique across the catalogue", () => {
  assert.match(problems(catalog([product({ variants: [{ price: "1" }] })])), /without a sku/);
  assert.match(problems(catalog([product(), product({ handle: "sofa" })])), /duplicate sku/);
});

test("price must be positive and compare-at must exceed it", () => {
  assert.match(problems(catalog([product({ variants: [variant({ price: "0" })] })])), /price must be a positive number/);
  assert.match(problems(catalog([product({ variants: [variant({ compareAtPrice: "10.00" })] })])), /compareAtPrice must exceed price/);
  assert.deepEqual(validateCatalog(catalog([product({ variants: [variant({ compareAtPrice: "12.00" })] })])), []);
});

test("images must be https url strings, at most 20", () => {
  assert.match(problems(catalog([product({ images: ["http://x/a.jpg"] })])), /not https/);
  assert.match(problems(catalog([product({ images: [{ huge: "https://x" }] })])), /expected a url string/);
  assert.match(problems(catalog([product({ images: Array.from({ length: 21 }, (_, i) => `https://x/${i}.jpg`) })])), /first 20/);
});

test("options: variants must use declared options and values, with no duplicate combinations", () => {
  const withOptions = (variants) => product({ options: [{ name: "Colour", values: ["Grey", "Beige"] }], variants });
  assert.match(problems(catalog([withOptions([variant({ options: { Colour: "Red" } })])])), /not in the declared values/);
  assert.match(problems(catalog([withOptions([variant({ options: { Size: "L" } })])])), /not declared/);
  assert.match(problems(catalog([withOptions([variant()])])), /sets 0 option/);
  const dup = withOptions([variant({ options: { Colour: "Grey" } }), variant({ sku: "A-2", options: { Colour: "Grey" } })]);
  assert.match(problems(catalog([dup])), /share the option combination/);
});

test("more than three options or 2048 variants is rejected", () => {
  const four = ["a", "b", "c", "d"].map((name) => ({ name, values: ["x"] }));
  assert.match(problems(catalog([product({ options: four, variants: [variant({ options: { a: "x", b: "x", c: "x", d: "x" } })] })])), /options; Shopify allows 3/);
  const many = Array.from({ length: 2049 }, (_, i) => variant({ sku: `S${i}` }));
  assert.match(problems(catalog([product({ variants: many })])), /2049 variants/);
});

test("collections must exist, with unique url-safe handles", () => {
  assert.match(problems(catalog([product({ collections: ["nope"] })])), /unknown collection/);
  assert.match(problems(catalog([], [{ handle: "a", title: "A" }, { handle: "a", title: "A2" }])), /duplicate collection handle/);
  assert.deepEqual(validateCatalog(catalog([product({ collections: ["a"] })], [{ handle: "a", title: "A" }])), []);
});

test("list metafields must be JSON-encoded arrays", () => {
  const bad = { namespace: "custom", key: "colors", type: "list.single_line_text_field", value: "red" };
  assert.match(problems(catalog([product({ metafields: [bad] })])), /JSON-encoded array/);
});

test("descriptions must not link out to the vendor's shop", () => {
  const html = '<p>Buy at <a href="https://vendor.example/p/1">vendor</a></p>';
  assert.match(problems(catalog([product({ descriptionHtml: html })])), /links out/);
  assert.deepEqual(validateCatalog(catalog([product({ descriptionHtml: "<p>Nice chair</p>" })])), []);
});

test("a shop that tracks stock needs an integer quantity on every variant", () => {
  assert.match(problems(catalog(), { tracksInventory: true }), /integer quantity/);
  const ok = catalog([product({ variants: [variant({ quantity: 3 })] })]);
  assert.deepEqual(validateCatalog(ok, { tracksInventory: true }), []);
});

test("a shop that does not track stock rejects variants claiming tracked: true", () => {
  const c = catalog([product({ variants: [variant({ tracked: true })] })]);
  assert.match(problems(c, { tracksInventory: false }), /does not track inventory/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './format.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```js
// scripts/catalogue/format.mjs
/**
 * The import format (`data/catalog.json`) and its validator.
 *
 * Every source (vendor feed, sheet, scrape) normalises into this one shape and
 * only this shape is pushed. The validator rejects what the Admin API would
 * reject slowly or accept and embarrass you with. Add a rule every time a trap
 * catches you, so the next supplier cannot reintroduce it.
 */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Shopify's documented limits (shopify.dev productSet, 2026-10-04). Introspect if they change.
const MAX_VARIANTS = 2048;
const MAX_OPTIONS = 3;
const MAX_IMAGES = 20;

export function validateCatalog({ collections = [], products = [] }, { tracksInventory = false } = {}) {
  const problems = [];
  const collectionHandles = new Set();
  const productHandles = new Set();
  const skus = new Set();

  for (const collection of collections) {
    if (!HANDLE_PATTERN.test(collection.handle ?? "")) problems.push(`collection handle not url-safe: "${collection.handle}"`);
    if (collectionHandles.has(collection.handle)) problems.push(`duplicate collection handle: ${collection.handle}`);
    collectionHandles.add(collection.handle);
    if (!collection.title) problems.push(`collection ${collection.handle}: empty title`);
    if (collection.image && !/^https:\/\//.test(collection.image)) problems.push(`collection ${collection.handle}: image is not https`);
  }

  for (const product of products) {
    const id = product.handle ?? product.title ?? "<unnamed>";
    if (!HANDLE_PATTERN.test(product.handle ?? "")) problems.push(`product handle not url-safe: "${product.handle}"`);
    if (productHandles.has(product.handle)) problems.push(`duplicate product handle: ${product.handle}`);
    productHandles.add(product.handle);
    if (!product.title) problems.push(`${id}: empty title`);
    if (product.status && !["ACTIVE", "DRAFT", "ARCHIVED"].includes(product.status)) problems.push(`${id}: bad status "${product.status}"`);

    for (const handle of product.collections ?? []) {
      if (!collectionHandles.has(handle)) problems.push(`${id}: references unknown collection "${handle}"`);
    }

    for (const url of product.images ?? []) {
      if (typeof url !== "string") problems.push(`${id}: images contains a ${typeof url}, expected a url string`);
      else if (!/^https:\/\//.test(url)) problems.push(`${id}: image is not https: "${url.slice(0, 60)}"`);
    }
    if ((product.images ?? []).length > MAX_IMAGES) problems.push(`${id}: ${product.images.length} images; only the first ${MAX_IMAGES} are sent per product`);

    for (const metafield of product.metafields ?? []) {
      if (!metafield.namespace || !metafield.key || !metafield.type) problems.push(`${id}: metafield needs namespace, key and type`);
      if (metafield.type?.startsWith("list.") && typeof metafield.value === "string" && !metafield.value.startsWith("[")) {
        problems.push(`${id}: metafield ${metafield.key} is a list type, so value must be a JSON-encoded array string`);
      }
    }

    const outbound = (product.descriptionHtml ?? "").match(/<a\s[^>]*href=["']https?:\/\/[^"']+/gi);
    if (outbound) problems.push(`${id}: descriptionHtml links out (${outbound.length} link(s)); strip the anchors and keep the text`);

    const options = product.options ?? [];
    if (options.length > MAX_OPTIONS) problems.push(`${id}: ${options.length} options; Shopify allows ${MAX_OPTIONS}`);
    const declared = new Map(options.map((option) => [option.name, new Set(option.values)]));
    const variants = product.variants ?? [];
    if (!variants.length) problems.push(`${id}: no variants`);
    if (variants.length > MAX_VARIANTS) problems.push(`${id}: ${variants.length} variants; the limit is ${MAX_VARIANTS}`);

    const seenCombination = new Set();
    for (const variant of variants) {
      const label = `${id}/${variant.sku ?? "<no sku>"}`;
      if (!variant.sku) problems.push(`${id}: variant without a sku`);
      else if (skus.has(variant.sku)) problems.push(`duplicate sku across the catalogue: ${variant.sku}`);
      skus.add(variant.sku);

      if (!(Number(variant.price) > 0)) problems.push(`${label}: price must be a positive number`);
      if (variant.compareAtPrice != null && !(Number(variant.compareAtPrice) > Number(variant.price))) {
        problems.push(`${label}: compareAtPrice must exceed price, or the badge claims a fake discount`);
      }

      if (tracksInventory && !(Number.isInteger(variant.quantity) && variant.quantity >= 0)) {
        problems.push(`${label}: the shop tracks stock, so every variant needs an integer quantity >= 0`);
      }
      if (!tracksInventory && variant.tracked === true) {
        problems.push(`${label}: tracked is true but the shop does not track inventory (tracksInventory is false in the config)`);
      }

      const pairs = Object.entries(variant.options ?? {});
      if (pairs.length !== declared.size) problems.push(`${label}: sets ${pairs.length} option(s), the product declares ${declared.size}`);
      for (const [name, value] of pairs) {
        if (!declared.has(name)) problems.push(`${label}: option "${name}" is not declared on the product`);
        else if (!declared.get(name).has(value)) problems.push(`${label}: option value "${value}" is not in the declared values for "${name}"`);
      }
      const combination = pairs.map(([name, value]) => `${name}=${value}`).sort().join("|");
      if (seenCombination.has(combination)) problems.push(`${id}: two variants share the option combination ${combination || "(none)"}`);
      seenCombination.add(combination);
    }
  }
  return problems;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test:scripts`

- [ ] **Step 5: Commit**

```bash
git add scripts/catalogue/format.mjs scripts/catalogue/format.test.mjs
git commit -m "feat(catalogue): catalogue format and validator with a rule per known trap"
```

---

### Task 3: productSet input builder

**Files:**
- Create: `scripts/catalogue/build-input.mjs`
- Test: `scripts/catalogue/build-input.test.mjs`

**Interfaces:**
- Consumes: a validated catalogue product (Task 2).
- Produces: `buildProductInput(product, { collectionIds, locationId, tracksInventory, skipImages }): ProductSetInput` where `collectionIds: Record<handle, gid>`; throws if `tracksInventory` and no `locationId`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/catalogue/build-input.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildProductInput } from "./build-input.mjs";

const base = { collectionIds: {}, locationId: "gid://shopify/Location/1", tracksInventory: false, skipImages: false };
const product = {
  handle: "sofa",
  title: "Sofa",
  options: [{ name: "Colour", values: ["Grey", "Beige"] }],
  collections: ["sofas", "ghost"],
  images: ["https://x/1.jpg"],
  variants: [
    { sku: "S-G", price: "899.00", compareAtPrice: "1099.00", options: { Colour: "Grey" }, quantity: 4 },
    { sku: "S-B", price: 899, options: { Colour: "Beige" }, quantity: 0 },
  ],
};

test("handle, title and status default through", () => {
  const input = buildProductInput(product, base);
  assert.equal(input.handle, "sofa");
  assert.equal(input.status, "ACTIVE");
});

test("options become productOptions and variants carry optionValues", () => {
  const input = buildProductInput(product, base);
  assert.deepEqual(input.productOptions, [{ name: "Colour", values: [{ name: "Grey" }, { name: "Beige" }] }]);
  assert.deepEqual(input.variants[0].optionValues, [{ optionName: "Colour", name: "Grey" }]);
});

test("a product with no options sends neither productOptions nor optionValues", () => {
  const input = buildProductInput({ handle: "a", title: "A", variants: [{ sku: "A", price: "1.00" }] }, base);
  assert.equal(input.productOptions, undefined);
  assert.equal(input.variants[0].optionValues, undefined);
});

test("prices are strings and compare-at is null when absent", () => {
  const [grey, beige] = buildProductInput(product, base).variants;
  assert.equal(grey.compareAtPrice, "1099.00");
  assert.equal(beige.price, "899");
  assert.equal(beige.compareAtPrice, null);
});

test("untracked stock never sells out", () => {
  const [v] = buildProductInput(product, base).variants;
  assert.deepEqual(v.inventoryItem, { tracked: false });
  assert.equal(v.inventoryPolicy, "CONTINUE");
  assert.equal(v.inventoryQuantities, undefined);
});

test("tracked stock denies overselling and sets the quantity at the location", () => {
  const [v] = buildProductInput(product, { ...base, tracksInventory: true }).variants;
  assert.deepEqual(v.inventoryItem, { tracked: true });
  assert.equal(v.inventoryPolicy, "DENY");
  assert.deepEqual(v.inventoryQuantities, [{ locationId: "gid://shopify/Location/1", name: "available", quantity: 4 }]);
});

test("tracking stock without a location is an error, not a silent skip", () => {
  assert.throws(() => buildProductInput(product, { ...base, tracksInventory: true, locationId: undefined }), /locationId/);
});

test("only known collections are attached", () => {
  const input = buildProductInput(product, { ...base, collectionIds: { sofas: "gid://shopify/Collection/9" } });
  assert.deepEqual(input.collections, ["gid://shopify/Collection/9"]);
});

test("images become files, and can be skipped", () => {
  assert.deepEqual(buildProductInput(product, base).files, [{ originalSource: "https://x/1.jpg", contentType: "IMAGE" }]);
  assert.equal(buildProductInput(product, { ...base, skipImages: true }).files, undefined);
});

test("metafields pass through untouched", () => {
  const mf = [{ namespace: "custom", key: "material", type: "single_line_text_field", value: "Oak" }];
  assert.deepEqual(buildProductInput({ ...product, metafields: mf }, base).metafields, mf);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './build-input.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```js
// scripts/catalogue/build-input.mjs
/**
 * Pure: one catalogue product -> one `productSet` input. No network, so every
 * field decision is unit-tested. Stock comes from the shop-wide `tracksInventory`
 * setting, never per product, so the catalogue cannot disagree with the config.
 */
export function buildProductInput(product, { collectionIds = {}, locationId, tracksInventory, skipImages = false }) {
  if (tracksInventory && !locationId) throw new Error("tracksInventory is true but no locationId was given to set stock at");
  const optionNames = (product.options ?? []).map((option) => option.name);
  const collections = (product.collections ?? []).map((handle) => collectionIds[handle]).filter(Boolean);

  return {
    handle: product.handle,
    title: product.title,
    status: product.status ?? "ACTIVE",
    ...(product.descriptionHtml && { descriptionHtml: product.descriptionHtml }),
    ...(product.vendor && { vendor: product.vendor }),
    ...(product.productType && { productType: product.productType }),
    ...(product.tags?.length && { tags: product.tags }),
    ...(collections.length && { collections }),
    ...(optionNames.length && {
      productOptions: product.options.map((option) => ({ name: option.name, values: option.values.map((name) => ({ name })) })),
    }),
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      price: String(variant.price),
      compareAtPrice: variant.compareAtPrice != null ? String(variant.compareAtPrice) : null,
      ...(optionNames.length && { optionValues: optionNames.map((name) => ({ optionName: name, name: variant.options[name] })) }),
      inventoryItem: { tracked: Boolean(tracksInventory) },
      // Untracked stock never shows "sold out"; tracked stock must not oversell.
      inventoryPolicy: tracksInventory ? "DENY" : "CONTINUE",
      ...(tracksInventory && { inventoryQuantities: [{ locationId, name: "available", quantity: variant.quantity }] }),
      taxable: variant.taxable ?? true,
    })),
    ...(!skipImages && product.images?.length && {
      files: product.images.slice(0, 20).map((url) => ({ originalSource: url, contentType: "IMAGE" })),
    }),
    ...(product.metafields?.length && { metafields: product.metafields }),
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test:scripts`

- [ ] **Step 5: Commit**

```bash
git add scripts/catalogue/build-input.mjs scripts/catalogue/build-input.test.mjs
git commit -m "feat(catalogue): pure productSet input builder driven by the shop-wide stock setting"
```

---

### Task 4: Push applier

**Files:**
- Create: `scripts/catalogue/push.mjs`
- Test: `scripts/catalogue/push.test.mjs`

**Interfaces:**
- Consumes: `validateCatalog` (Task 2), `buildProductInput` (Task 3), `adminGraphQL`, `publicationInputs` (Task 1).
- Produces: `describePlan(catalog, { limit }): string[]`, `pushCatalogue({ config, catalog, dryRun, limit, only, skipImages, locationId }): Promise<void>`. `only` is `"collections"`, `"products"` or undefined.

**Risk:** shapes below are from docs and `landing-template`. Step 1 checks them live first.

- [ ] **Step 1: Check the live schema on a development store**

Needs `.env.local` with a development store's domain and Admin token (human steps `dev-app` + `oauth`).

```bash
node scripts/shopify/introspect.mjs ProductSetIdentifiers
node scripts/shopify/introspect.mjs ProductSetInput
node scripts/shopify/introspect.mjs ProductVariantSetInput
node scripts/shopify/introspect.mjs InventoryLevelInput
node scripts/shopify/introspect.mjs CollectionInput
```

Confirm: `ProductSetIdentifiers` accepts `handle`; `ProductVariantSetInput` has `optionValues`, `inventoryItem`, `inventoryPolicy`, `inventoryQuantities`, `taxable`; `ProductSetInput` has `productOptions`, `files`, `collections`, `metafields`. If anything differs, change `build-input.mjs` and its tests together. If no development store exists yet, say so and mark Task 9 unverified. Do not guess silently.

- [ ] **Step 2: Write the failing test**

```js
// scripts/catalogue/push.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { describePlan } from "./push.mjs";

const catalog = {
  collections: [{ handle: "sofas", title: "Sofas" }],
  products: [
    { handle: "a", title: "A", collections: ["sofas"], images: ["https://x/1.jpg"], variants: [{ sku: "1", price: "1" }] },
    { handle: "b", title: "B", variants: [{ sku: "2", price: "1" }, { sku: "3", price: "1" }] },
  ],
};

test("the plan lists collections and every product with variant and image counts", () => {
  const lines = describePlan(catalog, {});
  assert.equal(lines.length, 3);
  assert.match(lines[0], /collection sofas/);
  assert.match(lines[1], /product\s+a\s+1v\s+1 img\s+\[sofas\]/);
  assert.match(lines[2], /product\s+b\s+2v\s+0 img/);
});

test("limit trims products but not collections", () => {
  const lines = describePlan(catalog, { limit: 1 });
  assert.equal(lines.length, 2);
});
```

- [ ] **Step 3: Run, expect FAIL** (`Cannot find module './push.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 4: Implement**

```js
// scripts/catalogue/push.mjs
/**
 * Writes the catalogue into Shopify through the Admin API. Idempotent: everything
 * is keyed on handle, so a second run updates and never duplicates. Collections
 * and products are published to every sales channel afterwards; skipping that is
 * the classic "Admin has 200 products, the site shows none" bug.
 * UNVERIFIED until run against a development store (Task 9).
 */
import { adminGraphQL, publicationInputs } from "../shopify/admin-client.mjs";
import { bad, heading, info, ok } from "../shopify/env.mjs";
import { buildProductInput } from "./build-input.mjs";
import { validateCatalog } from "./format.mjs";

const COLLECTION_BY_HANDLE = `query($handle: String!) { collectionByHandle(handle: $handle) { id } }`;
const COLLECTION_CREATE = `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { field message } } }`;
const COLLECTION_UPDATE = `mutation($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id } userErrors { field message } } }`;
const PUBLISH = `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
const LOCATIONS = `query { locations(first: 10) { nodes { id name isActive } } }`;

// `identifier` is an argument of the mutation, not a field of ProductSetInput.
const PRODUCT_SET = `
  mutation($identifier: ProductSetIdentifiers!, $input: ProductSetInput!) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product { id handle variants(first: 100) { nodes { id sku } } }
      userErrors { field message code }
    }
  }`;

export function describePlan(catalog, { limit } = {}) {
  const lines = catalog.collections.map((c) => `collection ${c.handle} - ${c.title}`);
  const products = limit ? catalog.products.slice(0, limit) : catalog.products;
  for (const p of products) {
    lines.push(`product    ${p.handle.padEnd(40)} ${String(p.variants.length).padStart(3)}v  ${(p.images ?? []).length} img  [${(p.collections ?? []).join(", ")}]`);
  }
  return lines;
}

async function pickLocation(locationId) {
  const active = (await adminGraphQL(LOCATIONS)).locations.nodes.filter((l) => l.isActive);
  const found = locationId ? active.find((l) => l.id === locationId) : active.length === 1 ? active[0] : null;
  if (!found) {
    bad(`pick a stock location with --location=<id>: ${active.map((l) => `${l.name} ${l.id}`).join(", ") || "none active"}`);
    process.exit(1);
  }
  return found.id;
}

export async function pushCatalogue({ config, catalog, dryRun = false, limit, only, skipImages = false, locationId }) {
  const tracksInventory = config.tracksInventory;
  const problems = validateCatalog(catalog, { tracksInventory });
  heading(`Catalogue  ${catalog.collections.length} collections, ${catalog.products.length} products`);
  if (problems.length) {
    problems.slice(0, 40).forEach((p) => bad(p));
    if (problems.length > 40) info(`... and ${problems.length - 40} more`);
    console.error(`\n  ${problems.length} problem(s). Fix the source module, not the store.\n`);
    process.exit(1);
  }
  ok("validates");

  if (dryRun) {
    describePlan(catalog, { limit }).forEach((line) => info(line));
    ok("dry run, nothing was written");
    return;
  }

  const location = tracksInventory ? await pickLocation(locationId) : undefined;
  const { nodes, input: publishTo } = await publicationInputs();
  heading(`Publishing to: ${nodes.map((p) => p.name).join(", ")}`);

  const collectionIds = {};
  for (const [index, collection] of catalog.collections.entries()) {
    const existing = (await adminGraphQL(COLLECTION_BY_HANDLE, { handle: collection.handle })).collectionByHandle;
    if (only === "products") {
      if (existing) collectionIds[collection.handle] = existing.id;
      continue;
    }
    const input = {
      handle: collection.handle,
      title: collection.title,
      ...(collection.description && { descriptionHtml: `<p>${collection.description}</p>` }),
      ...(collection.image && !skipImages && { image: { src: collection.image } }),
    };
    const data = existing
      ? await adminGraphQL(COLLECTION_UPDATE, { input: { ...input, id: existing.id } })
      : await adminGraphQL(COLLECTION_CREATE, { input });
    const id = existing ? data.collectionUpdate.collection.id : data.collectionCreate.collection.id;
    collectionIds[collection.handle] = id;
    await adminGraphQL(PUBLISH, { id, input: publishTo });
    console.log(`  ${existing ? "~" : "+"} ${String(index + 1).padStart(3)}/${catalog.collections.length}  ${collection.handle}`);
  }

  if (only === "collections") return;
  const products = limit ? catalog.products.slice(0, limit) : catalog.products;
  heading(`Products${skipImages ? " (images skipped)" : ""}`);
  let pushed = 0;
  for (const product of products) {
    const input = buildProductInput(product, { collectionIds, locationId: location, tracksInventory, skipImages });
    const data = await adminGraphQL(PRODUCT_SET, { identifier: { handle: product.handle }, input });
    await adminGraphQL(PUBLISH, { id: data.productSet.product.id, input: publishTo });
    pushed += 1;
    console.log(`  + ${String(pushed).padStart(3)}/${products.length}  ${product.handle.slice(0, 44).padEnd(44)} ${String(product.variants.length).padStart(3)}v`);
  }
  ok(`${pushed} products pushed. Next: pnpm shop-setup catalogue-verify`);
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm test:scripts && node --check scripts/catalogue/push.mjs`

- [ ] **Step 6: Commit**

```bash
git add scripts/catalogue/push.mjs scripts/catalogue/push.test.mjs
git commit -m "feat(catalogue): idempotent push of collections and products, published to every channel"
```

---

### Task 5: Storefront read-back

**Files:**
- Create: `scripts/catalogue/verify.mjs`
- Test: `scripts/catalogue/verify.test.mjs`

**Interfaces:**
- Consumes: `shopifyEnv`, `versionStatus` (Task 1).
- Produces: `summarise(products: {handle, images: string[], variantCount: number}[], collections: {handle}[]): { products, variants, withImage, collections }`, `compareToCatalogue(seen: {handles: string[], summary}, catalog): string[]` (problems; empty means the storefront serves what was pushed), `fetchStorefront(): Promise<{ products, collections, served }>`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/catalogue/verify.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { summarise, compareToCatalogue } from "./verify.mjs";

const catalog = {
  collections: [{ handle: "sofas", title: "Sofas" }],
  products: [
    { handle: "a", title: "A", images: ["https://x/1.jpg"], variants: [{ sku: "1", price: "1" }] },
    { handle: "b", title: "B", images: ["https://x/2.jpg"], variants: [{ sku: "2", price: "1" }, { sku: "3", price: "1" }] },
    { handle: "draft", title: "D", status: "DRAFT", variants: [{ sku: "4", price: "1" }] },
  ],
};
const seenProducts = [
  { handle: "a", images: ["u"], variantCount: 1 },
  { handle: "b", images: ["u"], variantCount: 2 },
];

test("summarise counts what the storefront returned", () => {
  const s = summarise([...seenProducts, { handle: "c", images: [], variantCount: 1 }], [{ handle: "sofas" }]);
  assert.deepEqual(s, { products: 3, variants: 4, withImage: 2, collections: 1 });
});

test("everything arrived: no problems (drafts are not expected on the storefront)", () => {
  const seen = { handles: ["a", "b"], summary: summarise(seenProducts, [{ handle: "sofas" }]) };
  assert.deepEqual(compareToCatalogue(seen, catalog), []);
});

test("a missing product is named", () => {
  const seen = { handles: ["a"], summary: summarise([seenProducts[0]], [{ handle: "sofas" }]) };
  const text = compareToCatalogue(seen, catalog).join("\n");
  assert.match(text, /missing from the storefront: b/);
  assert.match(text, /never published to the Headless channel/);
});

test("collection and image shortfalls are reported with numbers", () => {
  const noImages = seenProducts.map((p) => ({ ...p, images: [] }));
  const seen = { handles: ["a", "b"], summary: summarise(noImages, []) };
  const text = compareToCatalogue(seen, catalog).join("\n");
  assert.match(text, /collections: expected 1, storefront has 0/);
  assert.match(text, /images: 2 products should have one, storefront shows 0/);
});

test("variant counts are compared up to the 100 the storefront query returns", () => {
  const big = { collections: [], products: [{ handle: "big", title: "B", variants: Array.from({ length: 150 }, (_, i) => ({ sku: `s${i}`, price: "1" })) }] };
  const seen = { handles: ["big"], summary: summarise([{ handle: "big", images: [], variantCount: 100 }], []) };
  assert.deepEqual(compareToCatalogue(seen, big), []);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './verify.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```js
// scripts/catalogue/verify.mjs
/**
 * Proof through the layer the customer uses. The Admin API saying the data is
 * there does not mean the storefront serves it: unpublished products exist in
 * the Admin and are invisible here. Uses only the PUBLIC Storefront token.
 */
import { shopifyEnv } from "../shopify/env.mjs";

const VARIANT_PAGE = 100; // the nested variants(first: 100) below

export function summarise(products, collections) {
  return {
    products: products.length,
    variants: products.reduce((sum, p) => sum + p.variantCount, 0),
    withImage: products.filter((p) => p.images.length > 0).length,
    collections: collections.length,
  };
}

export function compareToCatalogue({ handles, summary }, catalog) {
  const problems = [];
  const expected = catalog.products.filter((p) => (p.status ?? "ACTIVE") === "ACTIVE");
  const seen = new Set(handles);
  const missing = expected.filter((p) => !seen.has(p.handle)).map((p) => p.handle);
  if (missing.length) {
    problems.push(`missing from the storefront: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}. Usually never published to the Headless channel.`);
  }
  if (summary.products !== expected.length) problems.push(`products: expected ${expected.length}, storefront has ${summary.products}`);
  const expectedVariants = expected.reduce((sum, p) => sum + Math.min(p.variants.length, VARIANT_PAGE), 0);
  if (summary.variants !== expectedVariants) problems.push(`variants: expected ${expectedVariants}, storefront has ${summary.variants}`);
  if (summary.collections !== catalog.collections.length) problems.push(`collections: expected ${catalog.collections.length}, storefront has ${summary.collections}`);
  const expectedImages = expected.filter((p) => (p.images ?? []).length > 0).length;
  if (summary.withImage < expectedImages) problems.push(`images: ${expectedImages} products should have one, storefront shows ${summary.withImage}. Image processing is asynchronous; wait and re-run, then look for FAILED media.`);
  return problems;
}

async function storefront(query, variables) {
  const env = shopifyEnv();
  const response = await fetch(`https://${env.domain}/api/${env.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": env.storefrontToken },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Storefront API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const json = await response.json();
  if (json.errors) throw new Error(`Storefront API errors: ${JSON.stringify(json.errors)}`);
  return { data: json.data, served: response.headers.get("x-shopify-api-version") };
}

const PRODUCTS = `query($after: String) { products(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { handle images(first: 1) { nodes { url } } variants(first: ${VARIANT_PAGE}) { nodes { id } } } } }`;
const COLLECTIONS = `query($after: String) { collections(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { handle } } }`;

export async function fetchStorefront() {
  const env = shopifyEnv();
  if (!env.domain || !env.storefrontToken) throw new Error("needs SHOPIFY_STORE_DOMAIN and a public Storefront token in .env.local");
  let served = null;
  const all = async (query, key) => {
    const nodes = [];
    let after = null;
    for (;;) {
      const { data, served: v } = await storefront(query, { after });
      served = v ?? served;
      nodes.push(...data[key].nodes);
      if (!data[key].pageInfo.hasNextPage) return nodes;
      after = data[key].pageInfo.endCursor;
    }
  };
  const products = (await all(PRODUCTS, "products")).map((p) => ({ handle: p.handle, images: p.images.nodes, variantCount: p.variants.nodes.length }));
  const collections = await all(COLLECTIONS, "collections");
  return { products, collections, served };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test:scripts && node --check scripts/catalogue/verify.mjs`

- [ ] **Step 5: Commit**

```bash
git add scripts/catalogue/verify.mjs scripts/catalogue/verify.test.mjs
git commit -m "feat(catalogue): read the catalogue back through the Storefront API"
```

---

### Task 6: Stock read-back

**Files:**
- Create: `scripts/catalogue/inventory.mjs`
- Test: `scripts/catalogue/inventory.test.mjs`

**Interfaces:**
- Produces: `inventoryMismatches(variants: {sku, tracked}[], tracksInventory: boolean): string[]`, `fetchVariantTracking(): Promise<{sku, tracked}[]>` (Admin API, paginated).

- [ ] **Step 1: Write the failing test**

```js
// scripts/catalogue/inventory.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { inventoryMismatches } from "./inventory.mjs";

test("everything matches the config: no problems", () => {
  assert.deepEqual(inventoryMismatches([{ sku: "A", tracked: true }], true), []);
  assert.deepEqual(inventoryMismatches([{ sku: "A", tracked: false }], false), []);
});

test("skus that disagree with the config are named and counted", () => {
  const [p] = inventoryMismatches([{ sku: "A", tracked: false }, { sku: "B", tracked: true }, { sku: "C", tracked: false }], true);
  assert.match(p, /2 of 3 variants/);
  assert.match(p, /A, C/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './inventory.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```js
// scripts/catalogue/inventory.mjs
import { adminGraphQL } from "../shopify/admin-client.mjs";

export function inventoryMismatches(variants, tracksInventory) {
  const wrong = variants.filter((v) => Boolean(v.tracked) !== Boolean(tracksInventory));
  if (!wrong.length) return [];
  const names = wrong.slice(0, 10).map((v) => v.sku).join(", ");
  return [`${wrong.length} of ${variants.length} variants disagree with tracksInventory=${tracksInventory}: ${names}${wrong.length > 10 ? ", ..." : ""}`];
}

const VARIANTS = `query($after: String) { productVariants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { sku inventoryItem { tracked } } } }`;

export async function fetchVariantTracking() {
  const out = [];
  let after = null;
  for (;;) {
    const { productVariants } = await adminGraphQL(VARIANTS, { after });
    out.push(...productVariants.nodes.map((v) => ({ sku: v.sku, tracked: v.inventoryItem.tracked })));
    if (!productVariants.pageInfo.hasNextPage) return out;
    after = productVariants.pageInfo.endCursor;
  }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test:scripts && node --check scripts/catalogue/inventory.mjs`

- [ ] **Step 5: Commit**

```bash
git add scripts/catalogue/inventory.mjs scripts/catalogue/inventory.test.mjs
git commit -m "feat(catalogue): read stock tracking back through the Admin API"
```

---

### Task 7: Sources and the catalogue build

**Files:**
- Create: `scripts/catalogue/build.mjs`, `scripts/catalogue/sources/_template.mjs`, `scripts/setup/config.mjs`
- Test: `scripts/catalogue/build.test.mjs`
- Modify: `scripts/setup/cli.mjs` (import `loadConfig` from `config.mjs` instead of defining it), `.gitignore`

**Interfaces:**
- Consumes: `validateCatalog` (Task 2), `validateConfig` (foundation plan).
- Produces: `mergeSources(results): { collections, products }` (collections de-duplicated by handle, first wins), `buildCatalogue({ config, sourcesDir, outFile }): Promise<{ ok: boolean; problems: string[]; catalog }>`, `loadConfig(): Config` (exits with a readable message on a missing or invalid config).

A source module is a file in `scripts/catalogue/sources/` whose default export is `async function load(): Promise<{ collections?: [], products?: [] }>`. Files starting with `_` or ending `.test.mjs` are ignored.

- [ ] **Step 1: Write the failing test**

```js
// scripts/catalogue/build.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeSources, buildCatalogue } from "./build.mjs";

test("collections are de-duplicated by handle, products are kept as given", () => {
  const merged = mergeSources([
    { collections: [{ handle: "a", title: "A" }], products: [{ handle: "p1" }] },
    { collections: [{ handle: "a", title: "A again" }, { handle: "b", title: "B" }], products: [{ handle: "p2" }] },
  ]);
  assert.deepEqual(merged.collections.map((c) => c.title), ["A", "B"]);
  assert.deepEqual(merged.products.map((p) => p.handle), ["p1", "p2"]);
});

async function setup(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "catalogue-"));
  const sourcesDir = path.join(dir, "sources");
  mkdirSync(sourcesDir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(sourcesDir, name), body);
  return { sourcesDir, outFile: path.join(dir, "catalog.json") };
}

const goodSource = `export default async () => ({ products: [{ handle: "a", title: "A", variants: [{ sku: "1", price: "5.00" }] }] });`;

test("a valid source builds data/catalog.json", async () => {
  const { sourcesDir, outFile } = await setup({ "one.mjs": goodSource });
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(readFileSync(outFile, "utf8")).products.length, 1);
});

test("an invalid catalogue is reported and nothing is written", async () => {
  const { sourcesDir, outFile } = await setup({ "bad.mjs": `export default async () => ({ products: [{ handle: "Bad Handle", title: "x", variants: [] }] });` });
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
  assert.equal(existsSync(outFile), false);
});

test("files starting with _ and test files are ignored", async () => {
  const { sourcesDir, outFile } = await setup({ "_template.mjs": "throw new Error('must not load')", "x.test.mjs": "throw new Error('must not load')", "one.mjs": goodSource });
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, true);
});

test("no sources is an error, not an empty catalogue", async () => {
  const { sourcesDir, outFile } = await setup({});
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /no source modules/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './build.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement the build**

```js
// scripts/catalogue/build.mjs
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateCatalog } from "./format.mjs";

export const SOURCES_DIR = path.join(process.cwd(), "scripts", "catalogue", "sources");
export const CATALOG_FILE = path.join(process.cwd(), "data", "catalog.json");

export function mergeSources(results) {
  const seen = new Set();
  const collections = [];
  for (const result of results) {
    for (const collection of result.collections ?? []) {
      if (seen.has(collection.handle)) continue;
      seen.add(collection.handle);
      collections.push(collection);
    }
  }
  return { collections, products: results.flatMap((r) => r.products ?? []) };
}

/** Runs every source module, merges, validates, and writes only if valid. */
export async function buildCatalogue({ config, sourcesDir = SOURCES_DIR, outFile = CATALOG_FILE }) {
  const files = existsSync(sourcesDir)
    ? readdirSync(sourcesDir).filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && !f.endsWith(".test.mjs")).sort()
    : [];
  if (!files.length) return { ok: false, problems: [`no source modules in ${sourcesDir}. Copy _template.mjs and write one for this client.`], catalog: null };

  const results = [];
  for (const file of files) {
    const load = (await import(pathToFileURL(path.join(sourcesDir, file)).href)).default;
    results.push(await load());
  }
  const catalog = mergeSources(results);
  const problems = validateCatalog(catalog, { tracksInventory: config.tracksInventory });
  if (problems.length) return { ok: false, problems, catalog };

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`);
  return { ok: true, problems: [], catalog };
}
```

- [ ] **Step 4: Add the template, the shared config loader, and the ignore rule**

```js
// scripts/catalogue/sources/_template.mjs
/**
 * A source module turns ONE client input (a vendor feed, a sheet, a scrape) into
 * the catalogue shape documented in ../format.mjs. Copy this file to a name that
 * does not start with `_`, e.g. `acme-feed.mjs`, and fill it in.
 *
 * Rules:
 *  - Pure and offline: read files from data/feeds/, never call the network.
 *  - Return { collections, products }. Do not validate here; the build does.
 *  - Keep the vendor's exact wording for display; normalise only for filtering.
 *  - Unit-test it next to this file as <name>.test.mjs against REAL rows from the feed.
 *
 * Read docs/catalogue-import.md before writing one.
 */
import { readFileSync } from "node:fs";

export default async function load() {
  const rows = JSON.parse(readFileSync("data/feeds/example.json", "utf8"));
  return {
    collections: [],
    products: rows.map((row) => ({
      handle: row.slug,
      title: row.name,
      variants: [{ sku: row.sku, price: String(row.price) }],
    })),
  };
}
```

```js
// scripts/setup/config.mjs
import { existsSync, readFileSync } from "node:fs";
import { validateConfig } from "./intake.mjs";
import { bad, info, warn } from "../shopify/env.mjs";

export const CONFIG_FILE = "store-setup.config.json";

/** Exits with a readable message instead of a stack trace: these are human errors. */
export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    bad(`${CONFIG_FILE} not found. The intake step has not been done.`);
    process.exit(1);
  }
  const result = validateConfig(JSON.parse(readFileSync(CONFIG_FILE, "utf8")));
  if (!result.ok) {
    bad(`${CONFIG_FILE} is invalid:`);
    result.errors.forEach((e) => info(e));
    process.exit(1);
  }
  if (result.assumed.length) warn(`assumed from the ${result.config.profile} profile: ${result.assumed.join(", ")}. Tell the human.`);
  return result.config;
}
```

In `scripts/setup/cli.mjs` delete the local `CONFIG_FILE` constant and `loadConfig` function and add `import { loadConfig } from "./config.mjs";`. Append `/data/catalog.json` to `.gitignore`.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm test:scripts && node --check scripts/setup/cli.mjs && pnpm -s shop-setup status | head -2`
Expected: tests pass; the CLI still starts.

- [ ] **Step 6: Commit**

```bash
git add scripts/catalogue scripts/setup .gitignore
git commit -m "feat(catalogue): source modules merge into a validated data/catalog.json"
```

---

### Task 8: CLI commands, registry, runbook and docs

**Files:**
- Modify: `scripts/setup/cli.mjs`, `scripts/setup/steps.mjs`, `scripts/setup/steps.test.mjs`, `.claude/skills/shopify-store-setup/SKILL.md`
- Create: `docs/catalogue-import.md`, `docs/shopify-api-gotchas.md`

**Interfaces:**
- Produces: `pnpm shop-setup catalogue-build | catalogue [--dry-run] [--limit=N] [--only=collections|products] [--skip-images] [--location=<id>] | catalogue-verify | inventory-check`.

- [ ] **Step 1: Write the failing registry test**

Append to `scripts/setup/steps.test.mjs`:

```js
test("catalogue and inventory name the commands that do them", () => {
  assert.equal(byId.catalogue.automation, "catalogue");
  assert.match(byId.catalogue.instructions, /pnpm shop-setup catalogue-build/);
  assert.match(byId.catalogue.instructions, /catalogue-verify/);
  assert.equal(byId.inventory.automation, "inventory-check");
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm test:scripts`

- [ ] **Step 3: Update the registry**

In `scripts/setup/steps.mjs` replace the `catalogue` step's `instructions` and add an `automation` field, and the same for `inventory`:

```js
  {
    id: "catalogue",
    title: "Get the products into Shopify and published to the Headless channel",
    owner: "api",
    needs: ["preflight", "intake"],
    instructions:
      "Write a source module for this client (copy scripts/catalogue/sources/_template.mjs; read docs/catalogue-import.md first and report real counts to the owner before deciding variant grouping). Then: pnpm shop-setup catalogue-build, pnpm shop-setup catalogue --dry-run, pnpm shop-setup catalogue --limit=3 and look at them in the Admin, pnpm shop-setup catalogue, then pnpm shop-setup catalogue-verify. A re-run updates, never duplicates. Mark done only when catalogue-verify reports no problems.",
    automation: "catalogue",
  },
  {
    id: "inventory",
    title: "Apply the stock decision",
    owner: "api",
    needs: ["catalogue", "intake"],
    instructions:
      "The push applies config.tracksInventory to every variant. If tracked, the owner must supply real quantities in the source data. Run pnpm shop-setup inventory-check to read the flags back from Shopify. If not tracked, tell the owner out loud that nothing will ever show sold out.",
    automation: "inventory-check",
  },
```

(Keep their current position in the list; only replace the objects.)

- [ ] **Step 4: Add the CLI commands**

In `scripts/setup/cli.mjs` add imports:

```js
import { existsSync, readFileSync } from "node:fs"; // already imported
import { buildCatalogue, CATALOG_FILE } from "../catalogue/build.mjs";
import { pushCatalogue } from "../catalogue/push.mjs";
import { compareToCatalogue, fetchStorefront, summarise } from "../catalogue/verify.mjs";
import { fetchVariantTracking, inventoryMismatches } from "../catalogue/inventory.mjs";
import { versionStatus } from "../shopify/version.mjs";
import { shopifyEnv } from "../shopify/env.mjs";
```

(only add what is not already imported) and these cases before `case "e2e"`:

```js
  case "catalogue-build": {
    const result = await buildCatalogue({ config: loadConfig() });
    if (!result.ok) {
      result.problems.slice(0, 40).forEach((p) => bad(p));
      process.exit(1);
    }
    ok(`wrote data/catalog.json: ${result.catalog.collections.length} collections, ${result.catalog.products.length} products, ${result.catalog.products.reduce((n, p) => n + p.variants.length, 0)} variants`);
    break;
  }
  case "catalogue": {
    if (!existsSync(CATALOG_FILE)) {
      bad("data/catalog.json not found. Run: pnpm shop-setup catalogue-build");
      process.exit(1);
    }
    const catalog = JSON.parse(readFileSync(CATALOG_FILE, "utf8"));
    await pushCatalogue({
      config: loadConfig(),
      catalog: { collections: catalog.collections ?? [], products: catalog.products ?? [] },
      dryRun: flags["dry-run"] === true,
      limit: flags.limit ? Number(flags.limit) : undefined,
      only: flags.only,
      skipImages: flags["skip-images"] === true,
      locationId: flags.location,
    });
    break;
  }
  case "catalogue-verify": {
    const catalog = JSON.parse(readFileSync(CATALOG_FILE, "utf8"));
    const seen = await fetchStorefront();
    const summary = summarise(seen.products, seen.collections);
    info(`storefront serves ${summary.products} products, ${summary.variants} variants, ${summary.collections} collections, ${summary.withImage} with an image`);
    const version = versionStatus(shopifyEnv().apiVersion, seen.served);
    (version.ok ? ok : warn)(version.note);
    const problems = compareToCatalogue({ handles: seen.products.map((p) => p.handle), summary }, catalog);
    problems.forEach((p) => bad(p));
    if (problems.length) process.exit(1);
    ok("the storefront serves what was pushed");
    break;
  }
  case "inventory-check": {
    const config = loadConfig();
    const problems = inventoryMismatches(await fetchVariantTracking(), config.tracksInventory);
    problems.forEach((p) => bad(p));
    if (problems.length) process.exit(1);
    ok(`stock tracking matches the config (tracksInventory=${config.tracksInventory})`);
    if (!config.tracksInventory) warn("nothing is tracked: no product will ever show sold out. The owner must know this.");
    break;
  }
```

Update the usage string to list the four new commands.

- [ ] **Step 5: Write the agent docs**

`docs/catalogue-import.md` (the agent reads this before writing a source module):

````markdown
# Building the catalogue

Turn whatever the client has (a vendor feed, a sheet, a scrape, photos) into one
source module under `scripts/catalogue/sources/`. Then `pnpm shop-setup
catalogue-build` merges and validates it into `data/catalog.json`, and the push
tools take it from there. The shape and every rule are in
`scripts/catalogue/format.mjs`; do not invent a second contract.

Copy feeds into `data/feeds/` (not `~/Downloads`) so the build is reproducible.

## Read the data before you plan anything

Report real numbers back to the owner first: counts, distinct values, which
fields are populated, which are junk. "57 rows collapse to 41 products, 9 with
colour variants, every group price-uniform" is a contract you can verify;
"products.json contains products" is not. It also surfaces the decisions only
the owner can make.

## What dirty feeds do

- **One concept spelled several ways.** `Antique Grey`, `Mixed Grey`, a Greek
  word for grey are all grey. Normalise for filtering, keep the vendor's wording
  for display.
- **Homoglyphs.** A Latin `K` inside a Greek word looks identical and silently
  splits one product in two. Scan for Latin letters next to non-Latin ones
  before trusting any grouping.
- **A field whose type varies by source.** One feed's `images[]` is strings,
  another's is objects. The validator rejects non-string images.
- **Marketing junk in tags.** Scraped tags are usually other products' names.
  Discard them and derive a small tag set you control.
- **Outbound links in descriptions.** Vendor text often links back to the
  vendor's shop. Strip anchors and keep the text. The validator rejects them.
- **Contradictory categories.** Pick a precedence, document it, and list the
  affected products for the owner instead of choosing silently.
- **Fake sale prices.** A compare-at price is a claim the item sold at that
  price. Only set it when the owner confirmed it is real
  (`compareAtIsReal` in the config).

## Decisions to ask, not guess

- **Variant grouping.** `Sofa 2-seat Brown` and `Sofa 3-seat Brown`: one product
  with two options, or two products with a colour option? Grouping so price stays
  uniform inside a product shows one price on the card. Verify price uniformity
  in every proposed group before recommending it.
- **How many filter values a shopper sees.** About ten colour families filter
  well; nineteen raw spellings give chips that each match one product. Products
  with no real value (made-to-order furniture has no colour) need an explicit
  value like "Made to order" or they vanish when anyone filters.

## Descriptions

Normalise to a small tag set (`p br strong em ul ol li h3 h4 table tr th td img
figure hr blockquote`). Handle structured HTML with cruft (strip classes and
unknown tags) and `<br>` soup (split on blank lines; a block whose first line
ends in `:` is a heading). Descriptions go into `descriptionHtml`.

## Images

Shopify fetches the URL you give it. Some vendor CDNs answer Shopify's fetcher
with a 403 while serving browsers fine: media shows `FAILED` and the product has
no pictures. Those need the file downloaded and re-uploaded
(`stagedUploadsCreate`, then `fileCreate`). That tooling is a later plan; until
then, list the products with failed media for the owner. Image processing is
asynchronous: a clean `productSet` does not mean the pictures landed.

## Testing a source

Unit-test it next to the module with `node --test`, against REAL rows. Assert
exact counts derived from the real feed (products, variants, how many have more
than one variant). When a test fails, work out which side is wrong; an
expectation written from a guess is worth less than the implementation.

## The CSV shortcut

Shopify's Products > Import takes a CSV and suits a small hand-kept catalogue. It
allows one collection per product, sets no metafields, and is not usefully
idempotent. Products must still be published to the Headless channel afterwards.
````

`docs/shopify-api-gotchas.md`:

````markdown
# Shopify API gotchas

Exact error text, because that is what gets searched. Introspect before trusting
any shape here: `node scripts/shopify/introspect.mjs <InputTypeName>`.

## Versions

### The store "works" but behaves differently from what was tested
An expired API version is not rejected: Shopify silently serves the oldest
supported one and sets `X-Shopify-API-Version`. `pnpm shop-setup preflight` and
`catalogue-verify` compare requested against served. The SDK in `src/lib/shopify`
defaults to `2025-01`, which is expired; that default is the owner's decision.

### `inventorySetQuantities` fails from 2026-04 without an `@idempotent` key
That mutation requires the directive from API version 2026-04. Unknown for
`productSet` with `inventoryQuantities`: the first live call answers it. Record
the answer here.

## Auth

### "Invalid API key or access token (unrecognized login or wrong password)"
Wrong token family. Only `shpat_` talks to the Admin API; the Headless channel
gives Storefront tokens, which cannot write.

### "Service is not valid for authentication"
An `atkn_` app-automation token against the store Admin API. Valid, but for App
Management only.

### "Access denied for products field"
The token lacks the scope. List what was granted:
`GET https://<store>.myshopify.com/admin/oauth/access_scopes.json`. Scopes apply
at install: add them, release a new app version, **and reinstall**.

## Visibility

### Admin shows products, the storefront shows none
They were never published. Both products and collections need
`publishablePublish` to every publication, including Headless. `catalogue`
does this; `catalogue-verify` proves it.

### Storefront API returns `null` for every metafield
The definition lacks storefront visibility: `access: { storefront: "PUBLIC_READ" }`.
The most common cause of an empty filter UI.

## Writes

### A write "succeeds" and nothing changed
Shopify returns most failures as HTTP 200 with a populated `userErrors` array.
`adminGraphQL` walks the response and throws on any.

### `identifier` is a mutation argument, not an input field
`productSet(identifier: {handle: "x"}, input: {...}, synchronous: true)` is the
idempotent create-or-update.

### List metafields are JSON-encoded strings
`{ type: "list.single_line_text_field", value: "[\"a\",\"b\"]" }`. The validator
rejects a bare string.

### Only some products have images
Per-product media failures do not fail the mutation. Look at `media { status }`
in the Admin API.

## Collections

Collections are flat. Express a tree with a `custom.parent` metafield holding the
parent handle and rebuild it in the frontend.

## Throttling

Admin API uses a leaky bucket. `adminGraphQL` reads
`extensions.cost.throttleStatus`, backs off, and retries `THROTTLED`.

## Discounts

Only one automatic discount applies per order. For per-product sale pricing use
`compareAtPrice`, which has no stacking limit.
````

In `.claude/skills/shopify-store-setup/SKILL.md` add, before `## Intake first`:

```markdown
## Catalogue

Read `docs/catalogue-import.md` first, then follow the `catalogue` step in the registry. Report real counts from the feed to the owner before choosing variant grouping or filters. `catalogue-verify` is the only proof the products arrived; the Admin API saying they exist is not. If it reports a mismatch, fix the source module or the publishing, never edit the store by hand to match. `docs/shopify-api-gotchas.md` has the exact error text for every trap met so far; add new ones with the exact message.
```

- [ ] **Step 6: Run, expect PASS and smoke the CLI**

Run: `pnpm test:scripts && pnpm -s lint | tail -3`
Run: `pnpm -s shop-setup catalogue --dry-run; echo "exit=$?"`
Expected: tests pass; with no `data/catalog.json` the command prints `data/catalog.json not found. Run: pnpm shop-setup catalogue-build` and exits 1.
Run: `pnpm -s shop-setup catalogue-build; echo "exit=$?"`
Expected: with no config, prints the missing-config message and exits 1 (no stack trace).

- [ ] **Step 7: Commit**

```bash
git add scripts docs .claude
git commit -m "feat(catalogue): CLI commands, registry wiring, runbook section and agent docs"
```

---

### Task 9: Verification gate (human-assisted)

- [ ] **Step 1: Repo gates**

Run: `pnpm test:scripts && pnpm lint && pnpm build`
Expected: all pass. Report real output.

- [ ] **Step 2: Offline end-to-end with a fixture source**

Copy `scripts/catalogue/sources/_template.mjs` to a temporary `scripts/catalogue/sources/fixture.mjs`, put a 3-row `data/feeds/example.json` next to it, copy `store-setup.config.example.json` to `store-setup.config.json`, then:

```bash
pnpm shop-setup catalogue-build
pnpm shop-setup catalogue --dry-run
```

Expected: build writes `data/catalog.json` with 3 products; dry run lists them and writes nothing. Delete the fixture source, the feed and the config afterwards.

- [ ] **Step 3: Development-store run (the only proof for the push)**

Needs a development store with `.env.local` set and the Step 1 introspection of Task 4 done.

```bash
pnpm shop-setup preflight
pnpm shop-setup catalogue --limit=3
pnpm shop-setup catalogue
pnpm shop-setup catalogue-verify
pnpm shop-setup inventory-check
pnpm shop-setup catalogue            # second run: must update, not duplicate
pnpm shop-setup catalogue-verify     # counts unchanged
```

Expected: preflight reports a served version equal to the requested one; `catalogue-verify` reports no problems; the second run leaves counts unchanged. Open one product in the Admin and one on the frontend with a real browser.

- [ ] **Step 4: Record the outcome**

State plainly: verified on a development store, or "catalogue push unverified: no development store was available". Record any `@idempotent` finding and any schema difference in `docs/shopify-api-gotchas.md`.

---

## Follow-on plans (not in this plan)

1. **Metafield and metaobject definitions** (filters, swatches), with `access: { storefront: "PUBLIC_READ" }` asserted after creation, plus the Search & Discovery browser step.
2. **Image rehosting** for sources that block Shopify's fetcher, with an on-disk URL map.
3. **Redirect snippet, email templates, click-by-click browser steps** (from the foundation plan's list).
4. **SDK API version bump**, once the owner decides: move `src/lib/shopify` off `2025-01` and re-test every query on the new version.

## Self-review

- **Spec coverage:** format and validator (Task 2); builder (3); idempotent push, publishing to every channel (4); storefront proof (5); stock read-back and single source of truth for stock (3, 6, validator in 2); client-specific sources via a template plus build (7); CLI, registry, runbook and agent docs (8); live verification and the unverified list (9); expired-API-version guard (1).
- **Placeholders:** none in code steps. Unknowns are named, not hidden: live `productSet` shapes (Task 4 Step 1), whether `productSet` needs `@idempotent`, Storefront variant paging beyond 100.
- **Type consistency:** `validateCatalog(catalog, { tracksInventory })`, `buildProductInput(product, { collectionIds, locationId, tracksInventory, skipImages })`, `pushCatalogue({ config, catalog, dryRun, limit, only, skipImages, locationId })`, `summarise` / `compareToCatalogue({ handles, summary }, catalog)`, `inventoryMismatches(variants, tracksInventory)`, `buildCatalogue({ config, sourcesDir, outFile })` and `loadConfig()` are used with the same names and shapes in the tasks and the CLI.
