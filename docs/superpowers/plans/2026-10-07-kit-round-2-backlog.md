# Kit round 2: backlog from the second rehearsal

Not a plan yet. These are the gaps still open after `2026-10-07-kit-rehearsal-fixes.md` was merged. Turn them into a plan (writing-plans), then rehearse again on a clean copy of the stand-in frontend.

Second rehearsal result (2026-10-07, Sonnet, mock.shop): the agent wrote no Shopify-calling code outside the kit, `frontend-check` passed with and without `--site`, the build passed, and the cart returned a `checkoutUrl`. Log entries fell from 34 to 20.

## Most important

1. **Typed claims in components and pages are invisible.** `frontend-audit` and `frontend-check` only see hardcoded store data in data files. Text typed straight into JSX passes the check. Examples: the shop name in the header and footer, "© 2026 <brand>", hero copy and an Unsplash hero photo, "Free returns within 30 days", "Taxes included", "4.8 stars from 214 reviews", "Made in Portugal". The owner's rule (nothing hardcoded) is not enforced there.
   - Idea: flag JSX text and string literals in `app/` and `components/` that match a claim word list (free shipping, returns, days, taxes, made in, stars, reviews, newsletter, subscribe).
   - Idea: flag the brand name found in the root layout's metadata title when it appears elsewhere.
   - Idea: flag external image hosts such as `images.unsplash.com` in pages.
   - Watch false alarms: their button labels are fine.

## Helpers agents still wrote themselves

2. **"All products" page with filters.** Shopify has no `all` collection, and `getProductsPage` has no filters. Check whether `searchProducts` with an empty or `*` query returns filters on a real store; if so, add `getAllProductsPage`. If not, say in the guide that the filter UI is hidden there.
3. **Sort and filter plumbing.**
   - `sortFor(scope, "price-asc")` across the three sort-key sets.
   - `filtersToSearchParams` / `filtersFromSearchParams`.
   - One load-more server action example covering collection, all and search.
4. **Filter form reference.** A minimal filter form built from `page.filters` (LIST, BOOLEAN, PRICE_RANGE), and a fixture of a real filter response, because mock.shop sends none.
5. **Light product fragment for lists.** Cards carry 50 variants and 10 images, so 12 products came to 97 KB. Add a slim list fragment or option.
6. **`productOptions(product, picked)`.** Return options with swatches and availability, and hide the picker for the "Title / Default Title" option.
7. **Cart extras.**
   - `sellingPlanName` and a compare-at total on `CartLineView`.
   - A guide example that wraps `CartProvider` with the drawer's open/close state.
8. **Menus.**
   - Print or log `menuLinks().dropped` so the owner hears about them.
   - A `footerColumns(menu, policies)` helper that skips policies the footer menu already links.

## Smaller

9. `pnpm shop-setup next` puts the store questionnaire first while frontend steps are open. Hold it back, or say "after the frontend is wired".
10. kit-install leaves the received repo's dead `"lint": "next lint"` script in place, and adds no pointer to `node_modules/next/dist/docs`.
11. The audit counts the word "checkout" in prose and object keys as checkout buttons.
12. `--dry-run` prints "added:" for files it has not written yet.

## Deferred review minors worth doing with round 2

- `[[...slug]]` does not match zero segments, so a Shopify-backed optional catch-all can look fake.
- `--site=` with an empty value silently skips the smoke check, and `smokeSite` has no fetch timeout.
- `hasLinkList` misses menu items that contain nested objects. The gift-card skip works per line only.
- `CLAIM_NAME` substring matches (`social`, `site`) and the 200-character rule can flag config constants.
- `walk.mjs` skips any top-level `scripts/` and `e2e/` folder, so a received repo's own scripts are never audited.
- After the stored id is cleared, a failed cart `create` leaves the dead cart in state, and `checkout()` is not gated on `busy`.
- `getProductStock` maps any "access denied" error to the inventory-scope message.
- Test gaps:
  - `dataOrThrow`;
  - `findVariant(product, {})`;
  - `defaultVariant` when everything is sold out;
  - content reads when Shopify is not configured;
  - smoke failures on non-200 pages;
  - CLI flag parsing.

## Still unverified (needs a development store or a browser)

- Collection filters, subscriptions, metafields, and the stock-scope refusal.
- The cart UI and checkout clicked through in a browser.
- Error pages on Next 16.0–16.2, which may pass `reset` and not `retry`.
