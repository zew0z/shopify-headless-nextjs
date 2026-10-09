# Wiring a received frontend to Shopify

Read this after `kit-install` and before touching the frontend's code. The rule throughout: **keep their design, change where the data comes from.** Their components, class names, layout and copy stay. You add a mapper and swap data sources.

Paths below use `<app>` for the frontend's app root: `src/` when it has `src/app`, otherwise the repo root. The SDK is at `<app>lib/shopify`; import it as `@/lib/shopify` if the repo has the `@/*` alias, else with a relative path. kit-install does the same in the routes it adds.

Commands below are written with pnpm. In the received repo, use the repo's package manager: kit-install prints the exact install command and how to run the scripts. In an npm repo (a `package-lock.json` and no `pnpm-lock.yaml`) it adds the scripts but leaves every package, runtime and dev, to npm, so `package-lock.json` stays in step with `package.json`: run exactly the `npm install` command it printed (for example `npm install --save-dev @playwright/test@<range> typescript@<range> && npm install --save-exact @shopify/hydrogen@<version>`, with only the packages the repo lacks), then `npm run test:scripts` and `npm run shop-setup -- <command> --flags` (npm needs the `--` to pass the flags on to the script; `pnpm shop-setup <command> --flags` does not). In a pnpm repo it writes the packages into `package.json` and adds the kit's `pnpm-workspace.yaml` (its build settings) when the repo has none; then `pnpm install`.

If the audit says the frontend already talks to Shopify (an older kit or its own client), read "Frontend already has Shopify code" below before installing or wiring anything.

## Frontend already has Shopify code

The audit prints "This frontend already talks to Shopify" with each place it found: a file sending a Storefront token, calling `/api/<version>/graphql.json`, or importing a Shopify package, and any file in `lib/shopify` that is not the kit's own copy. The kit does not migrate that code for you, and does not overwrite it.

1. When kit-install reports conflicts inside `<app>lib/shopify`, nothing was written. Move the old code aside: `git mv <app>lib/shopify <app>lib/shopify-old` (kit-install prints this line with the right path). Do the same when the audit named files in `<app>lib/shopify` but their names happen not to clash with the kit's: kit-install would then not stop, and the kit's SDK would land in the same folder as the old code.
2. Point its importers at `lib/shopify-old` (`@/lib/shopify` becomes `@/lib/shopify-old`, or the relative path), so the site builds as before.
3. Run kit-install again.
4. Wire as below, replacing the old calls with the kit's SDK one caller at a time. Delete `lib/shopify-old` under the dead-code rule once nothing imports it.

If the frontend has its own analytics setup (Shopify analytics or other tracking code), list it for the owner; do not migrate or remove it unasked. The audit does not look for it: check by hand.

## Catalogue

### 1. Find every place that reads the old data

`frontend-audit.json` (written by the audit) lists the hardcoded product lists and fake APIs with `file:line`. Search for every import of those files and every call of those APIs. That list is your work list; `frontend-check` re-checks it at the end.

### 2. One mapper, into their type

Their components already expect a product shape. Do not rewrite the components to use Shopify's shape. Write `<app>lib/shopify-adapter.ts` with one function per shape they use:

```ts
// <app>lib/shopify-adapter.ts
import type { Product } from "@/lib/shopify";
import type { Product as CardProduct } from "@/types"; // their type, whatever it is called

export function toCardProduct(p: Product): CardProduct {
  const variant = p.variants.edges[0]?.node;
  return {
    id: p.handle,                       // their links use this; Shopify's URL key is the handle
    name: p.title,
    price: Number(p.priceRange.minVariantPrice.amount),
    currency: p.priceRange.minVariantPrice.currencyCode,
    image: p.featuredImage?.url ?? "",
    imageAlt: p.featuredImage?.altText ?? p.title,
    inStock: p.availableForSale,
    variantId: variant?.id ?? "",       // the cart needs this; add the field to their type if missing
  };
}
```

- **Money:** Shopify sends amounts as strings (`"49.00"`). Convert where their type wants a number, and show prices with `formatMoney(money, lang)` from `@/lib/shopify/money` (safe in client components; pass the page's `<html lang>`), never a hardcoded `€` or `$`. `frontend-check` fails while any page or component still shows a price with a symbol or currency code of its own (`€{price}`, `{price} €`, `` `$${price}` ``, `currency: "EUR"`, "over €50", "Only $5"); test files are not checked.
- **Ids in URLs:** if their routes are `/products/[id]` with numeric ids, switch the param to the handle and fetch with `getProduct(handle)`. Keep the route path itself unless the owner agrees to change URLs.
- **Changing their type breaks their old data file.** Once `id` becomes the handle (or a field becomes optional), the hardcoded product file stops compiling even though nothing imports it any more. That is the moment to ask the owner whether it can go: it stays in git history. Do not loosen the type to keep dead data compiling.
- **Fields Shopify does not have** (ratings, review counts, "bestseller" badges, a was-price when `compareAtPrice` is empty): do not invent them. Hide that bit of UI when the value is missing, and list each one for the owner with the question "where should this come from?" (metafields, a reviews app, or remove it).

### 3. Read in server components

The SDK's catalogue functions run on the server and are cached. Call them in a server component (a `page.tsx` or `layout.tsx` without `"use client"`) and pass the mapped data down as props.

```tsx
// <app>app/page.tsx
import { getProducts, getCollections } from "@/lib/shopify";
import { toCardProduct } from "@/lib/shopify-adapter";
import { ProductGrid } from "@/components/ProductGrid"; // their component, unchanged

export default async function Home() {
  const products = (await getProducts({ limit: 12 })).map(toCardProduct);
  return <ProductGrid products={products} />;
}
```

If a **client** component imported the data file directly (`"use client"` at the top), move the read to the nearest server parent and add a prop. Do not call the SDK from client components: it would ship the token-using code to the browser and skip the cache.

If the frontend called its own fake API (`fetch("/api/products")`), replace the call with the SDK function. The fake route is dead code once nothing calls it: see "Dead code" below.

| Their data | SDK function |
|---|---|
| list of all products | `getProducts({ limit, sortKey, reverse, query })` |
| one product page | `getProduct(handle)` |
| "you may also like" | `getProductRecommendations(product.id)` |
| category / collection list | `getCollections()` |
| category page | `getCollection(handle)` + `getCollectionProductsPage({ handle, limit, sortKey })` |
| a list with "Load more" or filters | `getProductsPage`, `getCollectionProductsPage`, `searchProducts` (next section) |
| search results page | `searchProducts({ query })` |
| search box (type-ahead) | `GET /api/search?q=...` (already installed) or `predictiveSearch(q)` on the server |
| header and footer links, policies, info pages | see "Header, footer, policies and pages" |
| address, phones, opening hours, bank details, FAQ | `getStoreProfile()`, `getFaq()` (see "Shop details and FAQ") |

`/api/search` answers `502 { error }` when Shopify fails, so a search box must check `res.ok` before it reads `.products`.

A product or collection that is not found returns `null`: call `notFound()` from `next/navigation`. A Shopify failure throws; let it reach the frontend's `error.tsx` (kit-install adds one when they have none) rather than catching it and showing something else.

### 4. Lists, load more and filters

Use the page functions. They return `{ products, pageInfo, filters }`; `searchProducts` also returns `totalCount`.

- `getCollectionProductsPage({ handle, limit, cursor, sortKey, reverse, filters })` returns `null` when the collection does not exist: call `notFound()`.
- `getProductsPage({ limit, cursor, query, sortKey, reverse })` for an all-products list. It has no `filters`.
- `searchProducts({ query, limit, cursor, sortKey, reverse, filters })` for a results page.
- **Next page:** pass `pageInfo.endCursor` as the next `cursor`, while `pageInfo.hasNextPage` is true.
- **Filters:** build their filter UI from `page.filters` (each has `label`, `type` and `values`; each value has `label`, `count` and `input`). `value.input` is a JSON string: `JSON.parse(value.input)` is one `ProductFilterInput`. Pass the picked ones back as `filters: [...]`. Shopify sends no filters for a collection until the owner sets up filters in the Shopify admin (Search & Discovery): when `page.filters` is empty, show no filter UI.
- **Never filter a whole catalogue in memory** (fetch everything, then `.filter()` in the browser). Shopify filters and pages; the frontend only asks.
- **A frontend built on an in-memory index** (its filters, facet counts or search run over one big product array): do not rebuild their filters unasked. Wire the list to the page functions, keep their filter UI where Shopify's filters can feed it, and list the rest for the owner as a decision.

**Extra fields and collections on list reads.** All the list reads (`getProducts`, `getProductsPage`, `getCollectionProducts`, `getCollectionProductsPage`, `searchProducts`) take two optional settings:

- `metafields: [{ namespace, key }, ...]` reads those fields for every product, in the same shape as `getProduct(handle, { metafields })`: `product.metafields[i]` follows the order you asked in, is `null` where the product has no value, and a field that links to content entries carries them in `entries`.
- `withCollections: true` fills `product.collections.nodes` (`handle`, `title`) with the **first 10 collections** the product is in. A product in more than 10 collections shows only those 10, so do not use it as the full list. Without the setting, `product.collections` is not there.

Without these settings the lists ask Shopify for no extra fields and no collections, as before. For example, a colour facet next to a collection grid, when the owner keeps colours in `custom.color` (ask the owner which field it really is):

```ts
const COLOR = { namespace: "custom", key: "color" }; // ask the owner for the real one
const page = await getCollectionProductsPage({ handle, limit: 24, metafields: [COLOR] });
const colors = page?.products.map((p) => p.metafields?.[0]?.entries ?? []); // [] when the product has no colour
```

That labels the products on this page. It is not a facet over the whole collection: for counts and filtering, use `page.filters` once the owner has set up filters in Search & Discovery.

A "Load more" button is a client component, and client components do not call the SDK. It calls a **server action** that does:

```ts
// <app>app/collections/[handle]/actions.ts
"use server";
import { getCollectionProductsPage, type ProductFilterInput } from "@/lib/shopify";
import { toCardProduct } from "@/lib/shopify-adapter";

export async function loadMore(handle: string, cursor: string, filters: ProductFilterInput[]) {
  const page = await getCollectionProductsPage({ handle, cursor, filters, limit: 12 });
  // An expected case: return it, so the shopper can read why.
  if (!page) return { ok: false as const, message: "This collection no longer exists." };
  return { ok: true as const, products: page.products.map(toCardProduct), pageInfo: page.pageInfo };
}
```

The button keeps the products it has, appends the returned ones, and stores `pageInfo.endCursor` for the next click. Hide the button when `hasNextPage` is false. When the action returns `ok: false`, show its `message` near the button and keep the list as it was. A Shopify outage is not an expected case: `getCollectionProductsPage` throws and the error reaches `error.tsx`. Return expected cases instead of throwing them, because in production Next replaces a thrown error's message with a generic one and a digest, so the shopper would never see your text.

### 5. Caching and images

- Remove `export const dynamic = "force-dynamic"`, `fetchCache = "force-no-store"`, `revalidate = 0` and `cache: "no-store"` from pages and layouts that show products. Keep them on pages that are about one visitor (cart page, account).
- `frontend-check` counts every layout that switches caching off, because a layout wraps pages that may show products. When a layout (or another file) really shows no shop data, for example a test page that reads a flag on every request, mark it with a comment and the reason:

  ```ts
  // shop-setup-check: shows no products - analytics test page, reads an env flag per request
  export const dynamic = "force-dynamic";
  ```

  The check then skips that file and prints `<file>: not checked for caching: <reason>` on every run, so the exception stays visible. A marked file that calls a catalogue or shop read itself (`getProduct`, `getProducts`, `getProductsPage`, `getCollection`, `getCollections`, `getCollectionProducts`, `getCollectionProductsPage`, `searchProducts`, `getProductRecommendations`, `getShop`, `getMenu`, `getPolicies`, `getPolicy`, `getPage`) does show shop data: the marker does not count there, and the check fails with "(marked as showing no products, but it reads Shopify)".
- In `next.config.*`, add Shopify's image host:

```ts
images: { remotePatterns: [{ protocol: "https", hostname: "cdn.shopify.com", pathname: "/**" }] },
```

## Product page

- **Picking a variant:** keep their picker and use `findVariant(product, picked)`, `defaultVariant(product)` and `isOptionValueAvailable(product, picked, name, value)` from `@/lib/shopify/variants`. They are safe in client components. `picked` is `{ Size: "M", Color: "Red" }`. `findVariant` returns `null` when the picks match no variant: disable the add button then. Use `isOptionValueAvailable` to grey out values that would land on a sold-out variant.
- **Swatches:** `product.options[].optionValues[].swatch` has `color` or `image.previewImage` when the owner gave that value a swatch. Draw the dot from those. When `swatch` is `null`, hide the dot and show the plain value.
- **Extra fields** (materials, care, size guide): ask for them by name with `getProduct(handle, { metafields: [...] })`. Keep the list in one constant and ask the owner which Shopify fields hold each one:

  ```ts
  const FIELDS = [{ namespace: "custom", key: "materials" }]; // ask the owner for the real ones
  const product = await getProduct(handle, { metafields: FIELDS });
  const materials = product?.metafields?.[0]?.value; // same order as FIELDS; null when the product has none
  ```

  A `null` entry means this product has no value: hide that bit of UI.

  When a field links to content entries (swatches, materials), `product.metafields[i].entries` holds them: each has a `handle` and `fields`, for example each swatch's label and hex:

  ```ts
  const swatches = product?.metafields?.[0]?.entries ?? []; // [{ handle: "grey", fields: { label: "Grey", hex: "#888888" } }]
  ```

  A single reference gives one entry, a list gives all of them (up to 25). A blank field is `null`. For other field types `entries` is `[]`.
- **Subscriptions:** show them only from `product.sellingPlanGroups.nodes[].sellingPlans.nodes` (name, description, `priceAdjustments`). `getProduct` does not ask Shopify for plan prices, so show the plan's name, description and adjustment exactly as Shopify states it (a percent or a fixed amount), show no computed price, and let the cart's cost show the real price. Never work out a subscription discount in the browser. The cart line gets the plan: `{ merchandiseId, quantity, sellingPlanId }`. When `product.requiresSellingPlan` is true, the shopper must pick a plan before adding; do not offer a one-time purchase.
- **Stock:** "Only N left" comes only from `getProductStock(handle)` (a server component call; it answers `{ [variantId]: quantity | null }`). Shopify answers only when the Storefront token has the `unauthenticated_read_product_inventory` scope. Without it the call throws a message naming the scope. Catch that one call, hide the stock line, and tell the owner. The rest of the page does not depend on it. Never show a stock number the owner did not ask for or Shopify did not send.

## Header, footer, policies and pages

Menus, policy text and info pages are written in the Shopify admin. Read them; do not type them into the frontend. They live in `@/lib/shopify` too, and a root layout can read them:

```tsx
// <app>app/layout.tsx
import { getShop, getMenu, menuLinks } from "@/lib/shopify";

const ROUTES = [/^\/collections\//, /^\/products\//, /^\/pages\//, /^\/policies\//]; // the routes this site has

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const shop = await getShop();
  const hosts = [shop.primaryDomain.host];
  const header = menuLinks(await getMenu("main-menu"), { hosts, routes: ROUTES });
  const footer = menuLinks(await getMenu("footer"), { hosts, routes: ROUTES });
  // <html>... render shop.name, header.links, footer.links in their header and footer
}
```

- `getShop()` gives `name`, `description`, `primaryDomain` and `brand` (slogan, logo). Use them for the logo text and the footer line.
- `getMenu(handle)` returns `null` when the menu does not exist. Shopify's own menus are `"main-menu"` and `"footer"`.
- `menuLinks(menu, { hosts, routes })` turns Shopify's full URLs into paths on this site and marks outside links `external`. A link to a path with no matching route is removed from `links` and returned in `dropped`; if it has sub-links that do have a route, those move up into its place in `links`. List every dropped link for the owner (they either need a page here or a different link in Shopify).
- `getPolicies()` lists the policies the shop has written (each has `title`, `handle`, `body`) and `getPolicy(handle)` reads one; they feed `/policies/[handle]`. Link the footer from `getPolicies()`, not from a typed list. The `body` is HTML from Shopify. `getPolicy` returns `null` for a policy the shop has not written: call `notFound()`.
- `getPage(handle)` feeds `/pages/[handle]` (About, FAQ). Same: `null` means `notFound()`.
- These reads are cached for one hour (Shopify sends no webhooks for them), so an edit in the admin shows up within the hour.
- A failing read in the root layout would break every page, so the layout needs `global-error.tsx`. kit-install adds one when the frontend has none.

### Policy and info pages

kit-install adds two starter routes when the frontend has no folder of that name: `<app>app/policies/[handle]/page.tsx` (reads `getPolicy`) and `<app>app/pages/[handle]/page.tsx` (reads `getPage`). Each shows the title and the body, sets the page title from Shopify, and calls `notFound()` for a handle the shop has not written. They are plain on purpose: give them the frontend's own layout and styles. A frontend that already has an `app/policies` or `app/pages` folder keeps it, and gets no starter.

A frontend's own typed legal page (`/privacy`, `/terms`, `/shipping`, `/returns`...) keeps its URL and its design. Replace only the typed text with the owner's policy from Shopify:

```tsx
// <app>app/privacy/page.tsx: their page, their layout
import { notFound } from "next/navigation";
import { getPolicy } from "@/lib/shopify";

export default async function Privacy() {
  const policy = await getPolicy("privacy-policy"); // or "terms-of-service", "shipping-policy", "refund-policy"
  if (!policy) notFound();
  return <div className="their-prose-class" dangerouslySetInnerHTML={{ __html: policy.body }} />;
}
```

The body is HTML the owner wrote in the Shopify admin (Settings > Policies). `frontend-check` fails on a page under a legal-sounding route that holds long typed text (1,500 or more visible characters) and calls none of `getPolicy`, `getPolicies` or `getPage`. A policy the shop has not written yet is a `null`: tell the owner to write it in Shopify; do not keep the typed text as a fallback.

## Cart

Keep their cart UI and the way it opens. Replace what it stores and what its buttons do.

### The cart API

Everything goes through `POST /api/cart` with a JSON body. On success the response **is the cart** (status 200), or `null` when Shopify is not configured; on failure it is `{ "error": "..." }` with status 400 or 500. It is not wrapped in `{ cart: ... }`.

| Action | Body |
|---|---|
| create with first item | `{ "action": "create", "lines": [{ "merchandiseId": variantId, "quantity": 1 }] }` |
| read back | `{ "action": "get", "cartId": id }` |
| add | `{ "action": "add", "cartId": id, "lines": [{ "merchandiseId": variantId, "quantity": 1 }] }` |
| change quantity | `{ "action": "update", "cartId": id, "lines": [{ "id": lineId, "quantity": 3 }] }` |
| remove | `{ "action": "remove", "cartId": id, "lineIds": [lineId] }` |
| discount code | `{ "action": "discount", "cartId": id, "discountCodes": ["CODE"] }` |

### The pattern

Wrap the root layout once, then call `useCart()` where their cart context used to be. It is not exported from `@/lib/shopify` (that index is server code); import it from its own file.

```tsx
// <app>app/layout.tsx
import { CartProvider } from "@/lib/shopify/cart-provider";
// ... <body><CartProvider>{children}</CartProvider></body>
```

```tsx
// in their cart button, drawer or page ("use client")
import { useCart } from "@/lib/shopify/cart-provider";

const { cart, ready, busy, error, lines, count, add, update, remove, applyDiscountCodes, checkout } = useCart();

add([{ merchandiseId: variantId, quantity: 1 }]);   // add a line (sellingPlanId optional)
update(line.id, 3);                                  // set a quantity
remove(line.id);                                     // take a line out
checkout();                                          // go to Shopify's checkout
```

- Map the names their cart context already uses onto these (`addItem` → `add`, `items` → `lines`, `itemCount` → `count`). Keep their component code; change the context file or the hook it calls.
- `lines` come from `cartLines(cart)`: `id`, `quantity`, `variantId`, `productTitle`, `productHandle`, `variantTitle` (`null` for a one-variant product), `options`, `image`, `unitPrice`, `total`. `unitPrice` is what one item costs in that line (Shopify's `amountPerQuantity`, so a subscription price shows as such), not the variant's list price.
- `count` is Shopify's total quantity. `ready` is false until the stored cart has been read back: show no "empty cart" before then.
- The store does one change at a time, so a double click cannot add twice (`busy` is true meanwhile). When Shopify says the stored cart no longer exists (after checkout or expiry), it forgets it and the next add starts a new one. On any other error it keeps the cart as it was and puts the message in `error`: show it near the button.
- The cart id is kept in the browser's `localStorage` under `shopify-cart-id`.

**If their cart must stay a different store library** (Redux, Zustand, their own reducer), call `/api/cart` yourself with the kit's client and keep the same rules (one change at a time, handle a cart that is gone, show errors, keep the cart on error):

```ts
// The kit ships the /api/cart client: it reads the cart correctly and throws on failure.
import { cartAction, isShopifyCartId } from "@/lib/shopify/cart-client";

const CART_ID_KEY = "shopify-cart-id";

export async function addToCart(variantId: string, quantity = 1) {
  const cartId = localStorage.getItem(CART_ID_KEY);
  const lines = [{ merchandiseId: variantId, quantity }];
  const cart = isShopifyCartId(cartId) ? await cartAction({ action: "add", cartId, lines }) : await cartAction({ action: "create", lines });
  if (!cart) throw new Error("This shop is not connected to Shopify yet.");
  localStorage.setItem(CART_ID_KEY, cart.id);
  return cart;
}
```

- **Own store only, on load:** if a cart id is stored, `get` it. If that returns `null` (Shopify drops carts after checkout or expiry), remove the stored id and start empty.
- **Own store only, state:** hold Shopify's cart in their existing context or store. Map it to their line shape for display: `cart.lines.edges[].node` has `id`, `quantity`, `cost.totalAmount` and `merchandise` (the variant: `title`, `price`, `selectedOptions`, and `product.title`, `product.handle`, `product.featuredImage`).
- **Totals:** show `cart.cost.subtotalAmount` / `cart.cost.totalAmount`. Never add prices up in the browser; Shopify applies discounts and tax.
- **Checkout button:** `checkout()` from `useCart()` (or `window.location.href = cart.checkoutUrl`). Their fake `/checkout` page and card form are dead code once the button goes to Shopify: see "Dead code" below.
- **Errors:** show the message near the button and keep the cart as it was. Never pretend an item was added when the request failed.

### Variants

Every add needs a **variant id** (`gid://shopify/ProductVariant/...`). A product with one variant: use `variants.edges[0].node.id`. Several variants (size, colour): use their picker if the design has one, and find the variant whose `selectedOptions` match the picked values. No picker in the design: ask the owner before adding one.

## Shopify analytics (visits and page views)

Follow [shopify-analytics.md](shopify-analytics.md) to explicitly enable and configure the single official sender, consent controls, public paths, install checks and actual dashboard evidence. Mount `<ShopifyAnalytics />` once. Preserve the existing product and cart hooks; they require the documented experimental opt-in and separate verification. The analytics release's verified scope is visits and page views only; product/cart events and checkout attribution stay unverified, and each storefront needs its own dashboard check.

## Things Shopify does not have

"Hide it and list it" is the rule: hide that bit of UI, add it to the list you give the owner, and ask where it should come from.

| Their UI | What to do |
|---|---|
| Ratings, review counts, reviews | When the owner wants reviews: `getReviews({ product })` and `reviewSummary(reviews)`. Otherwise hide. |
| Address, phones, email, opening hours, map, founding year, delivery terms, price note, bank details | `getStoreProfile()`; hide each field that is `null` (or an empty list). |
| FAQ | `getFaq()`; hide the section when it is empty. |
| Announcement bar, free-shipping line, guarantees, social links | Hide and list. |
| Contact form, newsletter sign-up | POST to `/api/contact` (see the codes below). Show a plain error for `not_configured`. |
| Hero copy, slogans and pictures | `getHeroSlides()`: the owner's slides from Content > Metaobjects. Empty: hide the hero. |

`frontend-audit` finds these in their code and `frontend-check` fails while they still reach customers:

- **Invented fields** that hold a typed value (`rating: 4.8`, `reviews: [...]`, `badge: "Sale"`, also `reviewCount`, `stockLeft`, `subscribable`). A type (`rating: number`) or a value read from somewhere (`reviews: getReviews()`) is not one.
- **Typed-in menus, policy text and store claims** in the frontend's site data files.
- **Typed claims in pages and components**: promises about the shop (free delivery, VAT included, returns within N days, "since 1998", made in..., star ratings, review counts, money-back, secure checkout), in English and Greek; the shop's name typed outside the one place it was found; the root layout's typed `metadata` title and description; the home page's typed headline; stock photos (Unsplash, Pexels, placeholder services), also in `next.config`.
- **Legal pages with typed text** (see "Policy and info pages").
- **Shop-details modules**: an exported object holding two or more shop details as typed values (address, phone, email, opening hours, IBAN, map link, founding year, VAT number...) that a page or component imports.
- **Card payment forms.** A card form never stays: payment is Shopify's checkout (it is deleted, see "Dead code" below).

Data files nothing imports, and test files, do not count. Each finding is a `file:line` to open and confirm: detection is heuristic.

Fixing a finding never means redesigning. Keep their markup and styles and change only where the words come from: the name and description from `getShop()`, policies from `getPolicy()`, shop details from `getStoreProfile()`, the FAQ from `getFaq()`, the hero from `getHeroSlides()`. A claim Shopify cannot supply is hidden, not reworded, and listed for the owner. Ask the owner where pictures should come from before removing a stock photo.

### Shop details and FAQ

The kit always defines two content types for this (step `content-types`), and the owner fills them in under Content > Metaobjects (step `shop-details`):

- `getStoreProfile()` reads the most recently saved **Shop details** entry. It returns `null` until there is an entry with a business name: hide everything it would show. Otherwise `legalName` is set, and each other field is `null` (or `[]` for `phones` and `openingHours`) when the owner left it blank: hide that bit. `bank` is `null` without an IBAN. `deliveryNote` holds delivery terms the site shows (for example "delivery cost agreed by phone"), and `priceNote` a line like "VAT included".
- `getFaq()` reads up to 100 **FAQ** entries, in the owner's order (lowest `Order` first; entries without one go last). An entry without a question or an answer is left out. It returns `[]` until the owner adds some: hide the FAQ section.

```tsx
// <app>app/contact/page.tsx: their page, their markup
import { getStoreProfile } from "@/lib/shopify";

export default async function Contact() {
  const shop = await getStoreProfile();
  return (
    <section className="their-contact-class">
      {shop?.address && <p>{shop.address}</p>}
      {shop?.phones.map((phone) => <a key={phone} href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>)}
      {shop?.openingHours.map((line) => <p key={line}>{line}</p>)}
    </section>
  );
}
```

Both are content reads: cached for an hour, they throw when Shopify fails, and they need the same token permission as the hero (see below). The kit's Admin definitions of the two types are UNVERIFIED: they have not been created on a development store yet, so check them there before relying on them. Never type a phone number, address, IBAN or opening hours into the code, not even "until the owner fills it in".

### Reviews and the hero

- `getReviews({ product, first })` reads the 250 most recently saved Customer review entries (optionally only one product's). `reviewSummary(reviews)` gives `{ count, average }`. Show stars only when `count` is above zero.
- `getHeroSlides()` reads at most 20 Hero slide entries, in the owner's order. A slide's `href` is the owner's raw link text: render it as a link only when it starts with `/` or `https://`, otherwise show the slide with no link.
- `getMetaobjects(type)` is the generic read for any other content type.
- Content is cached for an hour and no webhook refreshes it. A new slide or review shows on the site within the hour. Tell the owner to save each entry with status Active.
- The Storefront token needs the `unauthenticated_read_metaobjects` permission. Without it `getHeroSlides`, `getReviews`, `getStoreProfile` and `getFaq` throw. Unverified: whether the Headless channel grants that permission by default. Check the token's permissions in the Headless channel.

## Contact form

The contact form and the newsletter box both post JSON to `/api/contact`.

| Body | Fields |
|---|---|
| Contact message | `{ "type": "contact", "name", "email", "phone"?, "subject"?, "message", "website"? }` |
| Newsletter | `{ "type": "newsletter", "email", "website"? }` |

The answer is `{ "ok": true }` or `{ "ok": false, "error": "<code>" }`.

| Code | Status | Meaning |
|---|---|---|
| `invalid_json` | 400 | The body was not JSON. |
| `invalid_email` | 400 | The email does not look like an email. |
| `missing_fields` | 400 | A required field is empty. |
| `not_configured` | 503 | The host has no mail settings yet. Show a plain error. |
| `send_failed` | 502 | The mail service refused it. Show a plain error and let them retry. |

The code is not a sentence: show your own text, in the shop's language.

`website` is a trap for spam robots. Put it in the form, hidden from people: visually hidden, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"`. If it is visible, browser autofill fills it and real messages are silently dropped.

The endpoint has no rate limit. Ask the host to rate-limit `POST /api/contact` at its edge or firewall.

## Page metadata

Titles, descriptions, canonical paths and link-preview photos come from Shopify's own fields. `productMetadata` and `collectionMetadata` (in `src/lib/shopify/seo.ts`) return the full title as `<title> | <shop name>`.

In the root layout set `metadataBase` from `NEXT_PUBLIC_SITE_URL` (the image build bakes that one, not `SITE_URL`), and do not set a `title.template`, or the shop name appears twice.

```tsx
// app/layout.tsx
export const metadata = { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000") };
```

```tsx
// app/products/[handle]/page.tsx
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [product, shop] = await Promise.all([getProduct(handle), getShop()]);
  return product ? productMetadata(product, { path: `/products/${handle}`, shopName: shop.name }) : {};
}
```

## Dead code

Once nothing imports or calls them, the agent deletes, in its own commit, and lists for the owner:

- old code that reads the hardcoded data (helpers like `lib/products.ts`, components like `Stars.tsx`),
- the fake product API route,
- the fake checkout page and any card form,
- older Shopify code moved aside to `<app>lib/shopify-old` (see "Frontend already has Shopify code").

**Before deleting a fake checkout**, copy the audit's "Payment and delivery choices typed into the checkout" into the owner list, with their `file:line`: cash on delivery (and any fee it charged), bank transfer, IRIS, instalments, PayPal, pickup from the shop. They are the owner's rules, and the page is the only record of them. The owner recreates them in Shopify in the setup steps `payments`, `cod-payment` and `local-pickup`. The audit only lists them; `frontend-check` does not fail on them. Shopify may not offer each one as the old page did (a cash-on-delivery fee, for example): that is the owner's decision, so list it, do not drop it silently.

What those steps (shown by `pnpm shop-setup next`) ask of the owner:

- `payments`: bank transfer as a manual payment method (Settings > Payments > Manual payment methods > Bank deposit) with the IBAN in its instructions; IRIS through a payment provider that offers it, which the owner chooses.
- `cod-payment`: cash on delivery as a manual payment method. If the old checkout charged a fee for it, the owner decides: drop the fee, add it to the delivery rate, or use an app.
- `local-pickup` (optional, a browser step after `shipping`): Settings > Shipping and delivery > Local pickup for the shop's location, with a pickup message. Done when a test checkout offers pickup.
- `intake`: delivery priced case by case ("agreed by phone") is a rate with price 0 whose name says so, with the terms in the shop details' delivery note.
- `shop-details`: the owner fills in Shop details and the FAQ under Content > Metaobjects, each entry Active.

UNVERIFIED until checked on a development store: whether Shopify can charge a cash-on-delivery fee, the Admin API call for local pickup (the step uses the admin instead), and shipping rates by region inside one country (they need Shopify's province codes for that country; for Greece this is not known yet).

The old data files themselves (`src/data/*`) are not deleted: list them as unused until the owner agrees. Search for imports and calls before each delete, and run `frontend-check` after.

## Errors

kit-install adds `<app>app/error.tsx` and `<app>app/global-error.tsx` (so `src/app/` or `app/`) when the frontend has none. Every catalogue and content read throws when Shopify fails, and those pages are what the shopper sees then. Never catch a Shopify error to show something else in its place (an empty list, a default price, an old copy of the text). A missing product, collection, page or policy is a `null`, not an error: `notFound()`.

## No development store yet? Practise on mock.shop

[mock.shop](https://mock.shop) is Shopify's public demo Storefront API. It answers the same requests as a real store and needs no token, so it proves the wiring against real Shopify responses (products, images from `cdn.shopify.com`, a real cart and a `checkoutUrl`) before the owner's store exists:

```env
# .env.local
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=mock.shop
NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=mock-shop-needs-no-token
```

What it does not prove:

- Its products are not the owner's, and its prices are in CAD. Show whatever currency Shopify sends.
- Search matches loosely, so results can include products that do not obviously fit.
- It has no collection filters, no extra fields (metafields come back `null`), no subscriptions, no entries of the kit's content types (shop details, FAQ, hero slides, reviews) and only two info pages (`contact`, `liquid`). Those parts of the wiring cannot be seen working there: say "unverified" for them. It does have menus, the four policies and stock counts, and its colour options carry swatches (for example the product `hoodie`), so swatches and sold-out greying can be practised there.
- A cart that no longer exists is handled (adding to it answers "The specified cart does not exist." and the cart store starts a new one), but a nonsense variant id can still give a cart, so error paths cannot be practised there.
- Its checkout is a demo page that does not show the cart's items.

Switch to the development store's settings for the real `frontend-check` sign-off, and never deploy with mock.shop settings.

The store-side plans can be previewed before any store is connected, too: with no `SHOPIFY_STORE_DOMAIN`, `pnpm shop-setup shipping --dry-run` prints the shipping zone built from `store-setup.config.json` alone, and `pnpm shop-setup webhooks --dry-run --url=https://shop.example.com` plans the webhooks as if none were registered. Both write nothing, call nothing, and say what they could not check. They prove the config reads right, not that the store accepts it.

## Done means

`pnpm shop-setup frontend-check` passes, `pnpm build` passes, `pnpm shop-setup frontend-check --site http://localhost:3000` passes against `pnpm start`, and with the development store's public Storefront token in `.env.local` you clicked through a product list, a product page, add to cart, and the checkout button opened Shopify's checkout. Report anything you did not run as unverified, and the list of fields you hid because Shopify had no value for them.

- `--site` loads the home page and the first product page it links to, and needs Shopify images on both. It follows the first `/product/<handle>` or `/products/<handle>` link. When the site's product route is something else, name it: `pnpm shop-setup frontend-check --site http://localhost:3000 --product-path=/item/`.
- A file marked `// shop-setup-check: shows no products - <reason>` is left out of the caching check, and the check prints it with its reason every time (see "Caching and images"). Tell the owner about each one.
