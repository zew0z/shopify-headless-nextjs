# Port of the old kit's pieces: what is left

Not a plan. These are the small items the reviews left open after `2026-10-09-port-old-kit-pieces.md` was built. None of them blocks use.

## Needs a development store (unverified)

- The definition, entry and file-upload calls: their Admin field names, and whether `write_products` covers product metafield definitions.
- Whether the Storefront API hides DRAFT entries, and whether the Headless channel's token has `unauthenticated_read_metaobjects` by default.
- A real email through Resend, and a received repo's image deploying through Flux.
- The `metaobjectsQuery` cost is 13750 at `first: 250` (mock.shop accepted it). Reviews don't need `references(first: 25)`, so a lighter query would be cheaper.

## Small fixes

- Rehost ignores `--limit` and `--only`. Its dry-run line ignores `--skip-images`.
- `applyImageMap` replaces descriptions by substring, so a mapped url that is a prefix of a longer one can corrupt it. Replace the longest keys first.
- A non-image download (an HTML challenge page) is still uploaded. Reject anything that is not `image/*`.
- A corrupt `data/image-map.json` throws without naming the file.
- A list reference with duplicate refs is not flagged.
- Definitions and entries are pushed even with `--only=collections`.
- `/api/contact` treats any `type` other than `newsletter` as a contact message.
- A hero `href` starting with `//` passes the "/ or https://" rule. Clean it inside `toHeroSlide`.
- `collectionMetadata` keeps an empty `altText` instead of falling back to the title.
- The workflow's summary line prints the landings url even when `vars.SITE_URL` is set.
- The Dockerfile does not copy `.npmrc` or patches for pnpm repos.
- `metafieldDefinitions` and `metaobjectDefinitions` read `first: 250` with no paging. Add a comment.
- Unused `existsSync` import in `scripts/catalogue/rehost.test.mjs` (the one lint warning).

## Test gaps

- An end-to-end push-flow test: entries plus `refs` resolving into `productSet`, and the rehost block inside `pushCatalogue`.
- Push tests for the update shapes (`UPDATE_FIELD`) and for a second run changing nothing.
- Review edge cases (rating "4.5" or "0", undated reviews last), rank ties, and `revalidate === 3600`.
- `/api/contact` status mapping, and `reply_to` reaching Resend.
- `collectionMetadata`.
