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
