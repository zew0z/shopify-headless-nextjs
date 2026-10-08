# Wiring a received frontend to Shopify

Read this after `kit-install` and before touching the frontend's code. The rule throughout: **keep their design, change where the data comes from.** Their components, class names, layout and copy stay. You add a mapper and swap data sources.

Paths below use `<app>` for the frontend's app root: `src/` when it has `src/app`, otherwise the repo root. The SDK is at `<app>lib/shopify`; import it as `@/lib/shopify` if the repo has the `@/*` alias, else with a relative path.

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

## Shopify analytics (Live View)

A headless site sends Shopify nothing on its own, so the shop's Live View and visitor reports stay empty. The kit sends what Hydrogen sends: a page view on every navigation, product views and add to cart. It sends nothing until the visitor consents.

1. **Root layout** (a server component):

   ```tsx
   import { getShopAnalytics } from "@/lib/shopify";
   import { ShopifyAnalytics } from "@/lib/shopify/analytics";

   export default async function RootLayout({ children }) {
     const shopAnalytics = await getShopAnalytics(); // null (with a console error) when it cannot work; never throws
     return (
       <html><body>
         {children}
         <ShopifyAnalytics shop={shopAnalytics} />
       </body></html>
     );
   }
   ```

2. **Product page**: wherever the selected variant lives (usually their client product form), render `<ShopifyProductView product={product} variant={selectedVariant} />`. It renders nothing.
3. **Cart**: the kit's `CartProvider` reports adds itself. If the site keeps a cart of its own, call `trackAddToCart(cart, lines)` from `@/lib/shopify/analytics` with Shopify's cart after each successful add.
4. **Keep the route `app/api/[version]/graphql.json/route.ts`** (kit-install adds it). Shopify's privacy script asks for the visitor's consent and ids through the site's own domain; without the route no visitor is counted. If the frontend already has a dynamic folder directly under `app/api/` (like `app/api/[slug]`), Next refuses two different names at that level: ask before renaming theirs.
5. **Consent**: `<ShopifyAnalytics>` loads Shopify's own cookie banner, which the owner turns on in the admin (Settings > Customer privacy > Cookie banner). If the design has its own banner, pass `withPrivacyBanner={false}` and have their banner call `window.Shopify.customerPrivacy.setTrackingConsent({ analytics, marketing, preferences, sale_of_data }, callback)`. The kit adds the headless settings to that call.
6. **Content security policy**, if the site has one: allow scripts from `https://cdn.shopify.com` and connections to `https://monorail-edge.shopifysvc.com`.
7. **Checkout domain**: `getShopAnalytics` takes it from the shop's primary domain, which the store setup makes `checkout.<siteDomain>`. The site and checkout must share that domain for Shopify to link the visit to the order.

**What counts as verified.** Visits from `localhost` are marked as the shop owner's own, so they cannot be expected in Live View. Locally you can check only the plumbing: the script from `cdn.shopify.com` loads, `POST /api/unstable/graphql.json` answers 200, and after you accept cookies the browser sends to `monorail-edge.shopifysvc.com`. Live View itself is checked on the deployed site (setup step `live-view`). Say "unverified" until then.

**When Shopify changes its format.** `src/lib/shopify/analytics-events.ts` copies the event code of `@shopify/hydrogen-react` (version in `ANALYTICS_FORMAT_VERSION`), and `scripts/shopify/analytics-events.test.mjs` compares its output with `scripts/shopify/fixtures/monorail-hydrogen-react.json`. To move to a newer version: in a scratch folder, `pnpm add @shopify/hydrogen-react@<version>`, call its `sendShopifyAnalytics` with the fixture's `input` for each case (with `globalThis.fetch` stubbed to capture the body), save the events with the `volatile` keys removed as the new fixture, then change `analytics-events.ts` until the test passes.

## Things Shopify does not have

"Hide it and list it" is the rule: hide that bit of UI, add it to the list you give the owner, and ask where it should come from.

| Their UI | What to do |
|---|---|
| Ratings, review counts, reviews | Hide. Ask: a reviews app, or product metafields? |
| Announcement bar, free-shipping line, contact email, social links | Hide and list. Open decision: whether these come from a "store settings" metaobject. |
| Newsletter sign-up | Hide unless a sign-up service is connected. Ask. |
| Hero copy and slogans | Use `shop.name`, `shop.description` and `shop.brand`, or ask the owner for the words. |

`frontend-audit` finds these in their code (invented fields like `rating`, `reviewCount`, `reviews`, `stockLeft`, `badge`, `subscribable`, typed-in menus, policy text and store claims, card payment forms) and `frontend-check` fails while they still reach customers. A card form never stays: payment is Shopify's checkout (it is deleted, see "Dead code" below).

## Dead code

Once nothing imports or calls them, the agent deletes, in its own commit, and lists for the owner:

- old code that reads the hardcoded data (helpers like `lib/products.ts`, components like `Stars.tsx`),
- the fake product API route,
- the fake checkout page and any card form.

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
- It has no collection filters, no extra fields (metafields come back `null`), no subscriptions and only two info pages (`contact`, `liquid`). Those parts of the wiring cannot be seen working there: say "unverified" for them. It does have menus, the four policies and stock counts, and its colour options carry swatches (for example the product `hoodie`), so swatches and sold-out greying can be practised there.
- A cart that no longer exists is handled (adding to it answers "The specified cart does not exist." and the cart store starts a new one), but a nonsense variant id can still give a cart, so error paths cannot be practised there.
- Its checkout is a demo page that does not show the cart's items.

Switch to the development store's settings for the real `frontend-check` sign-off, and never deploy with mock.shop settings.

## Done means

`pnpm shop-setup frontend-check` passes, `pnpm build` passes, `pnpm shop-setup frontend-check --site http://localhost:3000` passes against `pnpm start` (it loads the home page and one product page and needs Shopify images on both), and with the development store's public Storefront token in `.env.local` you clicked through a product list, a product page, add to cart, and the checkout button opened Shopify's checkout. Report anything you did not run as unverified, and the list of fields you hid because Shopify had no value for them.
