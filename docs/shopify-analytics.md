# Shopify visits and page views

The kit uses one official Headless analytics bus and CDN sender, with `@shopify/hydrogen` pinned to `2026.10.0-preview.4`. This framework-neutral [developer preview](https://shopify.dev/docs/storefronts/headless/developer-preview) can change. Revalidate the package and CDN behavior before any upgrade. Do not add another page-view tracker or mount multiple Shopify runtimes.

## Enable and configure

Analytics is off until explicitly enabled with complete verified public metadata. Keep the existing catalog/cart credential configuration; analytics adds no Admin/private browser credential. Verify the permanent shop domain and Shop ID in the correct store, and use that store's localization. Never copy another client's values.

```sh
pnpm shop-setup analytics-configure --enable --shop-id=<verified-shop-id> --origins=https://<frontend-domain> --country=<country-code> --language=<language-code> --currency=<currency-code> --paths=/,/contact,/privacy,/terms --product-prefix=/products --dry-run
# Remove --dry-run once the public settings are correct.
```

This writes only the selected public analytics settings to `.env.local`, retaining other settings. Add the same settings to the host and restart the server. For several frontend aliases, comma-separate exact HTTPS origins without trailing slashes. Explicit loopback rehearsal requires `--local` and a matching `http://localhost:<port>` origin; do not expose it through a public tunnel.

Equivalent server settings:

```env
SHOPIFY_ANALYTICS_ENABLED=1
SHOPIFY_ANALYTICS_SHOP_ID=<verified numeric Shop ID or gid://shopify/Shop/ID>
SHOPIFY_ANALYTICS_ORIGINS=https://<frontend-domain>
SHOPIFY_ANALYTICS_COUNTRY=<country-code>
SHOPIFY_ANALYTICS_LANGUAGE=<language-code>
SHOPIFY_ANALYTICS_CURRENCY=<currency-code>
SHOPIFY_ANALYTICS_PUBLIC_PATHS=/,/contact,/privacy,/terms
SHOPIFY_ANALYTICS_PRODUCT_PATH_PREFIX=/products
SHOPIFY_ANALYTICS_EXPERIMENTAL_EVENTS=0
```

The permanent `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` or `SHOPIFY_STORE_DOMAIN` remains required. Analytics uses no Storefront token in the browser. Static public paths are exact allowlisted routes; queries/fragments are discarded. A dynamic product URL is admitted only after the server verifies its handle through the existing Shopify SDK. Unknown handles, accounts and private paths are excluded. Add localized public paths/prefixes to match the received frontend; do not admit arbitrary user-supplied routes. No client identity, domain or localization is built into the kit.

## Wire consent and navigation

In the root layout:

```tsx
import { ShopifyAnalytics } from "@/lib/shopify/analytics";
// Inside the body, once:
<ShopifyAnalytics />
```

The default controls provide accept, reject, cookie settings and withdrawal. Translate them to the storefront language or keep the received design by passing `withPrivacyBanner={false}` and calling `setAnalyticsConsent(true|false)` from its controls. Keep a persistent settings button (`CookiePreferencesButton` or `openAnalyticsPreferences`). Closing the banner does not grant consent. Do not call an independent CMP that can silently grant statistics: this step requires an explicit saved analytics `yes` in all regions. Direct external Shopify withdrawals block tracking immediately; external acceptance should use `setAnalyticsConsent` so asynchronous readiness is handled correctly.

Saved acceptance/rejection restores through Shopify. Pending, rejected, unavailable, blocked or failed consent emits zero events. Accepting later sends only the current permitted page; earlier history never enters the bus. Withdrawal stops synchronously and serializes consent writes, including a withdrawal during an inflight acceptance. Marketing, preferences and sale-of-data remain false. Ordinary catalog/cart operations do not depend on analytics availability.

Keep the installed `app/api/[version]/graphql.json/route.ts` and `app/api/shopify/analytics/config/route.ts` (or their `src/app/` equivalents). The unstable proxy is reserved for the bounded consent operation; it filters cookies/credentials and every response is private/no-store. Versioned Storefront proxy behavior is retained. CSP needs Shopify CDN scripts, the Monorail endpoint (`https://monorail-edge.shopifysvc.com`), and same-origin consent/config connections. A restrictive inline-script policy also needs the request nonce passed to `<ShopifyAnalytics nonce={nonce} />`. Blocking a resource leaves statistics off.

The final transport boundary removes query strings, fragments, referrers, customer identity and unknown payload fields. Shopify's protocol still includes consented anonymous visitor/session identifiers and browser metadata. Never treat it as anonymous aggregate-only processing.

## Existing product/cart hooks and migration

`ShopifyProductView`, `trackAddToCart` and the `CartProvider` hook remain available. They now use the same official sender and require `SHOPIFY_ANALYTICS_EXPERIMENTAL_EVENTS=1` (or `analytics-configure --experimental-events`). The default is page views only. This is a deliberate behavior change: existing installations need explicit enable/configuration and optional event opt-in after updating the kit. Product/add-to-cart transport is covered by mocked checks; dashboard attribution is unverified. Purchases and checkout attribution are outside this implementation.

The cart fragment now selects `updatedAt`, needed by the official cart delta tracker to deduplicate. Older custom cart queries must add it. Cart access keys are stripped from analytics identifiers. The old `shop` component prop and `getShopAnalytics()` remain available for source compatibility, but runtime analytics configuration comes from the server endpoint. The legacy event-format helpers remain for consumers/tests and are not a second active sender.

The installer copies all TypeScript runtime modules, routes, tests and this guide to root-app and src-app projects, adds the exact production dependency, refuses incompatible dependency/file conflicts, and is idempotent. Review existing installations' diffs before updating; it never overwrites differing files automatically.

## Verification and dashboard evidence

```sh
pnpm shop-setup analytics-check
pnpm test:scripts
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm shop-setup analytics-check --site=https://<frontend-domain>
```

`analytics-check` checks public configuration, wiring and the pin; `--site` checks the deployed public config and cache boundary. It never publishes an event. Run the mocked browser rehearsal with `pnpm exec playwright test e2e/analytics.spec.mjs --project=desktop`; this builds a temporary isolated page and stubs Shopify resources/transport, never contacting a store. Test pending/reject zero events, accept/current-page-only, saved choices, transitions/back navigation, immediate withdrawal, and blocked resources with navigation/cart still usable. The pure tests also cover the actual pinned official bus, race conditions, Unicode routes, host boundaries and payload filtering.

For a real store, the owner separately opens the deployed permitted frontend in a private session, accepts statistics, visits public pages and verifies the correct store's Shopify **Analytics > Live View**, then later sessions/page-view reporting. Record the site origin, time, consent state and observed dashboard evidence with `pnpm shop-setup done live-view "<evidence>"`. Delayed/missing reporting stays **unverified**. Monorail HTTP success is transport evidence, not dashboard attribution proof. Local mocked tests cannot mark this step done. `go-live` waits for `analytics-check` and `live-view` through the setup registry.

The reference Xristos release `f55ba8eff23ebb29aecd9f39b7d8da859fb005b6` recorded successful page-view transport and owner-confirmed Live View. That evidence applies to its visits/page-view implementation, not every new store, browser, product/cart event or purchase/checkout attribution. Each installed storefront requires its own dashboard verification.

Disable with `pnpm shop-setup analytics-configure --disable` locally, and set `SHOPIFY_ANALYTICS_ENABLED=0` on the host and restart. New configuration requests refuse tracking; reload existing tabs when validating a disable/rollback. A rollback reverts the kit update and matching dependency/lockfile, then repeats consent checks before use.
