---
name: shopify-connect-frontend
description: Connect a frontend someone else built (a received Next.js repo, AI-builder export or agency handoff) to Shopify - audit it, install the Shopify kit into its repo, swap its hardcoded products or fake API for Shopify, wire its existing cart to Shopify checkout, and prove it. Use whenever the user says they received, got or were sent a frontend, design or site to connect, hook up, wire or plug into Shopify, or asks to replace mock or placeholder products in a frontend with real ones.
---

# Connect a received frontend to Shopify

**A manual for the agent. Nothing here runs on its own.** You run the commands, read their output, and talk to the owner in chat. The owner's job is connecting frontends other people built, so **keep their design and change only where the data comes from.**

## The flow

Steps `frontend-audit` → `kit-install` → `frontend-catalogue` → `frontend-cart` → `frontend-check` in `pnpm shop-setup next`. The first two run from the kit repo, the rest inside the received repo.

1. **Audit** (from the kit): `pnpm shop-setup frontend-audit <path>`. Tell the owner, in plain words, what it found: how many hardcoded products and where, fake product APIs, the cart and checkout button, pages that switch caching off, and data typed into the site that Shopify should supply (menus, policy and page text, store claims, collection lists), invented fields (ratings, reviews, stock counts, badges), card payment forms and data files nothing uses. Detection is heuristic: open the listed `file:line`s and confirm before relying on them.
2. **Stop if it says Stop.** The kit supports Next.js 16+ with the App Router only. For anything else, tell the owner why and ask whether to move the frontend to Next.js App Router first (a separate job). Never half-wire an unsupported frontend.
3. **Install** (from the kit): `pnpm shop-setup kit-install <path> --dry-run`, show the owner what it adds, then run it without `--dry-run`. It also adds `error.tsx` and `global-error.tsx` and a `CLAUDE.md` that points at `AGENTS.md`, when the frontend has none. Conflicts mean nothing was written: usually the frontend's own `app/api/...` route or a `test:e2e` script. Read it, keep what matters for the wiring, remove or rename it, run again. Then in the received repo: `pnpm install`, `pnpm test:scripts`, commit.
4. **Wire** (in the received repo): follow `docs/frontend-wiring.md`, Catalogue, Product page, Header and footer, then Cart. One mapper into their product type; SDK reads in server components; their cart UI on Shopify's cart; checkout to `cart.checkoutUrl`. The pieces the kit gives you, so you do not write your own:
   - Lists, "Load more" and filters: `getProductsPage`, `getCollectionProductsPage`, `searchProducts`, with a server action for the button (guide: "Lists, load more and filters").
   - Variant picker: `findVariant`, `defaultVariant`, `isOptionValueAvailable`; swatches from `optionValues[].swatch` (guide: "Product page").
   - Extra fields, subscriptions, stock: `getProduct(handle, { metafields })`, `sellingPlanGroups`, `getProductStock` (guide: "Product page").
   - Header, footer, policies and info pages: `getShop`, `getMenu`, `menuLinks`, `getPolicies`, `getPolicy`, `getPage` (guide: "Header, footer, policies and pages").
   - Cart: `CartProvider` and `useCart()` from `@/lib/shopify/cart-provider` (guide: "Cart").
   - Anything Shopify has no value for: hide it and list it (guide: "Things Shopify does not have").
5. **Check**: while wiring, run `pnpm exec tsc --noEmit` (`next lint` no longer exists in Next 16). When the wiring is in: `pnpm shop-setup frontend-check`, then `pnpm build`, `pnpm start`, and `pnpm shop-setup frontend-check --site http://localhost:3000` (it loads the home page and one product page and needs Shopify images on both). Then click through with the development store's public token in `.env.local`.
6. **Hand over** to `.claude/skills/shopify-store-setup/SKILL.md` for the rest of the store (`pnpm shop-setup next`).

## Marking steps

- Mark `frontend-catalogue` and `frontend-cart` done when their code is in and builds against mock.shop or the development store.
- `frontend-check` is the only one that waits for the development store.
- `pnpm shop-setup next` also offers the store questionnaire (`intake`). It can wait until the frontend is wired; do not ask the owner store questions in the middle of the wiring.
- `store-setup.state.json` is committed. `frontend-audit.json` is ignored (kit-install adds it to `.gitignore`).

## Rules

- Their components, styles and copy stay. If a change to the design is unavoidable (no variant picker, a field Shopify cannot fill), ask the owner first.
- Never invent ratings, reviews, badges or was-prices to fill their UI. Hide the empty bit and list it for the owner.
- Never call the SDK from a `"use client"` file; move the read to a server parent.
- Never catch a Shopify error and show something else in its place. Errors reach `error.tsx`.
- Never filter a whole catalogue in memory; use Shopify's filters and pages.
- Unused old data files are listed, not deleted, until the owner agrees. Same for fake API routes and a fake checkout page.
- No store with products yet? Wire and click through against mock.shop first (`docs/frontend-wiring.md`, "No development store yet"): real Shopify responses, a real cart and checkout link. Sign-off still needs the development store. The kit has no mock products of its own: without Shopify settings every read throws.
- Say "unverified" for anything not clicked through against a real (development) store.
