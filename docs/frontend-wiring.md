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

If the frontend called its own fake API (`fetch("/api/products")`), replace the call with the SDK function and delete the fake route only after nothing calls it.

| Their data | SDK function |
|---|---|
| list of all products | `getProducts({ limit, sortKey, reverse, query })` |
| one product page | `getProduct(handle)` |
| "you may also like" | `getProductRecommendations(product.id)` |
| category / collection list | `getCollections()` |
| category page | `getCollection(handle)` + `getCollectionProducts({ handle, limit, sortKey })` |
| search box | `GET /api/search?q=...` (already installed) or `predictiveSearch(q)` on the server |

A product that is not found returns `null`: call `notFound()` from `next/navigation`. A Shopify failure throws; let it reach the frontend's `error.tsx` (add a plain one if they have none) rather than catching it and showing something else.

### 4. Caching and images

- Remove `export const dynamic = "force-dynamic"`, `fetchCache = "force-no-store"`, `revalidate = 0` and `cache: "no-store"` from pages and layouts that show products. Keep them on pages that are about one visitor (cart page, account).
- In `next.config.*`, add Shopify's image host:

```ts
images: { remotePatterns: [{ protocol: "https", hostname: "cdn.shopify.com", pathname: "/**" }] },
```

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

- **On load:** if a cart id is stored, `get` it. If that returns `null` (Shopify drops carts after checkout or expiry), remove the stored id and start empty.
- **State:** hold Shopify's cart in their existing context or store. Map it to their line shape for display: `cart.lines.edges[].node` has `id`, `quantity`, `cost.totalAmount` and `merchandise` (the variant: `title`, `price`, `selectedOptions`, and `product.title`, `product.handle`, `product.featuredImage`).
- **Totals:** show `cart.cost.subtotalAmount` / `cart.cost.totalAmount`. Never add prices up in the browser; Shopify applies discounts and tax.
- **Checkout button:** `window.location.href = cart.checkoutUrl`. Remove their fake `/checkout` page or form, after asking the owner if it has anything they want to keep.
- **Errors:** show the message near the button and keep the cart as it was. Never pretend an item was added when the request failed.

### Variants

Every add needs a **variant id** (`gid://shopify/ProductVariant/...`). A product with one variant: use `variants.edges[0].node.id`. Several variants (size, colour): use their picker if the design has one, and find the variant whose `selectedOptions` match the picked values. No picker in the design: ask the owner before adding one.

## No development store yet? Practise on mock.shop

[mock.shop](https://mock.shop) is Shopify's public demo Storefront API. It answers the same requests as a real store and needs no token, so it proves the wiring against real Shopify responses (products, images from `cdn.shopify.com`, a real cart and a `checkoutUrl`) before the owner's store exists:

```env
# .env.local
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=mock.shop
NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=mock-shop-needs-no-token
```

What it does not prove: its products and currency (CAD) are not the owner's, and its checkout is a demo page that does not show the cart's items. Switch to the development store's settings for the real `frontend-check` sign-off, and never deploy with mock.shop settings.

## Done means

`pnpm shop-setup frontend-check` passes, `pnpm build` passes, and with the development store's public Storefront token in `.env.local` you clicked through a product list, a product page, add to cart, and the checkout button opened Shopify's checkout. Report anything you did not run as unverified, and the list of fields you hid because Shopify had no value for them.
