# Received Frontend Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One agent takes a frontend someone else built, installs this kit into that frontend's repo, connects its product data and its existing cart to Shopify, and proves the wiring before the store setup continues.

**Architecture:** Three new `pnpm shop-setup` commands. `frontend-audit <dir>` reads a received repo and reports its stack, where its product data comes from, its cart and checkout button, anything that switches caching off, and its image config. `kit-install <dir>` copies the kit (SDK, API routes, setup scripts, tests, skills, docs) into that repo: it never overwrites a different file and never writes anything when it finds conflicts. `frontend-check` runs inside the received repo after the agent has done the wiring, and fails while hardcoded data, fake APIs or caching killers remain. The wiring itself is code the agent writes, guided by a new skill and `docs/frontend-wiring.md`. New registry steps put this phase before `hosting`.

**Tech Stack:** Node ESM `.mjs`, `node --test`, no new dependencies. Fixtures are written to temp dirs by the tests, never committed (the kit's `tsc` and `eslint` would compile them, and `kit-install` would copy them).

**Spec:** Owner answers on 2026-10-07 (chat):
- Received frontends are Next.js App Router, or other React / Vite / Astro.
- The kit goes into the received repo. This repo stays a reusable kit.
- Product data arrives hardcoded (arrays / JSON) or from the frontend's own fake API.
- The frontend has a cart UI that is not wired to anything.

## Design decisions

- **Supported in this plan:** Next.js 16 or newer with the App Router, `app/` at the root or `src/app/`. The SDK uses Next 16 APIs (`revalidateTag(tag, profile)`, the data cache via `fetch`'s `next.tags`).
- **Not supported yet, detected and stopped:** Next.js before 16 (upgrade first), Pages Router, Vite, Astro, anything else. `frontend-audit` says so in plain words and the skill tells the agent to stop and ask the owner: move the frontend to Next.js App Router (a separate plan) or wait for an adapter. Never half-wire an unsupported stack.
- **Where the SDK goes:** `<appRoot>lib/shopify/` where `appRoot` is `src/` when `src/app` exists, else the repo root. API routes go to `<appRoot>app/api/{cart,revalidate,health,search}/route.ts`, with `@/lib/shopify` rewritten to `../../../lib/shopify` so no path alias is needed.
- **Conflicts:** same path and same content: skipped. Same path and different content: a conflict. Any conflict means nothing is written; the agent resolves it (usually the frontend's own fake `app/api/...` route) and runs `kit-install` again. Re-running on an installed repo writes nothing.
- **package.json:** adds the scripts `shop-setup`, `test:scripts`, `test:e2e` and the dev dependencies `@playwright/test` and `typescript` when missing. A script that exists with a different command is a conflict.
- **Wiring keeps their design:** their components and their product type stay. The agent writes one mapper from the SDK's `Product` to their type and changes data sources only. Fields Shopify does not have (ratings, reviews, "was" prices that are not real) are reported to the owner, never invented.
- **Their cart stays, its insides change:** state comes from Shopify's cart through `/api/cart`, the cart id is kept in `localStorage`, totals come from `cart.cost`, and the checkout button goes to `cart.checkoutUrl`.
- **State:** `kit-install` creates `store-setup.state.json` in the received repo with `frontend-audit` and `kit-install` marked done, so `pnpm shop-setup next` there continues the flow.

## Global Constraints

- No new npm dependencies. Unit tests use `node:test`; run with `pnpm test:scripts`.
- Every new module is pure where it can be: functions take a directory or file map and return data; only the CLI prints and writes.
- Detection is heuristic. Every finding carries `file:line` so the agent and the owner can check it. The audit never claims something is absent unless it looked.
- Plain words in every message a human reads: no "SSR", "ISR", "hydration" in CLI output.
- Nothing is "verified" until it ran on a real received frontend and a development store. Say "unverified" otherwise.

---

### Task 1: Find the SDK in either layout

**Files:**
- Create: `scripts/shopify/sdk-dir.mjs`, `scripts/shopify/sdk-dir.test.mjs`, `scripts/test-support/fixture.mjs`
- Modify: `scripts/shopify/validate-storefront.mjs:16` (`SDK_DIR`), `scripts/test-support/load-sdk.mjs`

**Interfaces:**
- Produces: `findSdkDir(root: string): string | null` returns the absolute `src/lib/shopify` or `lib/shopify` under `root` (first that has `index.ts`), else `null`.
- Produces: `makeFixture(files: Record<string, string>): string` writes files under a new temp dir and returns its path; `JSON` values may be objects (written with `JSON.stringify`).

- [ ] Test: a `src/` layout finds `src/lib/shopify`; a root layout finds `lib/shopify`; neither returns `null`.
- [ ] Run, watch it fail (module missing).
- [ ] Implement; point `SDK_DIR` and `loadSdk()` at `findSdkDir(process.cwd())` (fall back to the current `src/lib/shopify` path in the kit itself).
- [ ] `pnpm test:scripts` all green. Commit.

### Task 2: Audit, stack detection

**Files:**
- Create: `scripts/frontend/stack.mjs`, `scripts/frontend/stack.test.mjs`

**Interfaces:**
- Produces: `detectStack(dir) -> { framework: "next"|"vite"|"astro"|"remix"|"gatsby"|"unknown", nextMajor: number|null, router: "app"|"pages"|null, appRoot: "src/"|""|null, supported: boolean, reason: string }`

- [ ] Tests (fixtures via `makeFixture`):
  - Next `^16.1.0` with `src/app/page.tsx` → supported, appRoot `src/`, router `app`.
  - Next `16.3.4` with `app/page.tsx` → supported, appRoot `""`.
  - Next `15.2.0` with `app/` → not supported, reason mentions upgrading to 16.
  - Next 16 with only `pages/index.tsx` → not supported, reason names the Pages Router.
  - `vite` + `react` → not supported, framework `vite`; `astro` → framework `astro`.
  - No `package.json` → framework `unknown`, not supported.
  - Version ranges `^16`, `~16.0.1`, `16.x`, `latest`: `latest` reads the installed `node_modules/next/package.json` when present, else is unsupported with "cannot tell the Next.js version".
- [ ] Run, watch fail. Implement. Green. Commit.

### Task 3: Audit, where the product data comes from

**Files:**
- Create: `scripts/frontend/sources.mjs`, `scripts/frontend/sources.test.mjs`, `scripts/frontend/walk.mjs`

**Interfaces:**
- Produces: `listSourceFiles(dir) -> string[]` (relative paths; `.ts .tsx .js .jsx .mjs .json`; skips `node_modules`, `.next`, `dist`, `build`, `out`, `.git`, `public`, the kit's own `lib/shopify` and `scripts/`).
- Produces: `findProductData(dir, files) -> Array<{ file, line, kind: "array"|"json", count }>`: an array literal or JSON array of 2+ objects that each have a price key (`price`, `amount`, `cost`) and a name key (`title`, `name`).
- Produces: `findFakeApis(dir, files) -> Array<{ file, line, kind: "fetch"|"route", target }>`: `fetch(`/`axios.get(` whose URL literal is not `/api/cart` and looks like product data (`product`, `item`, `catalog`, `collection`, `shop`, or a known mock host such as `fakestoreapi.com`, `dummyjson.com`); and route handlers under `app/api/**/route.*` that import a file from `findProductData`.

- [ ] Tests: a `data/products.ts` with 3 products is found with count 3 and the right line; a 1-item array is not; a `products.json` is found; a nav-links array (`label`, `href`) is not; `fetch("/api/products")` and `fetch("https://fakestoreapi.com/products")` are found; `fetch("/api/cart")` is not; `app/api/products/route.ts` importing `@/data/products` is a route finding.
- [ ] Run, watch fail. Implement with line-based scanning plus a small bracket matcher for array literals (no parser dependency). Green. Commit.

### Task 4: Audit, cart, caching killers, images; the `frontend-audit` command

**Files:**
- Create: `scripts/frontend/audit.mjs`, `scripts/frontend/audit.test.mjs`
- Modify: `scripts/setup/cli.mjs` (new case `frontend-audit`, usage line)

**Interfaces:**
- Produces: `findCart(dir, files) -> { files: Array<{file,line,why}>, checkoutButtons: Array<{file,line,text}> }`: cart contexts/stores (`createContext` or `create(` near `cart`, `localStorage` keys containing `cart`), checkout buttons (JSX text or `aria-label` matching `checkout|Checkout|Ολοκλήρωση|Ταμείο`).
- Produces: `findCachingOff(dir, files) -> Array<{file,line,what}>`: `dynamic = "force-dynamic"`, `fetchCache = "force-no-store"|"default-no-store"|"only-no-store"`, `revalidate = 0`, `cache: "no-store"`, `unstable_noStore`, `connection()` from `next/server`.
- Produces: `checkImages(dir) -> { ok: boolean, note: string }`: `next.config.*` mentions `cdn.shopify.com`, or sets `unoptimized: true`.
- Produces: `auditFrontend(dir) -> { stack, productData, fakeApis, cart, cachingOff, images }` composed from the above.
- CLI: `pnpm shop-setup frontend-audit <dir>` prints a plain summary with counts and `file:line` lists, writes `<dir>/frontend-audit.json`, exits 1 when the stack is not supported.

- [ ] Tests for each finder against small fixtures, and one composite fixture (`src/` layout, 4 hardcoded products, a cart context with `localStorage`, a "Checkout" button, `force-dynamic` on the home page, `next.config.ts` without Shopify) with the expected composite result.
- [ ] Run, watch fail. Implement. Green. Commit.

### Task 5: Kit manifest and install planner

**Files:**
- Create: `scripts/frontend/kit.mjs`, `scripts/frontend/kit.test.mjs`

**Interfaces:**
- Consumes: `detectStack(dir).appRoot`.
- Produces: `kitFiles(kitRoot, appRoot) -> Array<{ from, to, transform?: (text) => text }>`: SDK files (`src/lib/shopify/*.ts`) to `<appRoot>lib/shopify/`; the four API routes to `<appRoot>app/api/...` with `@/lib/shopify` rewritten to `../../../lib/shopify`; every file under `scripts/` and `e2e/`; `playwright.config.mjs`; `store-setup.config.example.json`; `.claude/skills/shopify-store-setup/SKILL.md`; `.claude/skills/shopify-connect-frontend/SKILL.md`; `docs/catalogue-import.md`, `docs/shopify-api-gotchas.md`, `docs/frontend-wiring.md`. Never `src/app` pages, components, `src/context`, the kit's README, or `docs/superpowers`.
- Produces: `planKitInstall({ kitRoot, target, appRoot }) -> { write: [{to, text}], same: string[], conflicts: [{to, why}], packageJson: { add: {scripts, devDependencies}, conflicts }, gitignore: string[], agentsNote: boolean }`.

- [ ] Tests: a root-layout target gets `lib/shopify/index.ts` and `app/api/cart/route.ts` with no `@/` left; a `src/` target gets `src/lib/shopify/...`; an existing identical file lands in `same`; an existing different `app/api/cart/route.ts` is a conflict; a target `package.json` with a different `test:e2e` script is a conflict, a missing one is added; `.gitignore` lines `.env*`, `/data/catalog.json`, `/test-results/`, `/playwright-report/` are added only when absent; `agentsNote` is true when `AGENTS.md`/`CLAUDE.md` lacks the `# Store setup` block; nothing from `docs/superpowers` or `src/components` is in the plan.
- [ ] Run, watch fail. Implement. Green. Commit.

### Task 6: `kit-install` command

**Files:**
- Create: `scripts/frontend/install.mjs`, `scripts/frontend/install.test.mjs`
- Modify: `scripts/setup/cli.mjs` (case `kit-install`, usage line)

**Interfaces:**
- Consumes: `planKitInstall`, `auditFrontend`, `markDone`/`saveState` from `scripts/setup/state.mjs`.
- Produces: `applyKitInstall(plan, target) -> { written: number }`: writes files (creating folders), merges `package.json` keeping its key order and indentation, appends `.gitignore` lines, appends the `# Store setup` block to `AGENTS.md` (or `CLAUDE.md` when only that exists, or creates `AGENTS.md`), and creates `store-setup.state.json` with `frontend-audit` and `kit-install` done when it does not exist.
- CLI: `pnpm shop-setup kit-install <dir> [--dry-run]`. Refuses with exit 1 when the audit says unsupported or the plan has conflicts, listing each conflict. `--dry-run` prints the plan and writes nothing. Ends by telling the agent to run `pnpm install` in the target and then `pnpm shop-setup next` there.

- [ ] Tests: applying to a fixture writes the SDK and routes; applying the same plan twice writes nothing the second time; a conflict plan writes nothing at all; `package.json` keeps its existing scripts; the state file is created once and left alone if present.
- [ ] Run, watch fail. Implement. Green. Commit.

### Task 7: `frontend-check` command

**Files:**
- Create: `scripts/frontend/check.mjs`, `scripts/frontend/check.test.mjs`
- Modify: `scripts/setup/cli.mjs` (case `frontend-check`, usage line)

**Interfaces:**
- Consumes: `auditFrontend`, `findSdkDir`.
- Produces: `checkWiring(dir) -> Array<{ ok: boolean, what: string, where?: string[] }>` with these checks:
  1. The SDK and `/api/cart` are installed.
  2. No page, layout or component imports a file `findProductData` reports (the data file itself may remain until the owner agrees to delete it).
  3. No fake API calls remain (`findFakeApis` empty).
  4. No caching killer in a file that also calls a catalogue function (`getProduct`, `getProducts`, `getCollection`, `getCollections`, `getCollectionProducts`, `getProductRecommendations`), and none in a layout.
  5. Images allow `cdn.shopify.com`.
  6. Something calls `/api/cart` and something uses `checkoutUrl`.
- CLI: prints each check, exits 1 if any fails. Reminds that `pnpm build` and a run against a development store are still needed.

- [ ] Tests: an unwired composite fixture fails checks 2–6 with the right `file:line`; a wired fixture (page imports `getProducts` from the SDK, cart calls `/api/cart` and uses `checkoutUrl`, `next.config.ts` has `cdn.shopify.com`) passes all six.
- [ ] Run, watch fail. Implement. Green. Commit.

### Task 8: Steps, skill and wiring guide

**Files:**
- Modify: `scripts/setup/steps.mjs`, `scripts/setup/steps.test.mjs`, `AGENTS.md`, `README.md` (one short section)
- Create: `.claude/skills/shopify-connect-frontend/SKILL.md`, `docs/frontend-wiring.md`

**Interfaces:**
- New steps (owner `code`): `frontend-audit` (automation `frontend-audit`), `kit-install` (needs `frontend-audit`, automation `kit-install`), `frontend-catalogue` (needs `kit-install`), `frontend-cart` (needs `frontend-catalogue`), `frontend-check` (needs `frontend-cart`, `headless-channel`; automation `frontend-check`; done only after `frontend-check` passes, `pnpm build` passes, and the pages show the development store's products).
- `hosting` gains `frontend-check` in `needs`.

- [ ] Tests: the new steps exist and chain in that order; `hosting` needs `frontend-check`; `go-live` transitively waits for `frontend-check`; every step whose `automation` is set names a command the CLI knows (read the `case` labels from `cli.mjs`).
- [ ] Run, watch fail. Add the steps. Green.
- [ ] Write the skill (front door for "I received a frontend": audit → stop if unsupported → install → wire → check → hand over to `shopify-store-setup`) and `docs/frontend-wiring.md` (mapper pattern from the SDK `Product` to their type; moving data reads from client components to the nearest server component; variant ids; the cart pattern with `/api/cart`, `localStorage` cart id, `cart.cost`, `checkoutUrl`; fields to report rather than invent; deleting dead mock files only with the owner's agreement).
- [ ] Add the skill to `AGENTS.md`. Commit.

### Task 9: Rehearsal on a real received frontend (verification gate)

- [ ] Get a real received frontend from the owner (or, if none is available today, build a small stand-in Next 16 app in the scratchpad with hardcoded products, a fake `/api/products` route and an unwired cart, and say plainly that it is a stand-in).
- [ ] `frontend-audit` → `kit-install --dry-run` → `kit-install` → `pnpm install` → wire following the skill → `frontend-check` → `pnpm build` → run the production server and click through: product list, product page, add to cart, checkout button reaches Shopify checkout.
- [ ] With no Shopify settings the dev server shows the kit's mock products; with a development store's tokens it shows the real ones. Without a dev store, say "unverified against Shopify".
- [ ] Fix every gap the rehearsal finds in the tools or the guide (each with a test), then commit and push.
