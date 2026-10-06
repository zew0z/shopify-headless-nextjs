---
name: shopify-connect-frontend
description: Connect a frontend someone else built (a received Next.js repo, AI-builder export or agency handoff) to Shopify - audit it, install the Shopify kit into its repo, swap its hardcoded products or fake API for Shopify, wire its existing cart to Shopify checkout, and prove it. Use whenever the user says they received, got or were sent a frontend, design or site to connect, hook up, wire or plug into Shopify, or asks to replace mock or placeholder products in a frontend with real ones.
---

# Connect a received frontend to Shopify

**A manual for the agent. Nothing here runs on its own.** You run the commands, read their output, and talk to the owner in chat. The owner's job is connecting frontends other people built, so **keep their design and change only where the data comes from.**

## The flow

Steps `frontend-audit` → `kit-install` → `frontend-catalogue` → `frontend-cart` → `frontend-check` in `pnpm shop-setup next`. The first two run from the kit repo, the rest inside the received repo.

1. **Audit** (from the kit): `pnpm shop-setup frontend-audit <path>`. Tell the owner, in plain words, what it found: how many hardcoded products and where, fake product APIs, the cart and checkout button, pages that switch caching off. Detection is heuristic: open the listed `file:line`s and confirm before relying on them.
2. **Stop if it says Stop.** The kit supports Next.js 16+ with the App Router only. For anything else, tell the owner why and ask whether to move the frontend to Next.js App Router first (a separate job). Never half-wire an unsupported frontend.
3. **Install** (from the kit): `pnpm shop-setup kit-install <path> --dry-run`, show the owner what it adds, then run it without `--dry-run`. Conflicts mean nothing was written: usually the frontend's own `app/api/...` route or a `test:e2e` script. Read it, keep what matters for the wiring, remove or rename it, run again. Then in the received repo: `pnpm install`, `pnpm test:scripts`, commit.
4. **Wire** (in the received repo): follow `docs/frontend-wiring.md`, Catalogue then Cart. One mapper into their product type; SDK reads in server components; their cart UI on Shopify's cart through `/api/cart`; checkout to `cart.checkoutUrl`.
5. **Check**: `pnpm shop-setup frontend-check` until it passes, then `pnpm build`, then click through with the development store's public token in `.env.local`. Mark `frontend-check` done only then.
6. **Hand over** to `.claude/skills/shopify-store-setup/SKILL.md` for the rest of the store (`pnpm shop-setup next`).

## Rules

- Their components, styles and copy stay. If a change to the design is unavoidable (no variant picker, a field Shopify cannot fill), ask the owner first.
- Never invent ratings, reviews, badges or was-prices to fill their UI. Hide the empty bit and list it for the owner.
- Never call the SDK from a `"use client"` file; move the read to a server parent.
- Never catch a Shopify error and show something else in its place. Errors reach `error.tsx`.
- Ask before deleting their old data files, fake API routes or a fake checkout page.
- If the frontend needs the store's products before the store has them, use a development store, or run the `catalogue` step first. The kit's mock products show only in development without Shopify settings; they prove the wiring compiles, not that it works.
- Say "unverified" for anything not clicked through against a real (development) store.
