# Kit Fixes From the First Agent Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps a fresh agent hit when it connected a realistic received frontend to Shopify using only this kit, so the next agent finds tested pieces instead of writing its own.

**Architecture:** New SDK modules beside the existing ones in `src/lib/shopify/` (paged reads, content reads, menu links, variant helpers, a framework-free cart store with a thin React provider). All new GraphQL documents live in `queries.ts` so `validate-queries` covers them. The frontend audit and check learn to see non-product hardcoded content, fake payment forms, unused files and Shopify-backed routes. `kit-install` ships error pages and a `CLAUDE.md` pointer. The wiring guide and the connect skill describe the new pieces. A second rehearsal is the gate.

**Tech Stack:** TypeScript SDK (Next.js 16.3.4, React 19.2.8), Node ESM `.mjs` tooling, `node --test`, no new dependencies.

**Spec:** The rehearsal log of 2026-10-07 (34 entries), kept as an appendix at the end of this plan: findings are cited as `R<n>`. The owner asked (chat, 2026-10-07): "make the kit better so when we have the project the agent can use it", rehearsal first, then add the pieces it shows are missing.

## Global Constraints

- No new npm dependencies. Tests use `node:test`; run with `pnpm test:scripts`.
- Nothing hardcoded (memory `nothing-hardcoded`): every product, price, currency, image, menu link, policy and store claim comes from Shopify. When Shopify cannot supply it, the frontend hides it and the agent lists it for the owner.
- Every new GraphQL document is an exported `const ...Query` string in `src/lib/shopify/queries.ts`, and `pnpm shop-setup validate-queries` must report all documents valid against both `2026-07` and `2026-10` (`SHOPIFY_STOREFRONT_API_VERSION=2026-10 pnpm shop-setup validate-queries`).
- Catalogue and content reads throw on failure (`ShopifyError`). They never return a made-up or empty answer in place of an error.
- The SDK never runs in the browser except `cart-client.ts`, `cart-store.ts`, `cart-provider.tsx`, `variants.ts`, `menu.ts` and `money.ts`, which must import nothing server-only (no `client.ts`, `config.ts`, `index.ts`).
- Plain words in every message a human reads.
- Existing exported function names and return types stay as they are (received frontends may already use them). New behaviour arrives as new functions.
- `pnpm build` and `pnpm lint` pass in the kit repo after every task that touches `src/`.
- Nothing is "verified" until it ran against mock.shop in the rehearsal (Task 11), and against a development store later. Say "unverified" otherwise.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/shopify/index.ts` | `predictiveSearch` throws; paged reads; re-exports new modules | 1, 2, 3 |
| `src/app/api/search/route.ts` | returns `{ error }` on failure | 1 |
| `src/lib/shopify/config.ts` | stale comment | 1 |
| `scripts/catalogue/verify.mjs`, `verify-flow.test.mjs` | hermetic token test | 1 |
| `src/lib/shopify/queries.ts` | all new documents | 2, 3, 5 |
| `src/lib/shopify/types.ts` | new types | 2, 3, 5 |
| `src/lib/shopify/variants.ts` (new) | `findVariant`, `defaultVariant` | 4 |
| `src/lib/shopify/content.ts` (new) | `getShop`, `getMenu`, `getPolicies`, `getPolicy`, `getPage` | 5 |
| `src/lib/shopify/menu.ts` (new) | `menuLinks` | 5 |
| `src/lib/shopify/cart-store.ts` (new) | `createCartStore`, `cartLines` | 6 |
| `src/lib/shopify/cart-provider.tsx` (new) | `CartProvider`, `useCart` | 6 |
| `scripts/frontend/kit.mjs` | copy `.tsx` SDK files; gitignore; CLAUDE.md; error pages | 6, 9 |
| `scripts/frontend/templates.mjs` (new) | error page sources | 9 |
| `scripts/frontend/audit.mjs`, `sources.mjs` | money matches, payment form, site data, unused files, Shopify-backed routes | 7 |
| `scripts/frontend/check.mjs`, `scripts/setup/cli.mjs` | new checks, `--site` smoke | 8 |
| `docs/frontend-wiring.md`, `.claude/skills/shopify-connect-frontend/SKILL.md`, `README.md` | how to use all of the above | 10 |

---

### Task 1: Three small kit bugs (R25, R27, R28)

**Files:**
- Modify: `src/lib/shopify/index.ts` (`predictiveSearch`, ~line 235-282), `src/app/api/search/route.ts`, `src/lib/shopify/config.ts:56`, `scripts/catalogue/verify.mjs:~50-55`, `scripts/catalogue/verify-flow.test.mjs:43-49`
- Test: `scripts/shopify/sdk-live.test.mjs`, `scripts/catalogue/verify-flow.test.mjs`

**Interfaces:**
- Produces: `predictiveSearch(query, options)` throws `ShopifyError` when Shopify fails (an empty query still returns the empty result without a request). `GET /api/search` answers `{ error: string }` with status 502 on failure.
- Produces: `fetchStorefront({ env } = {})` in `scripts/catalogue/verify.mjs` takes an optional `env` object (the shape `shopifyEnv()` returns); default `shopifyEnv()`.

- [ ] **Step 1: Failing tests**

In `scripts/shopify/sdk-live.test.mjs` add:

```js
test("predictiveSearch: a failed Shopify request throws instead of showing no results", async () => {
  stubFetch(shopifyDown);
  await assert.rejects(sdk.predictiveSearch("shirt"), sdk.ShopifyError);
});

test("predictiveSearch: an empty query makes no request", async () => {
  stubFetch(() => json({}));
  const result = await sdk.predictiveSearch("  ");
  assert.equal(calls.length, 0);
  assert.deepEqual(result.products, []);
});
```

In `scripts/catalogue/verify-flow.test.mjs` replace the body of "a missing token is a readable error before any request":

```js
test("a missing token is a readable error before any request", async () => {
  const shop = fakeStorefront();
  mock.method(globalThis, "fetch", shop.handler);
  // Pass the settings in, so a real .env.local in the repo cannot fill the token.
  await assert.rejects(fetchStorefront({ env: { domain: "x.myshopify.com", apiVersion: "2026-07", storefrontToken: "" } }), /public Storefront token/);
  assert.equal(shop.seen.length, 0);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm test:scripts 2>&1 | grep -E "^not ok|✖" | head`
Expected: the predictiveSearch failure test fails (it resolves with an empty result). Then prove the env bug: `printf 'NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=x\nNEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=mock.shop\n' > .env.local && pnpm test:scripts 2>&1 | grep -c "^not ok"; rm .env.local` shows at least 1 failure before the fix.

- [ ] **Step 3: Fix**

`predictiveSearch`: delete the `try { ... } catch (err) { ...; return emptyResult; }` wrapper so the `shopifyFetch` error propagates; keep the early `return emptyResult` for a blank query.

`src/app/api/search/route.ts`, the catch block:

```ts
  } catch (error) {
    console.error("[Search Route Error]:", error);
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
```

`src/lib/shopify/config.ts:56`: replace "If false, the integration falls back gracefully to mock catalog data." with "If false, every catalogue read throws and says which settings to add (mock.shop works for development)."

`scripts/catalogue/verify.mjs`: change the storefront fetch function to `export async function fetchStorefront({ env = shopifyEnv() } = {})` and pass `env` down to the request helper instead of calling `shopifyEnv()` again inside it (the request helper at ~line 37 takes `env` as a parameter).

- [ ] **Step 4: Run all tests, with and without `.env.local`**

Run: `pnpm test:scripts 2>&1 | tail -6`, then with the temporary `.env.local` from Step 2, then delete it.
Expected: 0 failures both times.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopify/index.ts src/app/api/search/route.ts src/lib/shopify/config.ts scripts/catalogue/verify.mjs scripts/catalogue/verify-flow.test.mjs scripts/shopify/sdk-live.test.mjs
git commit -m "fix(sdk): search reports Shopify failures, the token test ignores .env.local, drop the mock-data comment"
```

---

### Task 2: Paged product reads, collection filters and a search results page (R8)

**Files:**
- Modify: `src/lib/shopify/queries.ts`, `src/lib/shopify/types.ts`, `src/lib/shopify/index.ts`
- Test: create `scripts/shopify/sdk-pages.test.mjs`

**Interfaces:**
- Produces (types.ts):

```ts
export interface ProductFilterInput {
  available?: boolean;
  price?: { min?: number; max?: number };
  productType?: string;
  productVendor?: string;
  tag?: string;
  variantOption?: { name: string; value: string };
  productMetafield?: { namespace: string; key: string; value: string };
}

export interface FilterValue {
  id: string;
  label: string;
  count: number;
  /** JSON string: pass JSON.parse(input) back as one ProductFilterInput. */
  input: string;
  swatch?: { color: string | null; image: { previewImage: ShopifyImage | null } | null } | null;
}

export interface Filter {
  id: string;
  label: string;
  type: "LIST" | "PRICE_RANGE" | "BOOLEAN";
  values: FilterValue[];
}

export interface ProductPage {
  products: Product[];
  pageInfo: PageInfo;
  /** Filters Shopify offers for this list (empty for getProductsPage). */
  filters: Filter[];
  /** Only for searchProducts. */
  totalCount?: number;
}

export type SearchSortKey = "RELEVANCE" | "PRICE";
```

  `GetCollectionProductsOptions` gains `filters?: ProductFilterInput[]`. New `SearchProductsOptions { query: string; limit?: number; cursor?: string; sortKey?: SearchSortKey; reverse?: boolean; filters?: ProductFilterInput[]; cache?: RequestCache; revalidate?: number }`.
- Produces (index.ts): `getProductsPage(options?: GetProductsOptions): Promise<ProductPage>`, `getCollectionProductsPage(options: GetCollectionProductsOptions): Promise<ProductPage | null>` (null when the collection does not exist), `searchProducts(options: SearchProductsOptions): Promise<ProductPage>`. `getProducts` and `getCollectionProducts` keep their signatures and return `(await ...Page()).products` (`?.products ?? []` for the collection).
- Produces (queries.ts): `getCollectionProductsQuery` gains `$filters: [ProductFilter!]` passed to `products(filters: $filters)` and selects `filters { ...FilterFragment }`; new `filterFragment` and `searchProductsQuery`.

- [ ] **Step 1: Failing tests** (`scripts/shopify/sdk-pages.test.mjs`)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN = "public-test-token";
const sdk = await loadSdk();

let sent;
function answer(data) {
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
}
const pageInfo = { hasNextPage: true, hasPreviousPage: false, startCursor: "s", endCursor: "e" };
const product = { id: "gid://shopify/Product/1", handle: "a" };
const filter = { id: "filter.v.option.color", label: "Color", type: "LIST", values: [{ id: "x", label: "Green", count: 3, input: '{"variantOption":{"name":"color","value":"Green"}}' }] };

test("getProductsPage returns the products and the cursor for the next page", async () => {
  answer({ products: { pageInfo, edges: [{ cursor: "c", node: product }] } });
  const page = await sdk.getProductsPage({ limit: 12, cursor: "prev" });
  assert.deepEqual(page.products, [product]);
  assert.equal(page.pageInfo.endCursor, "e");
  assert.deepEqual(page.filters, []);
  assert.equal(sent.variables.after, "prev");
});

test("getCollectionProductsPage sends the filters and returns Shopify's filter list", async () => {
  answer({ collection: { products: { pageInfo, filters: [filter], edges: [{ cursor: "c", node: product }] } } });
  const page = await sdk.getCollectionProductsPage({ handle: "men", filters: [{ available: true }, { variantOption: { name: "color", value: "Green" } }] });
  assert.deepEqual(sent.variables.filters, [{ available: true }, { variantOption: { name: "color", value: "Green" } }]);
  assert.equal(page.filters[0].label, "Color");
  assert.equal(page.pageInfo.hasNextPage, true);
});

test("getCollectionProductsPage is null for a collection that does not exist", async () => {
  answer({ collection: null });
  assert.equal(await sdk.getCollectionProductsPage({ handle: "nope" }), null);
});

test("getCollectionProducts still returns a plain array", async () => {
  answer({ collection: { products: { pageInfo, filters: [], edges: [{ cursor: "c", node: product }] } } });
  assert.deepEqual(await sdk.getCollectionProducts({ handle: "men" }), [product]);
});

test("searchProducts returns products only, with the total and the filters", async () => {
  answer({ search: { totalCount: 29, pageInfo, productFilters: [filter], edges: [{ cursor: "c", node: { __typename: "Product", ...product } }] } });
  const page = await sdk.searchProducts({ query: "shirt", limit: 2 });
  assert.equal(page.totalCount, 29);
  assert.equal(page.products[0].handle, "a");
  assert.equal(page.filters.length, 1);
  assert.equal(sent.variables.query, "shirt");
});

test("paged reads throw when Shopify fails", async () => {
  globalThis.fetch = async () => new Response("down", { status: 500 });
  await assert.rejects(sdk.getProductsPage(), sdk.ShopifyError);
  await assert.rejects(sdk.searchProducts({ query: "x" }), sdk.ShopifyError);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test scripts/shopify/sdk-pages.test.mjs`
Expected: FAIL, `sdk.getProductsPage is not a function`.

- [ ] **Step 3: Implement**

`queries.ts`, add after `collectionFragment`:

```ts
export const filterFragment = /* GraphQL */ `
  fragment FilterFragment on Filter {
    id
    label
    type
    values {
      id
      label
      count
      input
      swatch {
        color
        image {
          previewImage {
            ...ImageFragment
          }
        }
      }
    }
  }
`;
```

Replace `getCollectionProductsQuery`:

```ts
export const getCollectionProductsQuery = /* GraphQL */ `
  query GetCollectionProducts(
    $handle: String!
    $first: Int = 20
    $after: String
    $sortKey: ProductCollectionSortKeys = COLLECTION_DEFAULT
    $reverse: Boolean = false
    $filters: [ProductFilter!]
  ) {
    collection(handle: $handle) {
      products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        filters {
          ...FilterFragment
        }
        edges {
          cursor
          node {
            ...ProductFragment
          }
        }
      }
    }
  }
  ${dedupeFragments(productFragment + filterFragment)}
`;
```

`dedupeFragments` is declared further down the file; move its definition above `getProductsQuery` so it exists before first use (it is a function declaration, so hoisting already makes it callable, but keep it near the top for readers).

Add:

```ts
export const searchProductsQuery = /* GraphQL */ `
  query SearchProducts(
    $query: String!
    $first: Int = 20
    $after: String
    $sortKey: SearchSortKeys = RELEVANCE
    $reverse: Boolean = false
    $filters: [ProductFilter!]
  ) {
    search(query: $query, first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, types: [PRODUCT], productFilters: $filters, unavailableProducts: LAST) {
      totalCount
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      productFilters {
        ...FilterFragment
      }
      edges {
        cursor
        node {
          __typename
          ... on Product {
            ...ProductFragment
          }
        }
      }
    }
  }
  ${dedupeFragments(productFragment + filterFragment)}
`;
```

`filterFragment` uses `ImageFragment` without embedding it, so it is only valid next to `productFragment` (which embeds `imageFragment`). Say so in a comment above `filterFragment`.

`index.ts`: import `searchProductsQuery`, the new types, and add:

```ts
type Edges<T> = { pageInfo: PageInfo; edges: Array<{ node: T }>; filters?: Filter[] };

/** One page of products plus what the next page needs. */
export async function getProductsPage(options?: GetProductsOptions): Promise<ProductPage> {
  requireShopify();
  const res = await shopifyFetch<{ products: Edges<Product> }>({
    query: getProductsQuery,
    variables: {
      first: options?.limit || 20,
      after: options?.cursor,
      query: options?.query,
      sortKey: options?.sortKey || "RELEVANCE",
      reverse: options?.reverse || false,
    },
    cache: options?.cache ?? CATALOGUE_CACHE,
    tags: ["products"],
    revalidate: options?.revalidate,
  });
  const conn = res.body.data!.products;
  return { products: conn.edges.map((e) => e.node), pageInfo: conn.pageInfo, filters: [] };
}

/** One page of a collection's products, with the filters Shopify offers for it. Null when the collection does not exist. */
export async function getCollectionProductsPage(options: GetCollectionProductsOptions): Promise<ProductPage | null> {
  requireShopify();
  const res = await shopifyFetch<{ collection: { products: Edges<Product> } | null }>({
    query: getCollectionProductsQuery,
    variables: {
      handle: options.handle,
      first: options.limit || 20,
      after: options.cursor,
      sortKey: options.sortKey || "COLLECTION_DEFAULT",
      reverse: options.reverse || false,
      filters: options.filters,
    },
    cache: options.cache ?? CATALOGUE_CACHE,
    tags: ["collections", `collection-${options.handle}`, "products"],
    revalidate: options.revalidate,
  });
  const conn = res.body.data?.collection?.products;
  if (!conn) return null;
  return { products: conn.edges.map((e) => e.node), pageInfo: conn.pageInfo, filters: conn.filters ?? [] };
}

/** A full search results page: products only, with the total and Shopify's filters. */
export async function searchProducts(options: SearchProductsOptions): Promise<ProductPage> {
  requireShopify();
  const res = await shopifyFetch<{
    search: { totalCount: number; pageInfo: PageInfo; productFilters: Filter[]; edges: Array<{ node: Product & { __typename: string } }> };
  }>({
    query: searchProductsQuery,
    variables: {
      query: options.query,
      first: options.limit || 20,
      after: options.cursor,
      sortKey: options.sortKey || "RELEVANCE",
      reverse: options.reverse || false,
      filters: options.filters,
    },
    cache: options.cache ?? CATALOGUE_CACHE,
    tags: ["products"],
    revalidate: options.revalidate,
  });
  const s = res.body.data!.search;
  return {
    products: s.edges.map((e) => e.node).filter((n) => n.__typename === "Product"),
    pageInfo: s.pageInfo,
    filters: s.productFilters,
    totalCount: s.totalCount,
  };
}
```

Then make `getProducts` return `(await getProductsPage(options)).products` and `getCollectionProducts` return `(await getCollectionProductsPage(options))?.products ?? []`. Check how `shopifyFetch` reports a missing `data` (read `client.ts`); if it can return a body without `data` on success, replace the `!` with an explicit `throw new ShopifyError("Shopify returned no data", 502)`.

- [ ] **Step 4: Tests, schema, build**

Run: `node --test scripts/shopify/sdk-pages.test.mjs && pnpm test:scripts 2>&1 | tail -4 && pnpm shop-setup validate-queries && SHOPIFY_STOREFRONT_API_VERSION=2026-10 pnpm shop-setup validate-queries && pnpm build && pnpm lint`
Expected: all pass; validate-queries lists `searchProductsQuery` as `[ok]`. If the schema rejects a field name, fix the document (never the test's expectations about behaviour).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopify scripts/shopify/sdk-pages.test.mjs
git commit -m "feat(sdk): paged product reads with Shopify's filters, and a search results page"
```

---

### Task 3: Product page extras: swatches, subscriptions, extra fields, stock (R13, R15, R16, R17)

**Files:**
- Modify: `src/lib/shopify/queries.ts`, `src/lib/shopify/types.ts`, `src/lib/shopify/index.ts` (`getProduct`, new `getProductStock`)
- Test: create `scripts/shopify/sdk-product-extras.test.mjs`; extend `scripts/shopify/sdk-documents.test.mjs`

**Interfaces:**
- Produces (types.ts):

```ts
export interface ProductOptionValue {
  id: string;
  name: string;
  swatch: { color: string | null; image: { previewImage: ShopifyImage | null } | null } | null;
}
// ProductOption gains: optionValues: ProductOptionValue[];

export interface Metafield { namespace: string; key: string; type: string; value: string }
export interface MetafieldIdentifier { namespace: string; key: string }

export interface SellingPlan {
  id: string;
  name: string;
  description: string | null;
  recurringDeliveries: boolean;
  priceAdjustments: Array<{
    orderCount: number | null;
    adjustmentValue:
      | { __typename: "SellingPlanPercentagePriceAdjustment"; adjustmentPercentage: number }
      | { __typename: "SellingPlanFixedAmountPriceAdjustment"; adjustmentAmount: Money }
      | { __typename: "SellingPlanFixedPriceAdjustment"; price: Money };
  }>;
}
export interface SellingPlanGroup { name: string; options: Array<{ name: string; values: string[] }>; sellingPlans: { nodes: SellingPlan[] } }

// Product gains optional detail-only fields:
//   requiresSellingPlan?: boolean;
//   sellingPlanGroups?: { nodes: SellingPlanGroup[] };
//   metafields?: Array<Metafield | null>;
```

- Produces (index.ts): `getProduct(handle, options?: { cache?; revalidate?; metafields?: MetafieldIdentifier[] })`: same return type, now with `sellingPlanGroups`, `requiresSellingPlan` and `metafields` (in the order asked, `null` where the product has none). `getProductStock(handle): Promise<Record<string, number | null>>` maps variant id to `quantityAvailable`; it is a separate read because Shopify only answers it when the Storefront token has the `unauthenticated_read_product_inventory` scope, and a missing scope must not break the product page.
- Produces (queries.ts): `productFragment.options` selects `optionValues { id name swatch { color image { previewImage { ...ImageFragment } } } }`; `getProductByHandleQuery` takes `$metafields: [HasMetafieldsIdentifier!]! = []` and selects `requiresSellingPlan`, `sellingPlanGroups(first: 5)` (fields as in the types) and `metafields(identifiers: $metafields) { namespace key type value }`; new `getProductStockQuery`.

- [ ] **Step 1: Failing tests** (`scripts/shopify/sdk-product-extras.test.mjs`, same env and `answer()` helper as Task 2's test file)

```js
test("getProduct asks for the extra fields the page names, in order", async () => {
  answer({ product: { id: "p", handle: "a", metafields: [{ namespace: "custom", key: "material", type: "single_line_text_field", value: "Wool" }, null] } });
  const p = await sdk.getProduct("a", { metafields: [{ namespace: "custom", key: "material" }, { namespace: "custom", key: "care" }] });
  assert.deepEqual(sent.variables.metafields, [{ namespace: "custom", key: "material" }, { namespace: "custom", key: "care" }]);
  assert.equal(p.metafields[0].value, "Wool");
  assert.equal(p.metafields[1], null);
});

test("getProduct with no extra fields sends an empty list", async () => {
  answer({ product: null });
  await sdk.getProduct("a");
  assert.deepEqual(sent.variables.metafields, []);
});

test("getProductStock maps variant ids to the quantity Shopify has", async () => {
  answer({ product: { variants: { nodes: [{ id: "v1", quantityAvailable: 3 }, { id: "v2", quantityAvailable: null }] } } });
  assert.deepEqual(await sdk.getProductStock("a"), { v1: 3, v2: null });
});

test("getProductStock says which scope is missing when Shopify refuses", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ message: "Access denied for quantityAvailable field." }] }), { status: 200 });
  await assert.rejects(sdk.getProductStock("a"), /unauthenticated_read_product_inventory/);
});
```

In `sdk-documents.test.mjs` add:

```js
test("product options carry swatches, and only the product page asks for subscriptions and extra fields", () => {
  assert.match(docs.getProductsQuery, /optionValues\s*\{[^}]*swatch/s);
  assert.match(docs.getProductByHandleQuery, /sellingPlanGroups/);
  assert.match(docs.getProductByHandleQuery, /metafields\(identifiers: \$metafields\)/);
  assert.doesNotMatch(docs.getProductsQuery, /sellingPlanGroups|quantityAvailable/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test scripts/shopify/sdk-product-extras.test.mjs scripts/shopify/sdk-documents.test.mjs`
Expected: FAIL (`metafields` variable missing, `getProductStock is not a function`, no `optionValues`).

- [ ] **Step 3: Implement**

`productFragment` options block becomes:

```graphql
    options {
      id
      name
      values
      optionValues {
        id
        name
        swatch {
          color
          image {
            previewImage {
              ...ImageFragment
            }
          }
        }
      }
    }
```

`getProductByHandleQuery`:

```ts
export const getProductByHandleQuery = /* GraphQL */ `
  query GetProductByHandle($handle: String!, $metafields: [HasMetafieldsIdentifier!]! = []) {
    product(handle: $handle) {
      ...ProductFragment
      requiresSellingPlan
      sellingPlanGroups(first: 5) {
        nodes {
          name
          options {
            name
            values
          }
          sellingPlans(first: 10) {
            nodes {
              id
              name
              description
              recurringDeliveries
              priceAdjustments {
                orderCount
                adjustmentValue {
                  __typename
                  ... on SellingPlanPercentagePriceAdjustment {
                    adjustmentPercentage
                  }
                  ... on SellingPlanFixedAmountPriceAdjustment {
                    adjustmentAmount {
                      amount
                      currencyCode
                    }
                  }
                  ... on SellingPlanFixedPriceAdjustment {
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
      metafields(identifiers: $metafields) {
        namespace
        key
        type
        value
      }
    }
  }
  ${productFragment}
`;

export const getProductStockQuery = /* GraphQL */ `
  query GetProductStock($handle: String!) {
    product(handle: $handle) {
      variants(first: 250) {
        nodes {
          id
          quantityAvailable
        }
      }
    }
  }
`;
```

`getProduct` passes `variables: { handle, metafields: options?.metafields ?? [] }`. Add:

```ts
/**
 * How many of each variant are left. Separate from getProduct because Shopify
 * only answers when the Storefront token has the unauthenticated_read_product_inventory
 * scope; without it this throws and says so, and the product page still works.
 */
export async function getProductStock(handle: string): Promise<Record<string, number | null>> {
  requireShopify();
  try {
    const res = await shopifyFetch<{ product: { variants: { nodes: Array<{ id: string; quantityAvailable: number | null }> } } | null }>({
      query: getProductStockQuery,
      variables: { handle },
      cache: CATALOGUE_CACHE,
      tags: ["products", `product-${handle}`],
    });
    const nodes = res.body.data?.product?.variants.nodes ?? [];
    return Object.fromEntries(nodes.map((v) => [v.id, v.quantityAvailable]));
  } catch (err) {
    if (err instanceof Error && /access denied/i.test(err.message)) {
      throw new ShopifyError(
        "Shopify will not share stock counts: give the Storefront token the unauthenticated_read_product_inventory scope, or hide the stock line.",
        403
      );
    }
    throw err;
  }
}
```

Check that `shopifyFetch` throws on a GraphQL `errors` array with status 200 (the existing "a GraphQL error ... is thrown, not swallowed" test says it does); the error message must contain Shopify's text for the regex above to match. Also check how `getProduct` tags are named today and reuse them.

- [ ] **Step 4: Tests, schema, build** (same command as Task 2 Step 4). On mock.shop confirm the scope message: `curl -s https://mock.shop/api -H 'Content-Type: application/json' -d '{"query":"{ product(handle:\"slides\") { variants(first:2){ nodes { id quantityAvailable } } } }"}'` (mock.shop answers it; record the result in the commit message body).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopify scripts/shopify/sdk-product-extras.test.mjs scripts/shopify/sdk-documents.test.mjs
git commit -m "feat(sdk): option swatches, subscription plans, extra product fields and stock counts"
```

---

### Task 4: Variant helpers (R12)

**Files:**
- Create: `src/lib/shopify/variants.ts`, `scripts/shopify/variants.test.mjs`
- Modify: `src/lib/shopify/index.ts` (add `export * from "./variants";`)

**Interfaces:**
- Produces:
  - `findVariant(product: Pick<Product, "variants">, picked: Record<string, string>): ProductVariant | null`: the variant whose `selectedOptions` match every picked option. Option names compare case-insensitively.
  - `defaultVariant(product: Pick<Product, "variants">): ProductVariant | null`: the first variant for sale, else the first variant, else null.
  - `isOptionValueAvailable(product, picked, name, value): boolean`: whether picking `value` for option `name`, with the other picks kept, lands on a variant for sale (for greying out sizes).
  - `variants.ts` imports only types from `./types`.

- [ ] **Step 1: Failing tests** (`scripts/shopify/variants.test.mjs`)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { findVariant, defaultVariant, isOptionValueAvailable } = await loadSdk("variants");
const v = (id, sale, opts) => ({ id, availableForSale: sale, selectedOptions: Object.entries(opts).map(([name, value]) => ({ name, value })) });
const product = { variants: { edges: [v("1", false, { Size: "S", Color: "Red" }), v("2", true, { Size: "M", Color: "Red" }), v("3", true, { Size: "S", Color: "Blue" })].map((node) => ({ node })) } };

test("findVariant matches every picked option, names in any case", () => {
  assert.equal(findVariant(product, { size: "M", color: "Red" }).id, "2");
  assert.equal(findVariant(product, { Size: "L", Color: "Red" }), null);
});

test("defaultVariant prefers the first one for sale", () => {
  assert.equal(defaultVariant(product).id, "2");
  assert.equal(defaultVariant({ variants: { edges: [] } }), null);
});

test("isOptionValueAvailable greys out a size that is sold out in the picked colour", () => {
  assert.equal(isOptionValueAvailable(product, { Color: "Red" }, "Size", "S"), false);
  assert.equal(isOptionValueAvailable(product, { Color: "Blue" }, "Size", "S"), true);
});
```

- [ ] **Step 2: Run, watch it fail** (`node --test scripts/shopify/variants.test.mjs`: cannot find `variants.ts`).

- [ ] **Step 3: Implement** (`src/lib/shopify/variants.ts`)

```ts
/**
 * Picking a variant from the options a shopper chose. Safe in client components:
 * imports only types.
 */
import type { Product, ProductVariant } from "./types";

type WithVariants = Pick<Product, "variants">;
const list = (product: WithVariants) => product.variants.edges.map((e) => e.node);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function matches(variant: ProductVariant, picked: Record<string, string>): boolean {
  return Object.entries(picked).every(([name, value]) =>
    variant.selectedOptions.some((o) => same(o.name, name) && o.value === value)
  );
}

/** The variant whose options match every pick, or null. */
export function findVariant(product: WithVariants, picked: Record<string, string>): ProductVariant | null {
  return list(product).find((v) => matches(v, picked)) ?? null;
}

/** The variant to show before the shopper picks: the first for sale, else the first. */
export function defaultVariant(product: WithVariants): ProductVariant | null {
  const all = list(product);
  return all.find((v) => v.availableForSale) ?? all[0] ?? null;
}

/** Whether choosing this value, keeping the other picks, lands on a variant for sale. */
export function isOptionValueAvailable(product: WithVariants, picked: Record<string, string>, name: string, value: string): boolean {
  const others = Object.fromEntries(Object.entries(picked).filter(([n]) => !same(n, name)));
  return list(product).some((v) => v.availableForSale && matches(v, { ...others, [name]: value }));
}
```

- [ ] **Step 4: Run** `node --test scripts/shopify/variants.test.mjs && pnpm build && pnpm lint`. Expected: pass.

- [ ] **Step 5: Commit** `git add src/lib/shopify/variants.ts src/lib/shopify/index.ts scripts/shopify/variants.test.mjs && git commit -m "feat(sdk): find the variant a shopper picked"`

---

### Task 5: Shop, menus, policies and pages, and menu links that stay on the site (R6, R7)

**Files:**
- Create: `src/lib/shopify/content.ts`, `src/lib/shopify/menu.ts`, `scripts/shopify/sdk-content.test.mjs`, `scripts/shopify/menu.test.mjs`
- Modify: `src/lib/shopify/queries.ts`, `src/lib/shopify/types.ts`, `src/lib/shopify/index.ts` (re-export both modules)

**Interfaces:**
- Produces (types.ts):

```ts
export interface ShopDetails {
  name: string;
  description: string | null;
  primaryDomain: { url: string; host: string };
  brand: { slogan: string | null; shortDescription: string | null; logo: { image: ShopifyImage | null } | null } | null;
}
export interface MenuItem { id: string; title: string; url: string | null; type: string; resourceId: string | null; items: MenuItem[] }
export interface Menu { id: string; title: string; items: MenuItem[] }
export interface ShopPolicy { id: string; title: string; handle: string; body: string; url: string }
export interface ContentPage { id: string; handle: string; title: string; body: string; bodySummary: string; seo: { title: string | null; description: string | null } | null }
export interface MenuLink { title: string; href: string; external: boolean; items: MenuLink[] }
```

- Produces (content.ts), all throw `ShopifyError` on failure, cached with tag `content` and `revalidate: 3600` (Shopify sends no webhooks for menus, pages or policies; an hour is the longest an edit takes to show):
  - `getShop(): Promise<ShopDetails>`
  - `getMenu(handle: string): Promise<Menu | null>` (Shopify's defaults are `main-menu` and `footer`)
  - `getPolicies(): Promise<ShopPolicy[]>` (only the ones the shop has, in the order privacy, refund, shipping, terms)
  - `getPolicy(handle: string): Promise<ShopPolicy | null>`
  - `getPage(handle: string): Promise<ContentPage | null>`
- Produces (menu.ts, client-safe, imports only types): `menuLinks(menu: Menu | null, options: { hosts: string[]; routes?: RegExp[] }): { links: MenuLink[]; dropped: MenuLink[] }`. A link on one of `hosts` (the shop's primary domain and its `*.myshopify.com` domain) becomes its path (`/collections/men`); other links stay as they are with `external: true`. When `routes` is given, an internal link whose path matches none of them goes to `dropped` (the agent lists those for the owner); its children are still checked.
- Produces (queries.ts): `shopDetailsQuery`, `menuQuery`, `policiesQuery`, `pageQuery`.

- [ ] **Step 1: Failing tests**

`scripts/shopify/menu.test.mjs`:

```js
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
```

`scripts/shopify/sdk-content.test.mjs` (same env and `answer()` helper as Task 2):

```js
test("getPolicies returns only the policies the shop has", async () => {
  const p = (handle) => ({ id: handle, title: handle, handle, body: "<p>x</p>", url: `https://s/policies/${handle}` });
  answer({ shop: { privacyPolicy: p("privacy-policy"), refundPolicy: null, shippingPolicy: p("shipping-policy"), termsOfService: p("terms-of-service") } });
  assert.deepEqual((await sdk.getPolicies()).map((x) => x.handle), ["privacy-policy", "shipping-policy", "terms-of-service"]);
});

test("getPolicy finds one by handle, or null", async () => {
  answer({ shop: { privacyPolicy: null, refundPolicy: { id: "r", title: "Refund", handle: "refund-policy", body: "b", url: "u" }, shippingPolicy: null, termsOfService: null } });
  assert.equal((await sdk.getPolicy("refund-policy")).title, "Refund");
  assert.equal(await sdk.getPolicy("nope"), null);
});

test("getMenu sends the handle and returns null for a missing menu", async () => {
  answer({ menu: null });
  assert.equal(await sdk.getMenu("footer"), null);
  assert.equal(sent.variables.handle, "footer");
});

test("content reads are cached for an hour under the content tag", async () => {
  let init;
  globalThis.fetch = async (_u, i) => { init = i; return new Response(JSON.stringify({ data: { page: null } }), { status: 200 }); };
  await sdk.getPage("about");
  assert.ok(init.next.tags.includes("content"));
  assert.equal(init.next.revalidate, 3600);
});

test("content reads throw when Shopify fails", async () => {
  globalThis.fetch = async () => new Response("down", { status: 500 });
  for (const read of [() => sdk.getShop(), () => sdk.getMenu("main-menu"), () => sdk.getPolicies(), () => sdk.getPage("about")]) {
    await assert.rejects(read(), sdk.ShopifyError);
  }
});
```

Read how `sdk-live.test.mjs` asserts the cache settings it already checks (`init.next.tags`, `init.cache`) and match that shape exactly in the "cached for an hour" test.

- [ ] **Step 2: Run, watch both fail** (`node --test scripts/shopify/menu.test.mjs scripts/shopify/sdk-content.test.mjs`).

- [ ] **Step 3: Implement**

queries.ts:

```ts
export const shopDetailsQuery = /* GraphQL */ `
  query GetShopDetails {
    shop {
      name
      description
      primaryDomain {
        url
        host
      }
      brand {
        slogan
        shortDescription
        logo {
          image {
            ...ImageFragment
          }
        }
      }
    }
  }
  ${imageFragment}
`;

const menuItemFields = /* GraphQL */ `
  id
  title
  url
  type
  resourceId
`;

export const menuQuery = /* GraphQL */ `
  query GetMenu($handle: String!) {
    menu(handle: $handle) {
      id
      title
      items {
        ${menuItemFields}
        items {
          ${menuItemFields}
          items {
            ${menuItemFields}
          }
        }
      }
    }
  }
`;

const policyFields = /* GraphQL */ `
  id
  title
  handle
  body
  url
`;

export const policiesQuery = /* GraphQL */ `
  query GetPolicies {
    shop {
      privacyPolicy { ${policyFields} }
      refundPolicy { ${policyFields} }
      shippingPolicy { ${policyFields} }
      termsOfService { ${policyFields} }
    }
  }
`;

export const pageQuery = /* GraphQL */ `
  query GetPage($handle: String!) {
    page(handle: $handle) {
      id
      handle
      title
      body
      bodySummary
      seo {
        title
        description
      }
    }
  }
`;
```

menu.ts:

```ts
/**
 * Shopify menu items carry full URLs on the shop's domain. A storefront needs
 * paths on its own site. Safe in client components: imports only types.
 */
import type { Menu, MenuItem, MenuLink } from "./types";

function toLink(item: MenuItem, hosts: string[]): MenuLink {
  const raw = item.url ?? "";
  let href = raw;
  let external = false;
  try {
    const url = new URL(raw);
    if (hosts.includes(url.host) || url.host.endsWith(".myshopify.com")) href = `${url.pathname}${url.search}` || "/";
    else external = true;
  } catch {
    // Already a path.
  }
  return { title: item.title, href, external, items: item.items.map((i) => toLink(i, hosts)) };
}

function keep(link: MenuLink, routes: RegExp[] | undefined, dropped: MenuLink[]): MenuLink | null {
  const items = link.items.map((l) => keep(l, routes, dropped)).filter((l): l is MenuLink => l !== null);
  const routed = link.external || !routes || link.href === "/" || routes.some((r) => r.test(link.href));
  if (!routed) {
    dropped.push({ ...link, items });
    return null;
  }
  return { ...link, items };
}

/** Menu links for this site. Internal links with no matching route are dropped and returned for the owner. */
export function menuLinks(menu: Menu | null, options: { hosts: string[]; routes?: RegExp[] }): { links: MenuLink[]; dropped: MenuLink[] } {
  const dropped: MenuLink[] = [];
  if (!menu) return { links: [], dropped };
  const links = menu.items
    .map((item) => keep(toLink(item, options.hosts), options.routes, dropped))
    .filter((l): l is MenuLink => l !== null);
  return { links, dropped };
}
```

content.ts:

```ts
/**
 * The shop's name, menus, legal policies and info pages, read from Shopify so
 * nothing in the header, footer or legal pages is typed into the frontend.
 * Shopify sends no webhooks for these, so they are cached for an hour.
 */
import { shopifyFetch, ShopifyError } from "./client";
import { isShopifyConfigured } from "./config";
import { shopDetailsQuery, menuQuery, policiesQuery, pageQuery } from "./queries";
import type { ShopDetails, Menu, ShopPolicy, ContentPage } from "./types";

const CONTENT = { cache: "force-cache" as RequestCache, tags: ["content"], revalidate: 3600 };

function requireShopify(): void {
  if (isShopifyConfigured) return;
  throw new ShopifyError(
    "Shopify is not configured: set NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN and NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN (mock.shop works for development).",
    500
  );
}

async function read<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  requireShopify();
  const res = await shopifyFetch<T>({ query, variables, ...CONTENT });
  if (!res.body.data) throw new ShopifyError("Shopify returned no data", 502);
  return res.body.data;
}

export async function getShop(): Promise<ShopDetails> {
  return (await read<{ shop: ShopDetails }>(shopDetailsQuery)).shop;
}

/** A menu by handle. Shopify's default menus are "main-menu" and "footer". */
export async function getMenu(handle: string): Promise<Menu | null> {
  return (await read<{ menu: Menu | null }>(menuQuery, { handle })).menu;
}

const POLICY_KEYS = ["privacyPolicy", "refundPolicy", "shippingPolicy", "termsOfService"] as const;

/** The legal policies the shop has filled in. */
export async function getPolicies(): Promise<ShopPolicy[]> {
  const { shop } = await read<{ shop: Record<(typeof POLICY_KEYS)[number], ShopPolicy | null> }>(policiesQuery);
  return POLICY_KEYS.map((k) => shop[k]).filter((p): p is ShopPolicy => p !== null);
}

export async function getPolicy(handle: string): Promise<ShopPolicy | null> {
  return (await getPolicies()).find((p) => p.handle === handle) ?? null;
}

/** An info page (About, FAQ...) made in Shopify under Online Store > Pages. */
export async function getPage(handle: string): Promise<ContentPage | null> {
  return (await read<{ page: ContentPage | null }>(pageQuery, { handle })).page;
}
```

`requireShopify` is duplicated from `index.ts`: move it to `config.ts` as an exported function and import it in both files instead (update `index.ts` accordingly). Check `shopifyFetch` accepts `revalidate` together with `cache: "force-cache"` (read `client.ts`); if it drops `cache` when `revalidate` is set, keep whatever it does and assert on what reaches `fetch`.

Add `"content"` handling to `src/app/api/revalidate/route.ts`? No: no Shopify topic maps to it. Instead write in the route's header comment: "Menus, pages and policies (tag `content`) have no webhooks; they refresh hourly."

- [ ] **Step 4: Tests, schema against both versions, build, lint** (as Task 2 Step 4). Then prove against mock.shop by running the reads through the test loader:

```bash
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=mock.shop NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=mock node --input-type=module -e 'import { loadSdk } from "./scripts/test-support/load-sdk.mjs"; const s = await loadSdk(); const shop = await s.getShop(); const menu = await s.getMenu("main-menu"); console.log(shop.name, (await s.getPolicies()).map(p=>p.handle), (await s.getPage("contact"))?.title, s.menuLinks(menu, { hosts: [shop.primaryDomain.host] }).links.map(l=>l.href))'
```

Expected: `Mock.shop`, four policy handles, `Contact`, and paths like `/collections/men` (no `https://`). Check `config.ts` for how mock.shop's domain must be written; the rehearsal used `.env.local` values from `docs/frontend-wiring.md` "No development store yet": copy those.

- [ ] **Step 5: Commit** `git add src/lib/shopify scripts/shopify/menu.test.mjs scripts/shopify/sdk-content.test.mjs && git commit -m "feat(sdk): shop details, menus, policies and pages from Shopify, with menu links that stay on the site"`

---

### Task 6: A cart the frontend plugs in (R11)

**Files:**
- Create: `src/lib/shopify/cart-store.ts`, `src/lib/shopify/cart-provider.tsx`, `scripts/shopify/cart-store.test.mjs`
- Modify: `scripts/frontend/kit.mjs` (`kitFiles`: copy `.ts` and `.tsx`), `scripts/frontend/kit.test.mjs`

**Interfaces:**
- Consumes: `cartAction`, `isShopifyCartId` from `cart-client.ts`.
- Produces (cart-store.ts, framework-free, imports only `./cart-client` and types):

```ts
export interface CartState { cart: Cart | null; ready: boolean; busy: boolean; error: string | null }
export interface CartStore {
  getState(): CartState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  add(lines: CartItemInput[]): Promise<void>;
  update(lineId: string, quantity: number): Promise<void>;
  remove(lineId: string): Promise<void>;
  applyDiscountCodes(codes: string[]): Promise<void>;
  checkout(): void;
}
export interface CartStorage { get(): string | null; set(id: string): void; clear(): void }
export function createCartStore(options?: { action?: typeof cartAction; storage?: CartStorage; goTo?: (url: string) => void }): CartStore;
export function localCartStorage(key?: string): CartStorage; // default key "shopify-cart-id"; every access wrapped in try/catch
export interface CartLineView { id: string; quantity: number; variantId: string; productTitle: string; productHandle: string; variantTitle: string | null; options: SelectedOption[]; image: ShopifyImage | null; unitPrice: Money; total: Money }
export function cartLines(cart: Cart | null): CartLineView[]; // variantTitle null for "Default Title"
```

  Behaviour: changes run one at a time in order (a second `add` waits for the first, so two quick clicks never create two carts). `add` creates a cart when none is stored, otherwise adds to it; when Shopify says the stored cart is gone (the action returns `null` for a stored id), it clears the id and creates a new cart with the same lines. On error the cart stays as it was and `error` holds the message; the next successful change clears `error`. `load` gets the stored cart; `null` clears the stored id. `checkout()` sends the browser to `cart.checkoutUrl` (no-op without a cart).
- Produces (cart-provider.tsx, `"use client"`): `CartProvider({ children })` creates one store, calls `load()` on mount, and exposes `useCart(): CartState & { lines: CartLineView[]; count: number; add; update; remove; applyDiscountCodes; checkout }` through `useSyncExternalStore`. Throws a readable error when used outside the provider.

- [ ] **Step 1: Failing tests** (`scripts/shopify/cart-store.test.mjs`)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const { createCartStore, cartLines } = await loadSdk("cart-store");

const cart = (id, lines = []) => ({ id, checkoutUrl: `https://shop/checkout/${id}`, totalQuantity: lines.length, lines: { edges: lines.map((node) => ({ node })) }, cost: {} });
const memory = (id = null) => ({ id, get() { return this.id; }, set(v) { this.id = v; }, clear() { this.id = null; } });

test("two quick adds create one cart, then add to it", async () => {
  const calls = [];
  const action = async (body) => { calls.push(body.action); await new Promise((r) => setTimeout(r, 5)); return cart("gid://shopify/Cart/1"); };
  const store = createCartStore({ action, storage: memory() });
  await Promise.all([store.add([{ merchandiseId: "v1", quantity: 1 }]), store.add([{ merchandiseId: "v2", quantity: 1 }])]);
  assert.deepEqual(calls, ["create", "add"]);
});

test("a failed change keeps the cart and shows the message; the next success clears it", async () => {
  let fail = true;
  const action = async (body) => { if (body.action === "add" && fail) throw new Error("Out of stock"); return cart("gid://shopify/Cart/1"); };
  const store = createCartStore({ action, storage: memory("gid://shopify/Cart/1") });
  await store.load();
  const before = store.getState().cart;
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.equal(store.getState().cart, before);
  assert.equal(store.getState().error, "Out of stock");
  fail = false;
  await store.add([{ merchandiseId: "v1", quantity: 1 }]);
  assert.equal(store.getState().error, null);
});

test("a stored cart Shopify no longer has is dropped on load", async () => {
  const storage = memory("gid://shopify/Cart/old");
  const store = createCartStore({ action: async () => null, storage });
  await store.load();
  assert.equal(storage.get(), null);
  assert.equal(store.getState().cart, null);
  assert.equal(store.getState().ready, true);
});

test("adding to a cart Shopify dropped starts a new one with the same lines", async () => {
  const calls = [];
  const action = async (body) => { calls.push(body); return body.action === "add" ? null : cart("gid://shopify/Cart/new"); };
  const storage = memory("gid://shopify/Cart/old");
  const store = createCartStore({ action, storage });
  await store.add([{ merchandiseId: "v1", quantity: 2 }]);
  assert.deepEqual(calls.map((c) => c.action), ["add", "create"]);
  assert.deepEqual(calls[1].lines, [{ merchandiseId: "v1", quantity: 2 }]);
  assert.equal(storage.get(), "gid://shopify/Cart/new");
});

test("checkout goes to Shopify's checkoutUrl", async () => {
  let went;
  const store = createCartStore({ action: async () => cart("gid://shopify/Cart/1"), storage: memory("gid://shopify/Cart/1"), goTo: (u) => (went = u) });
  await store.load();
  store.checkout();
  assert.equal(went, "https://shop/checkout/gid://shopify/Cart/1");
});

test("cartLines flattens Shopify's lines and hides 'Default Title'", () => {
  const line = { id: "l1", quantity: 2, cost: { totalAmount: { amount: "20.0", currencyCode: "EUR" }, amountPerQuantity: { amount: "10.0", currencyCode: "EUR" } }, merchandise: { id: "v1", title: "Default Title", selectedOptions: [], image: null, product: { title: "Throw", handle: "throw", featuredImage: null } } };
  const [view] = cartLines(cart("c", [line]));
  assert.equal(view.productTitle, "Throw");
  assert.equal(view.variantTitle, null);
  assert.equal(view.total.amount, "20.0");
});
```

Before writing `cartLines`, read `CartLine`, `CartLineCost` and `CartLineMerchandise` in `types.ts` and the cart fragment in `queries.ts`; if `amountPerQuantity` or `merchandise.image` is not in the fragment, adjust the test fixture and the view to the fields the fragment really returns (do not add fields to the fragment in this task).

- [ ] **Step 2: Run, watch it fail** (`node --test scripts/shopify/cart-store.test.mjs`).

- [ ] **Step 3: Implement** `cart-store.ts`:

```ts
/**
 * The cart's brain, without React: one change at a time, the cart id kept in
 * the browser, Shopify's cart as the only truth. cart-provider.tsx wraps it.
 */
import { cartAction, isShopifyCartId } from "./cart-client";
import type { Cart, CartItemInput, Money, SelectedOption, ShopifyImage } from "./types";

export interface CartState { cart: Cart | null; ready: boolean; busy: boolean; error: string | null }
export interface CartStorage { get(): string | null; set(id: string): void; clear(): void }
export interface CartStore {
  getState(): CartState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  add(lines: CartItemInput[]): Promise<void>;
  update(lineId: string, quantity: number): Promise<void>;
  remove(lineId: string): Promise<void>;
  applyDiscountCodes(codes: string[]): Promise<void>;
  checkout(): void;
}

export function localCartStorage(key = "shopify-cart-id"): CartStorage {
  return {
    get: () => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (id) => { try { localStorage.setItem(key, id); } catch { /* private mode: the cart lasts this visit */ } },
    clear: () => { try { localStorage.removeItem(key); } catch { /* nothing stored */ } },
  };
}

export function createCartStore(options: { action?: typeof cartAction; storage?: CartStorage; goTo?: (url: string) => void } = {}): CartStore {
  const action = options.action ?? cartAction;
  const storage = options.storage ?? localCartStorage();
  const goTo = options.goTo ?? ((url: string) => { window.location.href = url; });
  let state: CartState = { cart: null, ready: false, busy: false, error: null };
  const listeners = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve();

  const set = (patch: Partial<CartState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const storedId = () => {
    const id = storage.get();
    return isShopifyCartId(id) ? id : null;
  };

  const keep = (cart: Cart | null) => {
    if (cart) storage.set(cart.id);
    else storage.clear();
    set({ cart, error: null });
  };

  function run(change: () => Promise<Cart | null | undefined>): Promise<void> {
    const next = queue.then(async () => {
      set({ busy: true });
      try {
        const cart = await change();
        if (cart !== undefined) keep(cart);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : "The cart could not be updated" });
      } finally {
        set({ busy: false, ready: true });
      }
    });
    queue = next;
    return next;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => run(async () => {
      const cartId = storedId();
      return cartId ? action({ action: "get", cartId }) : null;
    }),
    add: (lines) => run(async () => {
      const cartId = storedId();
      if (cartId) {
        const cart = await action({ action: "add", cartId, lines });
        if (cart) return cart;
        storage.clear();
      }
      const created = await action({ action: "create", lines });
      if (!created) throw new Error("This shop is not connected to Shopify yet.");
      return created;
    }),
    update: (lineId, quantity) => run(async () => {
      const cartId = storedId();
      return cartId ? action({ action: "update", cartId, lines: [{ id: lineId, quantity }] }) : undefined;
    }),
    remove: (lineId) => run(async () => {
      const cartId = storedId();
      return cartId ? action({ action: "remove", cartId, lineIds: [lineId] }) : undefined;
    }),
    applyDiscountCodes: (codes) => run(async () => {
      const cartId = storedId();
      return cartId ? action({ action: "discount", cartId, discountCodes: codes }) : undefined;
    }),
    checkout() {
      if (state.cart?.checkoutUrl) goTo(state.cart.checkoutUrl);
    },
  };
}
```

(`run` returning `undefined` means "nothing to change": the state is left alone.) Then `CartLineView` and `cartLines` per the interface, reading fields from `CartLine` as typed in `types.ts`.

`cart-provider.tsx`:

```tsx
"use client";

/**
 * Drop-in cart for a received frontend: wrap the layout in <CartProvider> and
 * call useCart() where their cart context used to be.
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createCartStore, cartLines, type CartStore } from "./cart-store";

const CartContext = createContext<CartStore | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createCartStore());
  useEffect(() => {
    void store.load();
  }, [store]);
  return <CartContext.Provider value={store}>{children}</CartContext.Provider>;
}

export function useCart() {
  const store = useContext(CartContext);
  if (!store) throw new Error("useCart() needs <CartProvider> around the page (put it in the root layout).");
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const lines = useMemo(() => cartLines(state.cart), [state.cart]);
  return {
    ...state,
    lines,
    count: state.cart?.totalQuantity ?? 0,
    add: store.add,
    update: store.update,
    remove: store.remove,
    applyDiscountCodes: store.applyDiscountCodes,
    checkout: store.checkout,
  };
}
```

`useSyncExternalStore` needs a server snapshot that is stable; `store.getState` returns the same object until a change, which satisfies it. Check `Cart` has `totalQuantity`; if not, use `lines.reduce((n, l) => n + l.quantity, 0)`.

`kit.mjs`: in `kitFiles` change `.filter((f) => f.endsWith(".ts"))` to `.filter((f) => /\.tsx?$/.test(f))`. In `kit.test.mjs` add an assertion that the plan for a root-layout target contains `lib/shopify/cart-provider.tsx`.

- [ ] **Step 4: Run** `node --test scripts/shopify/cart-store.test.mjs scripts/frontend/kit.test.mjs && pnpm test:scripts 2>&1 | tail -4 && pnpm build && pnpm lint`. Expected: pass. If `load-sdk`'s TS hooks cannot load `cart-store.ts` because it imports `./cart-client`, read `scripts/test-support/ts-hooks.mjs`; it already resolves sibling `.ts` imports for `index.ts`.

- [ ] **Step 5: Commit** `git add src/lib/shopify/cart-store.ts src/lib/shopify/cart-provider.tsx scripts/shopify/cart-store.test.mjs scripts/frontend/kit.mjs scripts/frontend/kit.test.mjs && git commit -m "feat(sdk): a tested cart store and provider a received frontend plugs in"`

---

### Task 7: The audit sees what the rehearsal found by hand (R3, R4, R5, R9, R23)

**Files:**
- Modify: `scripts/frontend/audit.mjs`, `scripts/frontend/sources.mjs`
- Test: `scripts/frontend/audit.test.mjs`, `scripts/frontend/sources.test.mjs`

**Interfaces:**
- Produces (sources.mjs):
  - `findImporters(dir, files): Map<string, string[]>`: for each file, the files that import it (uses `importsFile`; reads every `from "..."` and `import("...")` on each line, not only the first).
  - `findSiteData(dir, files, productData): Array<{ file, line, what }>`: hardcoded store content that is not products. A file counts when it is under a `data/`, `content/`, `constants/` or `config/` folder, or its name matches `/site|nav|menu|footer|polic|pages|social|announce/i`, AND it exports an array or object literal. `what` names the kind from its exported names and keys: `menu` (objects with `href`/`url` keys), `policy or page text` (a string of 200+ characters), `store claim` (export names matching `/site|announce|shipping|contact|social/i`). Product data files are excluded.
  - `findInventedFields(dir, files): Array<{ file, line, what }>`: object keys or type fields named `rating`, `reviewCount`, `reviews`, `stockLeft`, `badge`, `subscribable` in non-test source files.
  - `findPaymentForms(dir, files): Array<{ file, line, what }>`: inputs whose `name`, `id`, `placeholder` or `autoComplete` matches `/cc-number|cc-csc|cc-exp|card ?number|cvc|cvv|expiry/i`.
  - `findFakeApis` no longer reports a route file that imports the SDK (`lib/shopify`), nor a `fetch("/api/<x>")` whose route file `app/api/<x>/route.*` imports the SDK.
- Produces (audit.mjs): `auditFrontend(dir)` gains `siteData`, `inventedFields`, `paymentForms`, `unused: string[]` (data-like files nothing imports: product data, site data, and files under `data/`), and `hardcodedMoney` skips `unused` files. `HARDCODED_MONEY`'s "over €50" pattern captures the whole amount (`€60`, `€1,299.00`) and a new pattern catches a currency label with no number: `/\((€|£|\$|EUR|USD|GBP)\)/`. `summariseAudit` prints a line for each new list (payment forms first, worded as the most urgent thing).

- [ ] **Step 1: Failing tests.** Add to `scripts/frontend/audit.test.mjs` (fixtures via `makeFixture`, as the existing tests do):

```js
test("money matches keep the whole amount and catch a currency label", () => {
  const dir = makeFixture({ "src/components/Note.tsx": 'export const n = <p>Free shipping over €60 and €1,299.00</p>;\nexport const l = <legend>Price (€)</legend>;\n' });
  const found = findHardcodedMoney(dir, ["src/components/Note.tsx"]).map((m) => m.what);
  assert.ok(found.some((w) => w.includes("€60")), found.join());
  assert.ok(found.some((w) => w.includes("(€)")), found.join());
});

test("site content, invented fields and a card form are reported", () => {
  const dir = makeFixture({
    "package.json": { dependencies: { next: "16.3.4" } },
    "src/app/page.tsx": 'import { headerMenu } from "@/data/navigation";\nimport { policies } from "@/data/policies";\nexport default function P() { return null; }\n',
    "src/data/navigation.ts": 'export const headerMenu = [{ label: "Shop", href: "/shop" }, { label: "About", href: "/pages/about" }];\n',
    "src/data/policies.ts": `export const policies = [{ handle: "refund", body: "${"x".repeat(220)}" }];\n`,
    "src/data/products.ts": 'export type P = { name: string; price: number; rating: number; reviewCount: number };\n',
    "src/app/checkout/Form.tsx": '<input name="cardNumber" placeholder="Card number" />\n',
  });
  const audit = auditFrontend(dir);
  assert.deepEqual(audit.siteData.map((s) => s.file).sort(), ["src/data/navigation.ts", "src/data/policies.ts"]);
  assert.ok(audit.inventedFields.some((f) => f.what === "rating"));
  assert.equal(audit.paymentForms[0].file, "src/app/checkout/Form.tsx");
  assert.match(summariseAudit(audit).join("\n"), /payment form/i);
});

test("files nothing imports are listed as unused and skipped by the money check", () => {
  const dir = makeFixture({
    "package.json": { dependencies: { next: "16.3.4" } },
    "src/app/page.tsx": "export default function P() { return null; }\n",
    "src/data/site.ts": 'export const announcement = "Free shipping over €60";\n',
  });
  const audit = auditFrontend(dir);
  assert.deepEqual(audit.unused, ["src/data/site.ts"]);
  assert.equal(audit.hardcodedMoney.length, 0);
});
```

Add to `scripts/frontend/sources.test.mjs`:

```js
test("a Shopify-backed route and the calls to it are not fake APIs", () => {
  const dir = makeFixture({
    "src/app/api/products/route.ts": 'import { getProductsPage } from "@/lib/shopify";\nexport async function GET() {}\n',
    "src/components/LoadMore.tsx": 'fetch("/api/products?page=2")\n',
    "src/components/Old.tsx": 'fetch("https://fakestoreapi.com/products")\n',
  });
  const files = ["src/app/api/products/route.ts", "src/components/LoadMore.tsx", "src/components/Old.tsx"];
  assert.deepEqual(findFakeApis(dir, files, []).map((a) => a.file), ["src/components/Old.tsx"]);
});
```

- [ ] **Step 2: Run, watch them fail** (`node --test scripts/frontend/audit.test.mjs scripts/frontend/sources.test.mjs`).

- [ ] **Step 3: Implement** the interfaces above. Notes for the implementer:
  - The "over €50" pattern today is ``new RegExp(`${SYMBOL}\\s*\\d|\\d\\s*${SYMBOL}`)``; change it to ``new RegExp(`${SYMBOL}\\s*\\d[\\d.,]*|\\d[\\d.,]*\\s*${SYMBOL}`)`` and add the currency-label pattern to `HARDCODED_MONEY`. Read the top of `audit.mjs` for `SYMBOL`.
  - Reuse `eachLine`, `read`, `importsFile` and `listSourceFiles`; keep every finding's `file:line`.
  - `findImporters` must treat `@/x`, `~/x`, relative paths and extension-less specifiers the way `importsFile` already does.
  - `unused` = data-like files (product data files, `findSiteData` files, and anything under a `data/` folder) with no importer. They stay on disk; the summary says "unused hardcoded data, ask the owner before deleting".
  - Keep `findSiteData` conservative: a nav/footer component file that only *renders* links is not site data unless it exports the list.

- [ ] **Step 4: Run** `pnpm test:scripts 2>&1 | tail -4`, then the audit on the original stand-in (Task 11 keeps a pristine copy; until then use `git -C <standin> stash`/a fresh clone of its first commit): `pnpm shop-setup frontend-audit <copy>` must list `src/data/navigation.ts`, `pages.ts`, `policies.ts`, `site.ts`, `collections.ts`, the rating/reviewCount/stockLeft/subscribable fields, the card form in `src/app/checkout/CheckoutForm.tsx`, and print `€60` (not `€6`).

- [ ] **Step 5: Commit** `git add scripts/frontend && git commit -m "feat(kit): the audit reports menus, policies, store claims, invented fields, card forms and unused files"`

---

### Task 8: frontend-check enforces the same, and can look at the running site (R24)

**Files:**
- Modify: `scripts/frontend/check.mjs`, `scripts/setup/cli.mjs` (`frontend-check` case: `--site <url>`), `scripts/frontend/check.test.mjs`

**Interfaces:**
- Consumes: Task 7's `auditFrontend` fields and `findImporters`.
- Produces: `checkWiring(dir)` adds, after the existing checks:
  - "No page or component imports hardcoded menus, policies, pages or store claims" (`siteData` files that have importers).
  - "No invented ratings, reviews, stock or badges" (`inventedFields` in files that have importers or are pages/components).
  - "No payment form: Shopify's checkout takes the payment" (`paymentForms`).
  - The existing "imports the hardcoded products" check ignores product data files nothing imports (they are reported as unused, not failures).
  - "Checkout uses Shopify's checkoutUrl" passes when a file uses `checkoutUrl` *or* imports `cart-provider`/`cart-store` (whose `checkout()` uses it).
- Produces: `smokeSite(url, fetchFn = fetch): Promise<Array<{ ok, what, where }>>`: fetches `/`, finds the first `href="/products/..."` in its HTML, fetches that page; each must return 200 and contain `cdn.shopify.com`. CLI: `pnpm shop-setup frontend-check --site http://localhost:3000` runs `checkWiring` then `smokeSite` and prints both.

- [ ] **Step 1: Failing tests** in `check.test.mjs`: extend the existing "unwired composite fixture" with `src/data/navigation.ts` imported by `src/app/layout.tsx`, a `rating` field used in `src/components/Card.tsx`, and a card input; assert the three new checks fail with those `file:line`s. Extend the "wired fixture": an unused `src/data/products.ts` that nothing imports must not fail any check, and a frontend that imports `@/lib/shopify/cart-provider` and calls `checkout()` passes the checkout check. For `smokeSite`, stub `fetchFn`:

```js
test("smokeSite passes when the home page and a product page show Shopify images", async () => {
  const pages = {
    "http://x/": '<a href="/products/slides">x</a><img src="https://cdn.shopify.com/a.jpg">',
    "http://x/products/slides": '<img src="https://cdn.shopify.com/b.jpg">',
  };
  const fetchFn = async (u) => new Response(pages[u] ?? "missing", { status: pages[u] ? 200 : 404 });
  assert.ok((await smokeSite("http://x", fetchFn)).every((r) => r.ok));
});

test("smokeSite fails when the page has no Shopify image", async () => {
  const fetchFn = async () => new Response('<a href="/products/a">a</a><img src="https://images.unsplash.com/a.jpg">', { status: 200 });
  assert.ok((await smokeSite("http://x", fetchFn)).some((r) => !r.ok));
});
```

- [ ] **Step 2: Run, watch them fail** (`node --test scripts/frontend/check.test.mjs`).
- [ ] **Step 3: Implement.** In `cli.mjs`, find the `frontend-check` case and parse `--site` with the existing `args.mjs` helpers (read how other commands take flags); keep the exit code 1 when any result is not ok; keep the closing reminder about `pnpm build` and the development store.
- [ ] **Step 4: Run** `pnpm test:scripts 2>&1 | tail -4`.
- [ ] **Step 5: Commit** `git add scripts/frontend/check.mjs scripts/frontend/check.test.mjs scripts/setup/cli.mjs && git commit -m "feat(kit): frontend-check fails on hardcoded menus, policies, invented fields and card forms, and can check the running site"`

---

### Task 9: kit-install leaves the repo ready for the next agent (R1, R2, R26)

**Files:**
- Create: `scripts/frontend/templates.mjs`
- Modify: `scripts/frontend/kit.mjs` (`GITIGNORE`, `planKitInstall`), `scripts/frontend/install.mjs` (`applyKitInstall`), `scripts/frontend/kit.test.mjs`, `scripts/frontend/install.test.mjs`

**Interfaces:**
- Produces (templates.mjs): `ERROR_PAGE` and `GLOBAL_ERROR_PAGE`, the source of a plain `error.tsx` and `global-error.tsx` (Next 16 props `{ error, retry }`; global-error renders its own `<html><body>`; both `"use client"`, a heading "Something went wrong", the error message only in development, and a "Try again" button calling `retry()`).
- Produces (kit.mjs): `GITIGNORE` gains `frontend-audit.json`. `planKitInstall` returns `extras: Array<{ to, text }>`: `<appRoot>app/error.tsx` and `<appRoot>app/global-error.tsx` when the target has none (an existing file is left alone, never a conflict), and `CLAUDE.md` containing `@AGENTS.md\n` when the target has no `CLAUDE.md` (an existing `CLAUDE.md` without `@AGENTS.md` gets `agentsNote` written into it instead of `AGENTS.md`, as today).
- Produces (install.mjs): `applyKitInstall` writes `plan.extras`. The final CLI message says `store-setup.state.json` is the setup's progress record and is committed.

- [ ] **Step 1: Failing tests** in `kit.test.mjs`:

```js
test("the plan adds error pages and a CLAUDE.md pointer only where missing", () => {
  const target = makeFixture({ "package.json": { dependencies: { next: "16.3.4" } }, "app/page.tsx": "", "app/error.tsx": "mine" });
  const plan = planKitInstall({ kitRoot: KIT, target, appRoot: "" });
  const extras = plan.extras.map((e) => e.to).sort();
  assert.deepEqual(extras, ["CLAUDE.md", "app/global-error.tsx"]);
  assert.match(plan.extras.find((e) => e.to === "CLAUDE.md").text, /@AGENTS\.md/);
  assert.match(plan.extras.find((e) => e.to === "app/global-error.tsx").text, /<html/);
  assert.ok(plan.gitignore.includes("frontend-audit.json"));
});
```

(use whatever the existing tests name the kit root constant). In `install.test.mjs`: applying a plan writes `app/global-error.tsx`, and applying it twice changes nothing the second time.

- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.** The error pages must type-check under the received repo's TypeScript: verify by writing them into the Task 11 copy and running `pnpm build` there.
- [ ] **Step 4: Run** `pnpm test:scripts 2>&1 | tail -4`.
- [ ] **Step 5: Commit** `git add scripts/frontend && git commit -m "feat(kit): install error pages and a CLAUDE.md pointer, and ignore the audit file"`

---

### Task 10: The guide and the skill tell the agent about all of it (R9, R26, R29, R30, R31, R33)

**Files:**
- Modify: `docs/frontend-wiring.md`, `.claude/skills/shopify-connect-frontend/SKILL.md`, `README.md` (SDK file list and the "Using the SDK" example)

No tests; the gate is Task 11.

- [ ] **Step 1: `docs/frontend-wiring.md`**, add or change these sections (keep the existing tone: short, imperative, plain words):
  - **Catalogue, "Lists, load more and filters":** use `getCollectionProductsPage` / `getProductsPage` / `searchProducts`; pass `pageInfo.endCursor` as the next `cursor`; build their filter UI from `page.filters` (each value's `input` is JSON: `JSON.parse(value.input)` is one `ProductFilterInput`); a "Load more" button in a client component calls a **server action** that calls the SDK (show a 12-line example with `"use server"` returning `{ products, pageInfo }`); never filter a whole catalogue in memory.
  - **Product page:** `findVariant` / `defaultVariant` / `isOptionValueAvailable` for their picker; swatches from `options[].optionValues[].swatch` (hide the dots when `swatch` is null); extra fields via `getProduct(handle, { metafields: [...] })` (list which ones in one constant, and ask the owner which Shopify fields hold them); subscriptions only from `sellingPlanGroups` (never a discount computed in the browser; the cart line needs `sellingPlanId`); stock only from `getProductStock` with the scope note, else hide "Only N left".
  - **New section "Header, footer, policies and pages":** `getShop`, `getMenu("main-menu")`, `getMenu("footer")`, `menuLinks(menu, { hosts: [shop.primaryDomain.host], routes })` and list `dropped` for the owner; `getPolicies`/`getPolicy` for `/policies/[handle]`; `getPage` for `/pages/[handle]`; these reads in the root layout need `global-error.tsx` (kit-install adds one); content refreshes hourly.
  - **Cart:** replace "The pattern" with `CartProvider` + `useCart()` (wrap the root layout; map their context's names onto `useCart()`; `lines` from `cartLines`; `checkout()`), keep the totals/errors rules, and keep the old `cartAction` snippet as "if their cart must stay a different store library".
  - **Things Shopify does not have:** one table: ratings/reviews (a reviews app or metafields: ask), announcement bar / free-shipping line / contact email / social links (hide and list; owner decision pending on a "store settings" metaobject), newsletter (hide unless connected), hero copy (shop name/description or ask). "Hide it and list it" is the rule.
  - **mock.shop:** prices are CAD; search matches loosely; it has no filters, swatches, extra fields, subscriptions or custom pages; a bad variant id still gives a cart, so error paths cannot be practised there.
  - **Errors:** kit-install adds `error.tsx` and `global-error.tsx`; never catch a Shopify error to show something else.
- [ ] **Step 2: `SKILL.md`:**
  - Step 4 (Wire) names the new pieces in one line each and links the guide sections.
  - Step 5 (Check): run `pnpm exec tsc --noEmit` while wiring (`next lint` no longer exists in Next 16); `pnpm shop-setup frontend-check`, then `pnpm build`, `pnpm start`, and `pnpm shop-setup frontend-check --site http://localhost:3000`.
  - Marking steps: "Mark `frontend-catalogue` and `frontend-cart` done when their code is in and builds against mock.shop or the development store. `frontend-check` is the only one that waits for the development store."
  - "`pnpm shop-setup next` also offers the store questionnaire (`intake`). It can wait until the frontend is wired; do not ask the owner store questions in the middle of the wiring."
  - `store-setup.state.json` is committed; `frontend-audit.json` is ignored.
  - Rules: add "Never filter a whole catalogue in memory; use Shopify's filters" and "Unused old data files are listed, not deleted, until the owner agrees."
- [ ] **Step 3: `README.md`:** add the new files to the SDK tree and one line each to "Key Backend Capabilities" (paged reads and filters, content reads, cart provider). Remove nothing that is still true; fix the subscriptions bullet to say plans come from `getProduct`'s `sellingPlanGroups`.
- [ ] **Step 4:** `pnpm test:scripts` (the kit tests read the skill and docs paths) and `pnpm build`.
- [ ] **Step 5: Commit** `git add docs/frontend-wiring.md .claude/skills/shopify-connect-frontend/SKILL.md README.md && git commit -m "docs(kit): wiring guide and skill cover pages, filters, content, the cart provider and what Shopify lacks"`

---

### Task 11: Second rehearsal (verification gate)

- [ ] **Step 1:** Make a fresh copy of the stand-in at its first commit: `git clone <scratchpad>/standin-frontend <scratchpad>/standin-2 && git -C <scratchpad>/standin-2 log --oneline | tail -1` (must be "Initial frontend"), then `git -C <scratchpad>/standin-2 reset --hard <that commit>`.
- [ ] **Step 2:** Spawn a fresh agent (Sonnet) with the same brief and log format as the first rehearsal, pointed at `standin-2` and a new log `rehearsal-log-2.md`.
- [ ] **Step 3:** Compare the logs. Pass: none of R3-R9, R11-R13, R23-R27, R29 reappear; the agent wrote no SDK-shaped code of its own (no `shopifyFetch` calls outside the kit, no own cart context logic beyond mapping names); `frontend-check --site` passes against mock.shop; `pnpm build` passes.
- [ ] **Step 4:** Fix whatever reappears or is new, each with a test, then push to main and state plainly what is pushed and what stays unverified (everything against a development store; client-side clicks unless a browser run was done).

---

## Not in this plan: owner decisions

These came out of the rehearsal but need the owner to choose before anyone builds them:

1. **Store settings in Shopify (R19, R20):** announcement bar, free-shipping line, contact email, social links and hero copy have no Shopify field. Option: one "Store settings" metaobject the kit creates and reads. Until decided: hide and list.
2. **Smaller install (R32):** kit-install copies 92 files, including the catalogue importer and 34 test files. Option: a `--slim` install for the connect job only.
3. **Moving the old site's pages and policies into Shopify (R21):** an importer for About/FAQ/policy texts. Legal texts need the owner's approval either way.
4. **Reviews (R14):** which reviews app, if any.

## Appendix: rehearsal findings this plan covers

R1 audit file not ignored · R2 no CLAUDE.md · R3 €6 truncation, `(€)` · R4 non-product content invisible · R5 card form · R6 no content reads · R7 menu URLs · R8 no paging/filters · R9 load more / Shopify-backed routes flagged · R11 no cart provider · R12 no variant helpers · R13 swatches · R15 stock · R16 subscriptions · R17 metafields · R23 dead files forced out · R24 check too narrow · R25 search swallows errors · R26 no error pages · R27 env-dependent test · R28 stale comment · R29 marking steps · R30 intake first · R31 mock.shop caveats · R33 next lint gone. Owner decisions: R14, R19, R20, R21, R32. Unchanged by design: R10, R18, R22 (owner questions the guide already covers), R34 (browser-only checks; covered partly by `--site`).
