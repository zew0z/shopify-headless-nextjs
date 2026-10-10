# Shopify API gotchas

Exact error text, because that is what gets searched. Introspect before trusting
any shape here: `node scripts/shopify/introspect.mjs <InputTypeName>`.

## Versions

### The store "works" but behaves differently from what was tested
An expired API version is not rejected: Shopify silently serves the oldest
supported one and sets `X-Shopify-API-Version`. `pnpm shop-setup preflight` and
`catalogue-verify` compare requested against served. The SDK in `src/lib/shopify`
defaulted to `2025-01` (expired) and is now `2026-07`. Any deployed environment
that sets `SHOPIFY_STOREFRONT_API_VERSION=2025-01` explicitly still overrides the
default: change it there.

### Re-checking the frontend's queries after a version change
`pnpm shop-setup validate-queries --version=2026-07` validates every Storefront
query and mutation in `src/lib/shopify` against Shopify's real schema through the
public proxy on shopify.dev. No store or token is needed, and nothing executes
(variables are deliberately invalid). The proxy answers `Invalid API version` for
an expired version, which is itself a useful check. Supported versions as of
2026-10-04: 2026-01, 2026-04, 2026-07, 2026-10.

### Fragment name "ImageFragment" must be unique
A document defined the same fragment twice. `productFragment`, `collectionFragment`
and `cartFragment` each embed `imageFragment`, so using two of them in one
document repeats it. `dedupeFragments()` in `src/lib/shopify/queries.ts` drops the
repeats (used by the predictive search query).

### Nullability mismatch on variable $discountCodes and argument discountCodes ([String!] / [String!]!)
`cartDiscountCodesUpdate` takes a required list. Declare `$discountCodes: [String!]!`
and send an empty array to clear the codes.

### Field 'cartGiftCardCodesRemove' is missing required arguments: appliedGiftCardIds
Gift cards are removed by applied-card id, not by code. Take the ids from
`cart.appliedGiftCards[].id` (the cart query now selects `id`). `/api/cart`
`removeGiftCard` takes `appliedGiftCardIds` and answers 400 to the old
`giftCardCodes` body. Not tested with a real gift card, only with an empty list.

### `inventorySetQuantities` fails from 2026-04 without an `@idempotent` key
That mutation requires the directive from API version 2026-04. Unknown for
`productSet` with `inventoryQuantities`: the first live call answers it. Record
the answer here.

## Auth

### "Invalid API key or access token (unrecognized login or wrong password)"
Check the intended API, credential slot and granted scopes. Token strings are
opaque; a prefix such as `shpat_` does not determine API permissions. Storefront
clients read only Storefront settings and use the configured public/private
header. `SHOPIFY_ADMIN_TOKEN` stays separate; there is no fallback to it.
Authentication failures remain errors. See Shopify's
[Storefront authentication reference](https://shopify.dev/docs/api/storefront/2026-07#authentication)
and [Admin app authentication guide](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant?lang=node).

### "Service is not valid for authentication"
An `atkn_` app-automation token against the store Admin API. Valid, but for App
Management only.

### "Access denied for products field"
The token lacks the scope. List what was granted:
`GET https://<store>.myshopify.com/admin/oauth/access_scopes.json`. Scopes apply
at install: add them, release a new app version, **and reinstall**.

### "client credentials grant failed" / shop_not_permitted
The grant only works when the app and the store belong to the same Shopify
organization and the app is installed. A dev store created in the Dev Dashboard
qualifies; a client's own store does not. Use `pnpm shop-setup oauth` for those.
Tokens last 24 hours and `pnpm shop-setup` mints a fresh one per run, in memory.

### OAuth callback: "hmac check failed" or "state mismatch"
The callback is checked against the app client secret, the state nonce and the
shop hostname. A failure means a stale URL (re-run for a fresh one), the wrong
client secret in `.env.local`, or a callback that did not come from Shopify.
The hmac is compared as a hex digest (unverified against a live store).

### The OAuth response contains expires_in
The token is an expiring one and will stop working. The CLI warns. Re-run oauth
when it does.

## Visibility

### Admin shows products, the storefront shows none
They were never published. Both products and collections need
`publishablePublish` to every publication, including Headless. `catalogue`
does this; `catalogue-verify` proves it.

### Storefront API returns `null` for every metafield
The definition lacks storefront visibility: `access: { storefront: "PUBLIC_READ" }`.
The most common cause of an empty filter UI. `pnpm shop-setup definitions`
creates or opens these; the catalogue push runs it first.

### Every webhook delivery is a 401, or 503
401: `SHOPIFY_WEBHOOK_SECRET` differs from the secret that signed the payload.
Subscriptions created through the Admin API are signed with the app client
secret, so set it equal to `SHOPIFY_APP_CLIENT_SECRET`, on the host too.
503: the secret is not set at all. `/api/revalidate` refuses everything until it
is (it used to accept unsigned requests). Shopify gives 5 seconds per delivery and
deletes a subscription after 8 failed retries, so a site with a wrong secret
quietly stops refreshing: re-run `pnpm shop-setup webhooks`.

## Writes

### A write "succeeds" and nothing changed
Shopify returns most failures as HTTP 200 with a populated `userErrors` array.
`adminGraphQL` walks the response and throws on any.

### `identifier` is a mutation argument, not an input field
`productSet(identifier: {handle: "x"}, input: {...}, synchronous: true)` is the
idempotent create-or-update.

### Collection mutation arguments and image text use distinct input types

Use `collectionCreate(collection: $collection)` with `CollectionCreateInput` and
`collectionUpdate(collection: $collection)` with `CollectionUpdateInput`, instead
of the deprecated `input: CollectionInput` argument. Collection image text is
`ImageInput.altText`; `alt` belongs to `FileCreateInput` for Shopify Files uploads.
The catalogue push sends the collection title as its image's `altText` on both
create and update. The current contract is documented in Shopify's
[create reference](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/collectionCreate),
[update reference](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/collectionUpdate)
and [ImageInput reference](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/ImageInput).

A normal catalogue push also calls `publishablePublish`; it must not be used for
an import required to remain draft-only and unpublished. Compatibility changes
to collection inputs do not change that publication behavior.

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
