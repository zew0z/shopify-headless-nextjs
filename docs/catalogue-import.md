# Building the catalogue

Turn whatever the client has (a vendor feed, a sheet, a scrape, photos) into one
source module under `scripts/catalogue/sources/`. Then `pnpm shop-setup
catalogue-build` merges and validates it into `data/catalog.json`, and the push
tools take it from there. The shape and every rule are in
`scripts/catalogue/format.mjs`; do not invent a second contract.

Copy feeds into `data/feeds/` (not `~/Downloads`) so the build is reproducible.

## Push behavior

`pnpm shop-setup catalogue --dry-run` validates and prints a plan without network
calls or writes. A normal `catalogue` push writes collections and products, then
publishes each to every returned sales channel. It is not a draft-only importer:
setting a source product's `status` to `DRAFT` does not suppress the publication
requests. For a draft-only import, use a separately reviewed workflow that keeps
products in `DRAFT` and collections unpublished, with no publication mutations.

Collection creation uses `collection: CollectionCreateInput`; updates use
`collection: CollectionUpdateInput`. Collection images use `ImageInput.altText`
(the collection title), while Shopify Files uploads use `FileCreateInput.alt`.
These are different input types. Keep the API version explicit and inspect its
schema before adapting payloads; mocked tests do not prove a live store accepts
every import field. See the [collection creation reference](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/collectionCreate),
[collection update reference](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/collectionUpdate)
and [image input reference](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/ImageInput).

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
(`stagedUploadsCreate`, then `fileCreate`). Push again with
`--rehost=<host>`: the kit downloads those photos and uploads them to Shopify
Files, saving the url map in `data/image-map.json` (commit it). Photos that still
fail are listed; give that list to the owner. Image processing is asynchronous: a
clean `productSet` does not mean the pictures landed.

## Extra fields and content entries

A source can return more than products and collections:

- `definitions`: the content types (`metaobjects`) and extra product fields
  (`metafields`) the source needs.
- `metaobjects`: the entries of those content types, each with a `type`, a
  `handle` and its `fields`.
- `refs` on a product metafield: the entries it points at, named `type/handle`.

One example return value:

```js
return {
  definitions: { metaobjects: [{ type: "color_swatch", name: "Colour", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field", required: true }, { key: "hex", name: "Hex", type: "single_line_text_field" }] }] },
  metaobjects: [{ type: "color_swatch", handle: "grey", fields: { label: "Grey", hex: "#8a8a8a" } }],
  collections: [],
  products: [{ handle: "milano", title: "Milano", variants: [{ sku: "M-1", price: "899" }], metafields: [{ namespace: "custom", key: "color", type: "list.metaobject_reference", refs: ["color_swatch/grey"] }] }],
};
```

Every metafield gets a storefront-readable definition automatically. `refs` name
entries by `type/handle`. `pnpm shop-setup definitions --dry-run` shows what
would be created.

## Testing a source

Unit-test it next to the module with `node --test`, against REAL rows. Assert
exact counts derived from the real feed (products, variants, how many have more
than one variant). When a test fails, work out which side is wrong; an
expectation written from a guess is worth less than the implementation.

## The CSV shortcut

Shopify's Products > Import takes a CSV and suits a small hand-kept catalogue. It
allows one collection per product, sets no metafields, and is not usefully
idempotent. Products must still be published to the Headless channel afterwards.
