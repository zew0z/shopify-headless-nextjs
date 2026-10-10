# Connect an Astro storefront to Shopify

The Astro adapter supports Astro 7 with `output: "server"` and an SSR adapter. It was developed against the user-authorized NOTIXV landing-template at `16547938abc582f0627c74208f8e357e0fa160b2`, using its provider-independent commerce contract. Preserve the site's `.astro` pages, locales, styling, Actions, cookie handling, CSP, middleware and deployment adapter.

From this toolkit, run `pnpm shop-setup frontend-audit <frontend>` and `pnpm shop-setup kit-install <frontend> --dry-run`, then install locally after reviewing conflicts. The installer adds `src/lib/shopify/astro`, namespaced setup tools under `scripts/shopify-kit`, adapter tests, and this guide. Existing template `scripts/shopify` tools stay intact. It never adds Next.js, Hydrogen, React, Next routes, deployment files or the Next-only protected connection skill to an Astro site. Existing destination files cause a conflict before anything is written. Move old SDK code aside only after checking its importers and preserving its behavior.

In the received npm repo, run the printed install command, then `npm run test:shopify`, `npm run check` and `npm run build`. Dependency changes are left to npm so its lockfile stays consistent. `npm ci` is the fresh-checkout verification after the printed npm install. For pnpm, use the printed pnpm command. Do not run a template's setup wizard in an established site.

## Credentials and requests

The entry point imports `astro:env/server` and reads runtime settings with `getSecret`. It must only be imported in Astro frontmatter, server modules or endpoints. Astro rejects server environment imports in a browser bundle. Never import it inside `<script>`, a hydrated island, or a browser entry. Only `astro/browser.ts` is the browser cart client; `commerce-types.ts` contains types only.

Set these through the owner's secure local/server environment:

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | Canonical `store.myshopify.com` hostname; a bare store handle is accepted |
| `SHOPIFY_STOREFRONT_TOKEN` | Public Storefront token, kept on the server; `SHOPIFY_STOREFRONT_ACCESS_TOKEN` is an alias |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | Optional private Storefront token; takes precedence and stays on the server |
| `SHOPIFY_API_VERSION` | Quarterly Storefront version, default `2026-07`; `SHOPIFY_STOREFRONT_API_VERSION` is an alias |

No `PUBLIC_` or `NEXT_PUBLIC_` token is required. An Admin token is never used by the storefront. A missing domain or token fails explicitly; the adapter does not invent products or silently select a demo. For generic local testing, explicitly use `SHOPIFY_STORE_DOMAIN=mock.shop`. The public demo receives no store tokens or buyer IP, even if other variables are present. It cannot verify merchant content, stock, shipping, payment or analytics configuration.

Each request supplies its own language, cart token and trusted `Astro.clientAddress`. Do not set a shared global buyer or trust arbitrary forwarded headers yourself. The transport forwards buyer IP only with a private token. Catalogue and cart requests throw on network/GraphQL failures. Network failures never replay cart mutations or create replacement carts: a successful read must first establish that a cart expired.

## NOTIXV template integration

The template already has commerce pages, variant selection, native filters, cookie persistence, cart forms and hosted-checkout handling. Keep them. The adapter implements `CommerceProvider` structurally, with paged products/search/collections, multi-option variants, recommendations, sitemap reads, cart and discount operations, and `checkout.kind = "hosted"`.

In the existing Shopify module's provider entry, after preserving the old implementation and checking importers:

```ts
import { createAstroCommerce } from "@/lib/shopify/astro";
import { getModuleOptions } from "@/modules/registry";
import { shopifyDefaults } from "../options";
import type { CommerceProvider } from "@/modules/commerce/lib/types";

const options = getModuleOptions("shopify", shopifyDefaults);
const adapter = createAstroCommerce({
  country: options.country,
  defaultLanguage: "en", // use the site's configured default locale
  // specMetafields: [{ namespace: "...", key: "..." }], // owner's actual specification keys
});
export const shopifyProvider: CommerceProvider = adapter;
export const getShopInfo = (lang: string) => adapter.getShopInfo(lang);
```

Update the module's `provides.commerce` resolver to select this provider explicitly. Installation alone does not change that resolver. Remove an implicit or credential-selected demo fallback; any retained local demo must be an explicit local test choice. Preserve admin/dashboard callers: if they import the old `getShopInfo`, migrate that call separately rather than deleting a used export.

Keep `src/modules/commerce/lib/cart.ts` and its httpOnly session cookie. It already supplies `lang`, `clientAddress` and the cookie token to the provider and stores the returned token after each mutation. The adapter preserves this contract. Validate forms through the template's existing form helpers. All public links still use the site's localized paths. There is no Next migration.

When selected options are posted, they are authoritative. The adapter resolves them using the product handle and refuses unresolved combinations, even if a form also posts a previously selected hidden variant ID. Missing handles are also refused before any backend call. During manual reconciliation with an older adapter, preserve both the missing-handle guard and the no-fallback return; an existing fix for null variants alone does not cover both. Keep the displayed price, stock, SKU and add button synchronized with that selection. Quantities must be whole numbers: 1–1000 when adding, 0–1000 when updating; zero explicitly removes the line. Do not round or replace malformed form input with a default before validation.

The provider exposes optional `filterKinds = ["collection", "search"]`. Extend an older template's `CommerceProvider` type with `filterKinds?: readonly ListingKind[]` and preserve that property in any bridge. Only show native facet controls when `commerce.filterKinds?.includes(kind) ?? true`. Shopify's all-products query has no native facets: the adapter always returns an empty filter list and rejects nonempty `query.filters` there. Normalize or discard unsupported facet URL parameters before calling it. Collections and search retain their native filters.

Shopify may return both a cart and user errors, or a user error without a cart. Keep the session token on a failed mutation, display the translated error, and use any returned cart as the current state. Public Action/API errors should contain an allowlisted code only; never forward the provider's message, exception text, request payload or access key. A failed read must show an unavailable state or an inert retained snapshot, with retry available and checkout disabled. It must not become an authoritative empty cart.

The template's `checkout.url(session)` retrieves the current Shopify cart's hosted URL. It accepts HTTPS on the configured store or Shopify checkout host, and returns null for an empty/expired cart. Checkout/payment data stays on Shopify. Do not build a card form, supply a guessed checkout URL, or mark payment/shipping verified from a demo checkout link.

Product-specific specification metafields use the owner's real namespace/key choices through `specMetafields` and return as `product.specs`. Preserve and migrate any additional provider fields before replacing site-specific behavior. Product detail reads return the first 10 collections and 250 variants, so verify those caps against the actual catalogue before sign-off.

## Bare Astro sites

Without a template commerce module, kit-install adds `src/pages/api/cart.ts`. Its GET/POST handlers use `createCartEndpoint(createAstroCommerce())`, an httpOnly cookie, exact same-origin checks for mutations, strict action/quantity validation, and private `no-store` responses. Adapt its language option to the site. Cart access keys and credentials are never returned to browser JavaScript.

Call it from a normal bundled script:

```ts
import { createCartClient } from "@/lib/shopify/astro/browser";
const cart = createCartClient();
await cart.add(selectedVariantId, quantity);
const { checkoutUrl } = await cart.checkout();
if (checkoutUrl) window.location.assign(checkoutUrl);
```

The client serializes mutations and propagates errors, keeping the server cookie when a request fails. Public provider errors are `{ error: { code } }`; use the site's translations for known codes. Transport failures return a fixed message with status 502. Keep the existing UI and show an error so a shopper can inspect their cart before retrying. The template's existing progressive forms remain the preferred integration there; do not replace them with this optional API.

Serialization preserves every submitted action. Disable duplicate submissions in the UI and hold its busy lock through mutation, fragment refresh and DOM replacement. Replacement fragments need a stable target; discard superseded search responses and report visible search failures. Do not replay an ambiguous write: read the cart before offering another attempt. Failed removals must restore the visible line and cancel pending removal animation. Clean up cancelled view transitions with both fulfillment and rejection handlers.

Readback recovery requires a known cart token. On a first add, Shopify may create the cart while its response is lost before the server receives the token, or the API may return the token in `Set-Cookie` but that response never reaches the browser. Without the delivered cookie, a subsequent read returns null and cannot identify the created cart; that empty result does not prove the write failed. The adapter never automatically replays the mutation, and its error copy does not promise retention. Deterministic synthetic tests cover both loss boundaries and the absence of replay; they do not establish browser cookie delivery, first-add recovery or cross-tab idempotency. Guaranteed recovery needs a separately designed session/idempotency mechanism and receiver tests.

## Cache, content and validation

Use the template's finite `Astro.cache.set({ maxAge, swr, tags: ["commerce"] })` for public catalogue pages and its verified HMAC webhook invalidation. Cart, checkout and account responses stay `Cache-Control: private, no-store`; never use a shared page cache for them. The adapter deliberately does not send Next-specific fetch options. Do not alter Astro's origin checking, allowed proxy hosts or CSP to make requests pass. Permit Shopify images using existing module CSP and any `astro:assets` remote image rules, then check images in the browser.

Render cart totals from the provider's `cart.total` and line money values, including discounts, rather than adding catalogue prices. Sanitize merchant-authored HTML at the receiver's rendering boundary using its existing sanitizer. Product specifications, long titles, and cart controls must wrap on narrow screens with JavaScript disabled as well as enabled. These rendering, fragment, animation and form concerns belong to the receiver; kit installation alone does not implement them.

`createAstroContent()` exposes the toolkit's owner-authored `getStoreProfile()` and `getFaq()`. The owner must first create/fill the `store_profile` and `faq_item` definitions using the toolkit's separately authorized store setup. Blank profile = null, empty FAQ = []; hide absent fields. Errors remain errors. Cache public content for at most one hour with a content tag. Never fill missing shop details with code literals.

Run `npm run shop-setup -- frontend-check` after connecting the provider. It inspects `.astro` files, adapter wiring, server/browser boundaries, catalogue caching, private carts and typed claims. These are heuristics: review findings and use the compiler and browser checks too. To validate the adapter's GraphQL without any merchant credential, use `pnpm shop-setup validate-queries --framework=astro --version=2026-07` and repeat for `2026-10` from the toolkit; the tool sends deliberately invalid variables to Shopify's schema proxy so operations cannot execute. In an installed Astro repo the validator chooses its adapter documents automatically.

Before sign-off, run the received repo's check/build and npm ci, then browse desktop and mobile products/collections, select each variant, add/update/remove a cart line, refresh to prove cookie persistence, test discounts, and inspect the Shopify-hosted checkout entry. Test the no-JS form path in template sites. Store-specific dashboard analytics, API content definitions, tax, shipping, pickup and payment remain unverified until checked on the development store with explicit authorization. Existing Next-specific analytics components are not installed in Astro; any Astro analytics integration needs a separate consent and dashboard verification task.

In Astro receivers, `analytics-configure` and `analytics-check` stop with a clear unsupported message. Other setup commands load without the Next-only analytics SDK; the analytics command implementation loads only when requested by a Next receiver.

The protected `.claude/skills/shopify-connect-frontend/SKILL.md` remains Next-only and was not changed. This normal guide is the Astro workflow. Updating that protected skill remains a separate approval item.
