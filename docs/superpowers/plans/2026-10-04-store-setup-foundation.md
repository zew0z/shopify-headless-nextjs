# Store Setup Agent Kit — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repo self-driving for store setup: an agent runs `pnpm shop-setup next`, does everything it can (API or browser), and is handed exactly one human step at a time.

**Architecture:** A declarative step registry (who does it, what it needs) plus a pure engine that computes "what is ready now", a small state file, one intake config that holds every business decision, and Admin-API appliers (this plan: shipping only). Pure logic is unit-tested with `node --test`; network code is thin and verified against a Shopify development store.

**Tech Stack:** Node ESM `.mjs` scripts (no new runtime dependencies), `node --test`, Playwright for browser tests, Shopify Admin GraphQL, pnpm.

**Spec:** Section "Design decisions" below (no separate spec doc; decisions were made with the user on 2026-10-04).

## Design decisions (from the user, 2026-10-04)

- Everything is written in this repo (`zew0z/shopify-headless-nextjs`). `xristos-store` and `landing-template` are reference only; nothing is changed there.
- Default market profile is Greece/EUR, configurable. Other countries are added later as profiles.
- Invoicing: use an existing Shopify app (e.g. myData Comply). The agent checks and guides; no custom invoicing code.
- Browser: the agent may click through the Shopify admin for settings the API cannot change, **only while the human is logged in and watching**. It never types passwords, payment details or government IDs.
- Minimise human work: the human answers one questionnaire, then receives one step at a time.
- Already done by the user on the pilot store (2026-10-04): a redirect injected into the default Shopify theme that sends visitors to the frontend. Still to do per store: connect `checkout.<domain>` as the Shopify domain, and install branded email templates. The agent generates the redirect snippet and the email Liquid; a browser step pastes them while the human is logged in (no API exists for either), with manual copy-paste as the fallback.

## Research notes (checked 2026-10-04 against shopify.dev)

| Capability | API? | Source |
|---|---|---|
| Shipping zones and rates | Yes, `deliveryProfileCreate` / `deliveryProfileUpdate`, scope `write_shipping` | shopify.dev delivery profile docs |
| Policies | Yes, `shopPolicyUpdate`, scope `write_legal_policies` | shopify.dev |
| Checkout branding | Yes, but Plus or development stores only | shopify.dev |
| "Prices include tax" toggle | **Not found in API docs. Treat as browser/human step.** Read-back via `shop.taxesIncluded`. | shopify.dev, community |
| Greek invoices (myDATA) | App, e.g. myData Comply (~$10–30/month) | apps.shopify.com |
| Edit theme files (the redirect in `layout/theme.liquid`) | `themeFilesUpsert` exists but needs `write_themes` **plus a Shopify exemption**. Treat as browser paste (Edit code) or `shopify theme push`. Both unverified here. | shopify.dev |
| Connect a custom domain / checkout subdomain | **No API.** Admin only, plus a DNS record at the DNS provider. | community.shopify.com |
| Custom email (notification) templates | **No API.** Generate the Liquid, then paste in Settings > Notifications. | community.shopify.dev |
| Checkout on `checkout.<domain>` | Supported: point the subdomain at Shopify and make it the primary domain, keep the main domain on the frontend host. Verify that `cart.checkoutUrl` actually uses it. | community.shopify.com |

## Global Constraints

- No new npm dependencies, with one exception: `@playwright/test` as a devDependency for the browser suite (Task 7). Scripts are plain `.mjs`, unit tests use `node:test` and `node:assert/strict`.
- Env files: read `.env.local` then `.env`. Accept both `SHOPIFY_STORE_DOMAIN` and `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` (this repo's naming).
- `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_APP_CLIENT_ID`, `SHOPIFY_APP_CLIENT_SECRET` never go in the deployed environment and never in committed files.
- Run tests with `pnpm test:scripts`. The repo gates are `pnpm lint` and `pnpm build`.
- Nothing is called "verified" until it has run against a real (development) store. Pure-logic tests do not count.

## File structure

```
scripts/shopify/env.mjs               .env parsing, domain normalisation, console helpers
scripts/shopify/env.test.mjs
scripts/shopify/admin-client.mjs      Admin GraphQL client (userErrors, throttling), scope helpers
scripts/shopify/admin-client.test.mjs
scripts/shopify/introspect.mjs        node scripts/shopify/introspect.mjs <InputTypeName>
scripts/setup/engine.mjs              pure: nextActions(), validateSteps()
scripts/setup/engine.test.mjs
scripts/setup/steps.mjs               the step registry (data)
scripts/setup/steps.test.mjs
scripts/setup/state.mjs               store-setup.state.json read/write
scripts/setup/state.test.mjs
scripts/setup/intake.mjs              validate store-setup.config.json, profile defaults
scripts/setup/intake.test.mjs
scripts/setup/shipping.mjs            pure: buildZone(), findCountryCollisions(); apply layer
scripts/setup/shipping.test.mjs
scripts/setup/cli.mjs                 pnpm shop-setup status|next|done|preflight|shipping|e2e
e2e/env.mjs                           reads store-setup.config.json + env for the browser tests
e2e/env.test.mjs                      node --test for the pure URL helpers
e2e/checkout-host.spec.mjs            cart -> checkoutUrl host is checkout.<domain>
e2e/theme-redirect.spec.mjs           Shopify theme URL ends up on the frontend
e2e/pages.spec.mjs                    no console errors, no horizontal scroll at 375px
playwright.config.mjs
store-setup.config.example.json
.claude/skills/shopify-store-setup/SKILL.md   the runbook the agent follows
AGENTS.md                             modify: point at the skill
package.json                          modify: scripts
```

---

### Task 1: Env helpers

**Files:**
- Create: `scripts/shopify/env.mjs`
- Test: `scripts/shopify/env.test.mjs`
- Modify: `package.json` (add `test:scripts`)

**Interfaces:**
- Produces: `parseEnv(text: string): Record<string,string>`, `normalizeDomain(raw?: string): string`, `shopifyEnv(env?: Record<string,string>): { domain, apiVersion, storefrontToken, storefrontPrivateToken, adminToken, webhookSecret, clientId, clientSecret, siteUrl }`, `readEnv(): Record<string,string>`, `upsertEnv(key, value): void`, `mask(token): string`, `ok/bad/warn/info/heading(msg): void`, `API_VERSION_DEFAULT`.

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"` add:

```json
"test:scripts": "node --test \"scripts/**/*.test.mjs\" \"e2e/**/*.test.mjs\"",
"shop-setup": "node scripts/setup/cli.mjs"
```

- [ ] **Step 2: Write the failing test**

```js
// scripts/shopify/env.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv, normalizeDomain, shopifyEnv, mask } from "./env.mjs";

test("parseEnv strips quotes and ignores comments", () => {
  const env = parseEnv('# c\nA="x y"\nB=\'z\'\n  C = 3 \nnot a line');
  assert.deepEqual(env, { A: "x y", B: "z", C: "3" });
});

test("normalizeDomain accepts bare name, url and trailing slash", () => {
  assert.equal(normalizeDomain("my-store"), "my-store.myshopify.com");
  assert.equal(normalizeDomain("https://my-store.myshopify.com/"), "my-store.myshopify.com");
  assert.equal(normalizeDomain(undefined), "");
});

test("shopifyEnv accepts NEXT_PUBLIC_ names used by this repo", () => {
  const e = shopifyEnv({
    NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "shop",
    NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: "pub",
    SHOPIFY_STOREFRONT_API_VERSION: "2025-01",
  });
  assert.equal(e.domain, "shop.myshopify.com");
  assert.equal(e.storefrontToken, "pub");
  assert.equal(e.apiVersion, "2025-01");
});

test("shopifyEnv prefers the un-prefixed name when both are set", () => {
  const e = shopifyEnv({ SHOPIFY_STORE_DOMAIN: "a", NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "b" });
  assert.equal(e.domain, "a.myshopify.com");
});

test("mask never prints a whole token", () => {
  assert.equal(mask(""), "-");
  assert.ok(!mask("shpat_abcdefghijklmnop").includes("abcdefghijkl"));
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm test:scripts`
Expected: FAIL, `Cannot find module './env.mjs'`.

- [ ] **Step 4: Implement**

```js
// scripts/shopify/env.mjs
/**
 * .env access for the setup scripts. They run outside Next (plain node), so they
 * read the env files themselves: `.env.local` first, then `.env`.
 *
 * site + scripts   SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_API_VERSION
 * site only        storefront tokens, SHOPIFY_WEBHOOK_SECRET
 * scripts only     SHOPIFY_ADMIN_TOKEN, SHOPIFY_APP_CLIENT_ID, SHOPIFY_APP_CLIENT_SECRET
 *
 * Keep the admin token out of the deployed environment: it can rewrite the shop.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
export const ENV_PATH = path.join(ROOT, ".env.local");
const ENV_FILES = [path.join(ROOT, ".env"), ENV_PATH];

export const API_VERSION_DEFAULT = "2025-07";

export function parseEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/** `.env` first, `.env.local` second so the local file wins, like Next. */
export function readEnv() {
  const env = {};
  for (const file of ENV_FILES) if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, "utf8")));
  return env;
}

/** Writes one key to `.env.local`, in place when present so comments survive. */
export function upsertEnv(key, value) {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(ENV_PATH, pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`.trimStart());
}

export function normalizeDomain(raw) {
  const domain = (raw ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return domain && !domain.includes(".") ? `${domain}.myshopify.com` : domain;
}

const pick = (env, ...names) => names.map((n) => env[n]).find(Boolean) ?? "";

export function shopifyEnv(env = readEnv()) {
  return {
    domain: normalizeDomain(pick(env, "SHOPIFY_STORE_DOMAIN", "NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN")),
    apiVersion: pick(env, "SHOPIFY_API_VERSION", "SHOPIFY_STOREFRONT_API_VERSION") || API_VERSION_DEFAULT,
    storefrontToken: pick(env, "SHOPIFY_STOREFRONT_TOKEN", "NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN"),
    storefrontPrivateToken: env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN ?? "",
    adminToken: env.SHOPIFY_ADMIN_TOKEN ?? "",
    webhookSecret: env.SHOPIFY_WEBHOOK_SECRET ?? "",
    clientId: env.SHOPIFY_APP_CLIENT_ID ?? "",
    clientSecret: env.SHOPIFY_APP_CLIENT_SECRET ?? "",
    siteUrl: (env.SITE_URL ?? "").replace(/\/+$/, ""),
  };
}

export const mask = (token) => (token ? `${token.slice(0, 6)}...${token.slice(-4)} (${token.length} chars)` : "-");

export const ok = (message) => console.log(`  [ok]   ${message}`);
export const bad = (message) => console.log(`  [FAIL] ${message}`);
export const warn = (message) => console.log(`  [warn] ${message}`);
export const info = (message) => console.log(`         ${message}`);
export const heading = (message) => console.log(`\n${message}`);
```

- [ ] **Step 5: Run and see it pass**

Run: `pnpm test:scripts`
Expected: PASS, 5 tests in env.test.mjs.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/shopify/env.mjs scripts/shopify/env.test.mjs
git commit -m "feat(setup): env helpers that read .env.local and NEXT_PUBLIC_ names"
```

---

### Task 2: Admin client and introspection

**Files:**
- Create: `scripts/shopify/admin-client.mjs`, `scripts/shopify/introspect.mjs`
- Test: `scripts/shopify/admin-client.test.mjs`

**Interfaces:**
- Consumes: `shopifyEnv`, `mask` from Task 1.
- Produces: `SCOPES: { shipping: string[]; policies: string[] }`, `missingScopes(granted: string[], required: string[]): string[]`, `collectUserErrors(node): object[]`, `adminGraphQL(query, variables?): Promise<data>` (throws on `errors` and on any `userErrors`), `grantedScopes(): Promise<string[]>`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/shopify/admin-client.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { SCOPES, missingScopes, collectUserErrors } from "./admin-client.mjs";

test("collectUserErrors finds nested userErrors", () => {
  const data = { a: { userErrors: [{ message: "x" }] }, b: [{ c: { userErrors: [{ message: "y" }] } }] };
  assert.deepEqual(collectUserErrors(data).map((e) => e.message), ["x", "y"]);
});

test("collectUserErrors returns [] for clean data", () => {
  assert.deepEqual(collectUserErrors({ a: { userErrors: [] } }), []);
});

test("a write scope satisfies its read counterpart", () => {
  assert.deepEqual(missingScopes(["write_shipping", "read_locations"], SCOPES.shipping), []);
});

test("missing scopes are reported by name", () => {
  assert.deepEqual(missingScopes(["read_locations"], SCOPES.shipping), ["write_shipping"]);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './admin-client.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement the client**

```js
// scripts/shopify/admin-client.mjs
/**
 * Shopify Admin GraphQL client for the setup scripts.
 *
 * - Surfaces `userErrors`: Shopify returns most write failures as HTTP 200 with a
 *   populated userErrors array, so a status-only check reports success on a
 *   failed write.
 * - Backs off before the leaky bucket runs dry and retries THROTTLED / 429 / 5xx.
 */
import { shopifyEnv } from "./env.mjs";

/** Scopes per capability, so preflight can ask only for what a step needs. */
export const SCOPES = {
  shipping: ["write_shipping", "read_locations"],
  policies: ["write_legal_policies"],
};

export function adminConfig() {
  const env = shopifyEnv();
  if (!env.domain) {
    console.error("\n  SHOPIFY_STORE_DOMAIN is missing from .env.local\n");
    process.exit(1);
  }
  if (!env.adminToken) {
    console.error("\n  SHOPIFY_ADMIN_TOKEN is missing from .env.local - the oauth step has not run\n");
    process.exit(1);
  }
  return env;
}

export function missingScopes(granted, required) {
  const have = new Set(granted);
  // A write scope implies its read counterpart; Shopify does not list both.
  for (const scope of granted) if (scope.startsWith("write_")) have.add(scope.replace("write_", "read_"));
  return required.filter((scope) => !have.has(scope));
}

export function collectUserErrors(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) collectUserErrors(item, found);
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "userErrors" && Array.isArray(value)) found.push(...value);
    else collectUserErrors(value, found);
  }
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function adminGraphQL(query, variables = {}, attempt = 0) {
  const { domain, adminToken, apiVersion } = adminConfig();
  const response = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": adminToken, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await sleep(2 ** attempt * 1000);
    return adminGraphQL(query, variables, attempt + 1);
  }
  if (!response.ok) throw new Error(`Admin API HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);

  const json = await response.json();
  if (json.errors) {
    if (json.errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < 5) {
      await sleep(2 ** attempt * 1000);
      return adminGraphQL(query, variables, attempt + 1);
    }
    throw new Error(`Admin API errors: ${JSON.stringify(json.errors, null, 2)}`);
  }

  const userErrors = collectUserErrors(json.data);
  if (userErrors.length) throw new Error(`Admin API userErrors: ${JSON.stringify(userErrors, null, 2)}`);

  const throttle = json.extensions?.cost?.throttleStatus;
  if (throttle && throttle.currentlyAvailable < 200) {
    await sleep(Math.ceil(((1000 - throttle.currentlyAvailable) / throttle.restoreRate) * 1000));
  }
  return json.data;
}

export async function grantedScopes() {
  const { domain, adminToken } = adminConfig();
  const response = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
    headers: { "X-Shopify-Access-Token": adminToken },
  });
  if (!response.ok) throw new Error(`access_scopes HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).access_scopes.map((scope) => scope.handle);
}
```

- [ ] **Step 4: Implement introspection as its own file**

```js
// scripts/shopify/introspect.mjs
// Shopify's input shapes drift between API versions and docs lag behind.
// Print the live schema before writing or changing a mutation:
//   node scripts/shopify/introspect.mjs DeliveryMethodDefinitionInput
import { adminGraphQL, adminConfig } from "./admin-client.mjs";
import { mask } from "./env.mjs";

const typeName = process.argv[2];
if (!typeName) {
  console.error("usage: node scripts/shopify/introspect.mjs <InputTypeName>");
  process.exit(1);
}
const data = await adminGraphQL(
  `query($name: String!) {
    __type(name: $name) {
      name kind
      inputFields { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } }
    }
  }`,
  { name: typeName },
);
const type = data.__type;
if (!type) {
  console.error(`No such type: ${typeName}`);
  process.exit(1);
}
const render = (node) => {
  if (!node) return "";
  if (node.kind === "NON_NULL") return `${render(node.ofType)}!`;
  if (node.kind === "LIST") return `[${render(node.ofType)}]`;
  return node.name || node.kind;
};
const cfg = adminConfig();
console.log(`${type.name} (${type.kind})  api ${cfg.apiVersion}  token ${mask(cfg.adminToken)}`);
for (const field of type.inputFields ?? []) console.log(`  ${field.name}: ${render(field.type)}`);
```

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm test:scripts`
Expected: PASS (env + admin-client tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/shopify
git commit -m "feat(setup): admin graphql client with userErrors, throttling and schema introspection"
```

---

### Task 3: Step engine, registry and state

**Files:**
- Create: `scripts/setup/engine.mjs`, `scripts/setup/steps.mjs`, `scripts/setup/state.mjs`
- Test: `scripts/setup/engine.test.mjs`, `scripts/setup/steps.test.mjs`, `scripts/setup/state.test.mjs`

**Interfaces:**
- Produces:
  - `type Step = { id: string; title: string; owner: "api"|"browser"|"human"; needs: string[]; instructions: string; verify?: string; automation?: string }`
  - `nextActions(steps: Step[], state: State): { agent: Step[]; human: Step[] }` — `human` holds at most ONE step, the first ready one in registry order.
  - `validateSteps(steps: Step[]): string[]` — error messages, empty when valid.
  - `STEPS: Step[]`
  - `type State = { done: Record<string, { at: string; note?: string }> }`; `emptyState()`, `markDone(state, id, note?, now?)`, `loadState(file)`, `saveState(file, state)`.

- [ ] **Step 1: Write the failing engine test**

```js
// scripts/setup/engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { nextActions, validateSteps } from "./engine.mjs";

const steps = [
  { id: "a", title: "A", owner: "human", needs: [] },
  { id: "b", title: "B", owner: "human", needs: [] },
  { id: "c", title: "C", owner: "api", needs: ["a"] },
  { id: "d", title: "D", owner: "browser", needs: ["a"] },
];

test("surfaces only the first ready human step", () => {
  const r = nextActions(steps, { done: {} });
  assert.deepEqual(r.human.map((s) => s.id), ["a"]);
  assert.deepEqual(r.agent, []);
});

test("agent steps unlock once their needs are done, humans stay one at a time", () => {
  const r = nextActions(steps, { done: { a: { at: "t" } } });
  assert.deepEqual(r.agent.map((s) => s.id), ["c", "d"]);
  assert.deepEqual(r.human.map((s) => s.id), ["b"]);
});

test("done steps are not offered again", () => {
  const r = nextActions(steps, { done: { a: { at: "t" }, b: { at: "t" }, c: { at: "t" } } });
  assert.deepEqual(r.agent.map((s) => s.id), ["d"]);
  assert.deepEqual(r.human, []);
});

test("validateSteps flags unknown needs, duplicates and cycles", () => {
  assert.deepEqual(validateSteps(steps), []);
  assert.match(validateSteps([{ id: "x", title: "", owner: "api", needs: ["nope"] }])[0], /unknown/);
  assert.match(validateSteps([steps[0], steps[0]])[0], /duplicate/);
  const cyc = [
    { id: "x", title: "", owner: "api", needs: ["y"] },
    { id: "y", title: "", owner: "api", needs: ["x"] },
  ];
  assert.match(validateSteps(cyc).join("\n"), /cycle/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './engine.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement the engine**

```js
// scripts/setup/engine.mjs
const AGENT_OWNERS = new Set(["api", "browser"]);

/** What can move now. Humans get ONE step at a time; twelve at once gets three done. */
export function nextActions(steps, state) {
  const done = state.done ?? {};
  const ready = steps.filter((s) => !done[s.id] && s.needs.every((n) => done[n]));
  return {
    agent: ready.filter((s) => AGENT_OWNERS.has(s.owner)),
    human: ready.filter((s) => s.owner === "human").slice(0, 1),
  };
}

export function validateSteps(steps) {
  const errors = [];
  const ids = new Set();
  for (const s of steps) {
    if (ids.has(s.id)) errors.push(`duplicate step id: ${s.id}`);
    ids.add(s.id);
  }
  for (const s of steps) {
    for (const n of s.needs) if (!ids.has(n)) errors.push(`step ${s.id} needs unknown step ${n}`);
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail) => {
    if (visited.has(id) || !byId.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    visiting.add(id);
    for (const n of byId.get(id).needs) visit(n, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const s of steps) visit(s.id, []);
  return errors;
}
```

- [ ] **Step 4: Run, expect engine tests PASS**

Run: `pnpm test:scripts`

- [ ] **Step 5: Write the failing registry and state tests**

```js
// scripts/setup/steps.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { STEPS } from "./steps.mjs";
import { validateSteps } from "./engine.mjs";

test("registry is internally consistent", () => {
  assert.deepEqual(validateSteps(STEPS), []);
});

test("every human step explains itself and every browser step has a human fallback", () => {
  for (const s of STEPS) {
    assert.ok(s.instructions.length > 20, `${s.id} needs instructions`);
    if (s.owner === "browser") assert.ok(/If the browser is unavailable/.test(s.instructions), `${s.id} needs a fallback`);
  }
});

test("money cannot be taken before tax, shipping and a test order exist", () => {
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));
  const required = ["tax-inclusive", "shipping", "payments", "invoicing", "e2e", "theme-redirect", "email-templates-install", "email-sender"];
  for (const need of required) {
    assert.ok(byId["test-order"].needs.includes(need), `test-order must need ${need}`);
  }
});
```

```js
// scripts/setup/state.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyState, markDone, loadState, saveState } from "./state.mjs";

test("markDone is pure and records time and note", () => {
  const s0 = emptyState();
  const s1 = markDone(s0, "intake", "answered", new Date("2026-10-04T10:00:00Z"));
  assert.deepEqual(s0, { done: {} });
  assert.deepEqual(s1.done.intake, { at: "2026-10-04T10:00:00.000Z", note: "answered" });
});

test("loadState returns empty state for a missing file and round-trips", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "setup-")), "state.json");
  assert.deepEqual(loadState(file), { done: {} });
  saveState(file, markDone(emptyState(), "a", undefined, new Date(0)));
  assert.deepEqual(loadState(file).done.a, { at: "1970-01-01T00:00:00.000Z" });
});
```

- [ ] **Step 6: Run, expect FAIL** (missing `steps.mjs`, `state.mjs`)

Run: `pnpm test:scripts`

- [ ] **Step 7: Implement state**

```js
// scripts/setup/state.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const emptyState = () => ({ done: {} });

export function markDone(state, id, note, now = new Date()) {
  return { ...state, done: { ...state.done, [id]: { at: now.toISOString(), ...(note ? { note } : {}) } } };
}

export function loadState(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : emptyState();
}

/** No secrets in here, only step ids, timestamps and short notes. Safe to commit. */
export function saveState(file, state) {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}
```

- [ ] **Step 8: Implement the registry**

```js
// scripts/setup/steps.mjs
/**
 * The setup plan, as data. Owner:
 *   api      the agent does it with an Admin API script
 *   browser  the agent clicks it in the Shopify admin while the human is logged in
 *   human    only a person can: identity, money, legal sign-off, a real card
 * `automation` names the `pnpm shop-setup <command>` that does it, when one exists.
 */
const FALLBACK = "If the browser is unavailable, give the human these exact clicks instead.";

export const STEPS = [
  {
    id: "intake",
    title: "Answer the store questionnaire",
    owner: "human",
    needs: [],
    instructions:
      "Ask the business decisions once, as concrete choices, and write the answers to store-setup.config.json (see store-setup.config.example.json): tax-inclusive prices, stock tracking, shipping rates and free-shipping threshold, whether compare-at prices are real, reviews, invoicing. Do not ask anything in this file again later.",
    verify: "pnpm shop-setup preflight --config-only",
  },
  {
    id: "store-basics",
    title: "Confirm store country, currency and contact email",
    owner: "human",
    needs: [],
    instructions:
      "Shopify admin > Settings > General. Confirm country, currency and contact email. Currency cannot change after the first order.",
  },
  {
    id: "tax-inclusive",
    title: 'Set "All prices include tax" to match the catalogue',
    owner: "browser",
    needs: ["intake", "store-basics"],
    instructions: `Shopify admin > Settings > Taxes and duties > the store country > set whether prices include tax to match pricesIncludeTax in store-setup.config.json. Read back with the Admin API field shop.taxesIncluded. ${FALLBACK}`,
    verify: "shop { taxesIncluded } equals config.pricesIncludeTax",
  },
  {
    id: "headless-channel",
    title: "Add the Headless sales channel and create a storefront",
    owner: "browser",
    needs: ["store-basics"],
    instructions: `Admin sidebar > Sales channels > + > Headless > Create storefront. Read the PUBLIC Storefront token off the page into .env.local (NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN). A token starting shpat_ is an Admin token and is wrong here. ${FALLBACK}`,
    verify: "pnpm shop-setup preflight",
  },
  {
    id: "dev-app",
    title: "Create the Dev Dashboard app with the Admin scopes",
    owner: "browser",
    needs: ["store-basics"],
    instructions: `Settings > Apps and sales channels > Develop apps > Build apps in Dev Dashboard. Scopes: write_shipping, read_locations, write_legal_policies (plus catalogue scopes when pushing products). Redirect URL exactly http://localhost:3456/callback. Release a new app version, then read Client ID and Client secret into .env.local (SHOPIFY_APP_CLIENT_ID, SHOPIFY_APP_CLIENT_SECRET). ${FALLBACK}`,
  },
  {
    id: "oauth",
    title: "Click Install on the app once",
    owner: "human",
    needs: ["dev-app"],
    instructions:
      "The agent prints an install URL; the person opens it and clicks Install. That mints the Admin token into .env.local. (The OAuth helper is ported in a follow-on plan; until then, mint the token through the Dev Dashboard install flow and paste it into .env.local as SHOPIFY_ADMIN_TOKEN.)",
  },
  {
    id: "preflight",
    title: "Check the Admin token has the scopes the steps need",
    owner: "api",
    needs: ["oauth"],
    instructions: "Run pnpm shop-setup preflight. If scopes are missing, a new app version was not released before install.",
    automation: "preflight",
  },
  {
    id: "shipping",
    title: "Create shipping zones and rates, including the free-shipping rule",
    owner: "api",
    needs: ["preflight", "intake"],
    instructions: "Run pnpm shop-setup shipping --dry-run, show the plan, then pnpm shop-setup shipping. Refuses if the zone would collide with an existing one.",
    automation: "shipping",
  },
  {
    id: "policies-draft",
    title: "Draft refund, privacy, terms and shipping policies",
    owner: "api",
    needs: ["preflight", "intake"],
    instructions: "Follow-on plan. Until then draft the four policies from the config and hand them to policies-approve.",
  },
  {
    id: "policies-approve",
    title: "Read and approve the legal policies",
    owner: "human",
    needs: ["policies-draft"],
    instructions: "A person must read the drafted policies before they go live; they are legally binding. Then publish via the API or Settings > Policies.",
  },
  {
    id: "checkout-domain",
    title: "Connect checkout.<domain> to Shopify and make it the primary domain",
    owner: "human",
    needs: ["intake", "store-basics"],
    instructions:
      "Shopify admin > Settings > Domains > Connect existing domain > enter checkout.<siteDomain> (siteDomain and checkoutSubdomain are in store-setup.config.json), then make it primary. At the DNS provider add a CNAME for the checkout subdomain to the target Shopify shows (normally shops.myshopify.com). Do NOT connect the main domain to Shopify: it stays on the frontend host. No API exists for this. Wait for Shopify to show the SSL as active.",
  },
  {
    id: "e2e",
    title: "Run the browser tests against the live site and Shopify",
    owner: "api",
    needs: ["checkout-domain", "headless-channel", "theme-redirect"],
    instructions:
      "Run pnpm test:e2e with E2E_SITE_URL set to the deployed frontend. It proves the Shopify theme URL redirects to the frontend, a cart created through /api/cart hands customers to checkout.<siteDomain>, and the pages load clean at 375px. A skipped test is NOT a pass: say which were skipped and why.",
    automation: "e2e",
  },
  {
    id: "theme-redirect",
    title: "Redirect the default Shopify theme to the frontend",
    owner: "browser",
    needs: ["checkout-domain"],
    instructions: `Paste the generated redirect snippet into layout/theme.liquid of the live theme (Online Store > Themes > the live theme > ... > Edit code), or push it with the Shopify CLI. The theme-files API needs a Shopify exemption, so it is not used. The snippet must NOT redirect the theme editor or preview, customer account pages, or anything Shopify serves itself such as checkout. ${FALLBACK}`,
  },
  {
    id: "email-templates-generate",
    title: "Generate branded customer email templates",
    owner: "api",
    needs: ["intake"],
    instructions:
      "Follow-on plan. Build Liquid for the order confirmation, shipping confirmation and refund emails from the frontend's brand (logo, colours, fonts in src/app/globals.css) and write them under email-templates/. Shopify has no API for these.",
  },
  {
    id: "email-templates-install",
    title: "Install the email templates in Shopify",
    owner: "browser",
    needs: ["email-templates-generate", "store-basics"],
    instructions: `Settings > Notifications > Customer notifications > open each template > Edit code > paste the matching file from email-templates/ > Save > Send test email. ${FALLBACK}`,
  },
  {
    id: "email-sender",
    title: "Authenticate the sender domain so emails do not land in spam",
    owner: "human",
    needs: ["store-basics"],
    instructions:
      "Settings > Notifications > Sender email > Authenticate domain, then add the DNS records Shopify lists (DKIM and SPF) at the DNS provider. Only the person with DNS access can do this.",
  },
  {
    id: "payments",
    title: "Activate payments",
    owner: "human",
    needs: ["store-basics"],
    instructions: "Settings > Payments. Needs identity, bank details and tax number; only the owner can do this. The agent never enters these.",
  },
  {
    id: "invoicing",
    title: "Install the invoicing app and connect it to the tax authority",
    owner: "human",
    needs: ["intake", "store-basics"],
    instructions: "Install a myDATA app (for example myData Comply) from the Shopify App Store, then enter the tax number (AFM) and the AADE credentials inside the app. The agent does not touch credentials. Skipped when config.invoicing is none.",
  },
  {
    id: "webhooks",
    title: "Register cache-invalidation webhooks",
    owner: "api",
    needs: ["preflight"],
    instructions: "Follow-on plan. Needs a public https SITE_URL after the first deploy. Webhooks created by an app are signed with the app client secret, not the Notifications-page secret.",
  },
  {
    id: "test-order",
    title: "Place a real order end to end and refund it",
    owner: "human",
    needs: ["tax-inclusive", "shipping", "payments", "invoicing", "e2e", "theme-redirect", "email-templates-install", "email-sender"],
    instructions: "Buy a real product with a real card. Check: checkout opens on checkout.<domain>, price at checkout equals the shelf price, shipping matches the rule, an invoice was issued, the order confirmation email arrives in the inbox (not spam) in the new design, and the default Shopify theme URL redirects to the frontend. Then refund it. Nothing else proves payments, tax, shipping and invoicing together.",
  },
  {
    id: "rotate-secrets",
    title: "Rotate every credential that was pasted into a chat",
    owner: "human",
    needs: ["test-order"],
    instructions: "Rotate the Storefront private token, the app client secret and any automation token, and remove the Admin token from any deployed environment.",
  },
];
```

- [ ] **Step 9: Run, expect all PASS**

Run: `pnpm test:scripts`
Expected: PASS (engine 4, steps 3, state 2, plus earlier).

- [ ] **Step 10: Commit**

```bash
git add scripts/setup
git commit -m "feat(setup): step registry, engine that hands humans one step at a time, state file"
```

---

### Task 4: Intake questionnaire config

**Files:**
- Create: `scripts/setup/intake.mjs`, `store-setup.config.example.json`
- Test: `scripts/setup/intake.test.mjs`

**Interfaces:**
- Produces: `PROFILES`, `validateConfig(raw): { ok: boolean; errors: string[]; config: Config|null; assumed: string[] }` where
  `Config = { profile: string; currency: string; pricesIncludeTax: boolean; tracksInventory: boolean; freeShippingThreshold: number|null; shippingCountries: string[]; shippingRates: {name: string; price: number; minWeightKg?: number; maxWeightKg?: number}[]; compareAtIsReal: boolean; wantsReviews: boolean; invoicing: "app"|"none" }`.
  `assumed` lists keys filled from the profile, so the agent can tell the human what it assumed.

- [ ] **Step 1: Write the failing test**

```js
// scripts/setup/intake.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "./intake.mjs";

const answers = {
  profile: "gr",
  siteDomain: "example.gr",
  tracksInventory: false,
  freeShippingThreshold: 500,
  shippingRates: [{ name: "Standard", price: 5.9 }],
  compareAtIsReal: false,
  wantsReviews: false,
};

test("greece profile fills the market defaults and reports what it assumed", () => {
  const r = validateConfig(answers);
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.config.currency, "EUR");
  assert.equal(r.config.pricesIncludeTax, true);
  assert.deepEqual(r.config.shippingCountries, ["GR"]);
  assert.equal(r.config.invoicing, "app");
  assert.equal(r.config.checkoutSubdomain, "checkout");
  assert.deepEqual(r.assumed.sort(), ["checkoutSubdomain", "currency", "invoicing", "pricesIncludeTax", "shippingCountries"]);
});

test("siteDomain is required and must be a bare hostname, not a URL", () => {
  const { siteDomain, ...rest } = answers;
  assert.match(validateConfig(rest).errors.join("\n"), /siteDomain/);
  assert.match(validateConfig({ ...answers, siteDomain: "https://example.gr/" }).errors.join("\n"), /siteDomain/);
  assert.equal(validateConfig({ ...answers, siteDomain: "shop.example.gr" }).ok, true);
});

test("checkoutSubdomain must be a single DNS label", () => {
  assert.match(validateConfig({ ...answers, checkoutSubdomain: "a.b" }).errors.join("\n"), /checkoutSubdomain/);
  assert.equal(validateConfig({ ...answers, checkoutSubdomain: "pay" }).ok, true);
});

test("business decisions have no defaults and must be answered", () => {
  const { tracksInventory, ...rest } = answers;
  const r = validateConfig(rest);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /tracksInventory/);
});

test("freeShippingThreshold may be an explicit null but not absent", () => {
  assert.equal(validateConfig({ ...answers, freeShippingThreshold: null }).ok, true);
  const { freeShippingThreshold, ...rest } = answers;
  assert.equal(validateConfig(rest).ok, false);
});

test("rejects a negative price and inverted weight bounds", () => {
  const bad = validateConfig({
    ...answers,
    shippingRates: [{ name: "x", price: -1 }, { name: "y", price: 1, minWeightKg: 10, maxWeightKg: 5 }],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join("\n"), /price/);
  assert.match(bad.errors.join("\n"), /weight/);
});

test("unknown profile is an error", () => {
  assert.match(validateConfig({ ...answers, profile: "zz" }).errors.join("\n"), /profile/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './intake.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```js
// scripts/setup/intake.mjs
/**
 * store-setup.config.json holds every business decision, asked once.
 * Profiles fill market facts (currency, tax treatment). Decisions that cost real
 * money to get wrong (stock, shipping rates, free-shipping rule, compare-at,
 * reviews) never default: the human must answer them.
 */
export const PROFILES = {
  gr: { currency: "EUR", pricesIncludeTax: true, shippingCountries: ["GR"], invoicing: "app", checkoutSubdomain: "checkout" },
};

const isBool = (v) => typeof v === "boolean";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function validateConfig(raw) {
  const errors = [];
  const profile = PROFILES[raw.profile];
  if (!profile) errors.push(`profile must be one of: ${Object.keys(PROFILES).join(", ")}`);

  const merged = { ...raw };
  const assumed = [];
  for (const [key, value] of Object.entries(profile ?? {})) {
    if (!(key in raw)) {
      merged[key] = value;
      assumed.push(key);
    }
  }

  if (!/^[A-Z]{3}$/.test(merged.currency ?? "")) errors.push("currency must be a 3-letter code like EUR");
  for (const key of ["pricesIncludeTax", "tracksInventory", "compareAtIsReal", "wantsReviews"]) {
    if (!isBool(merged[key])) errors.push(`${key} must be true or false`);
  }
  if (!("freeShippingThreshold" in merged)) errors.push("freeShippingThreshold must be answered (a number, or null for none)");
  else if (merged.freeShippingThreshold !== null && !(isNum(merged.freeShippingThreshold) && merged.freeShippingThreshold > 0)) {
    errors.push("freeShippingThreshold must be a positive number or null");
  }
  if (!Array.isArray(merged.shippingCountries) || !merged.shippingCountries.length || !merged.shippingCountries.every((c) => /^[A-Z]{2}$/.test(c))) {
    errors.push("shippingCountries must be a non-empty list of 2-letter codes");
  }
  if (!["app", "none"].includes(merged.invoicing)) errors.push('invoicing must be "app" or "none"');
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(merged.siteDomain ?? "")) errors.push("siteDomain must be a bare hostname like example.gr (no https://, no path)");
  if (!/^[a-z0-9-]+$/.test(merged.checkoutSubdomain ?? "")) errors.push("checkoutSubdomain must be a single label like checkout");

  if (!Array.isArray(merged.shippingRates) || !merged.shippingRates.length) errors.push("shippingRates must have at least one rate");
  else {
    merged.shippingRates.forEach((rate, i) => {
      if (!rate.name || typeof rate.name !== "string") errors.push(`shippingRates[${i}].name is required`);
      if (!isNum(rate.price) || rate.price < 0) errors.push(`shippingRates[${i}].price must be a number >= 0`);
      const { minWeightKg: min, maxWeightKg: max } = rate;
      if (min !== undefined && !(isNum(min) && min >= 0)) errors.push(`shippingRates[${i}] weight min must be >= 0`);
      if (max !== undefined && !(isNum(max) && max > 0)) errors.push(`shippingRates[${i}] weight max must be > 0`);
      if (min !== undefined && max !== undefined && min >= max) errors.push(`shippingRates[${i}] weight min must be below max`);
    });
  }

  return { ok: errors.length === 0, errors, config: errors.length ? null : merged, assumed };
}
```

- [ ] **Step 4: Add the example config**

```json
{
  "profile": "gr",
  "siteDomain": "example.gr",
  "tracksInventory": false,
  "freeShippingThreshold": 500,
  "shippingRates": [
    { "name": "Standard", "price": 5.9, "maxWeightKg": 30 },
    { "name": "Heavy delivery", "price": 29, "minWeightKg": 30 }
  ],
  "compareAtIsReal": false,
  "wantsReviews": false
}
```

Save as `store-setup.config.example.json`. Keys omitted here (`currency`, `pricesIncludeTax`, `shippingCountries`, `invoicing`, `checkoutSubdomain`) come from the `gr` profile. `siteDomain` is the frontend's public domain and is always asked.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm test:scripts`

- [ ] **Step 6: Commit**

```bash
git add scripts/setup/intake.mjs scripts/setup/intake.test.mjs store-setup.config.example.json
git commit -m "feat(setup): intake config with a Greece profile and no defaults for money decisions"
```

---

### Task 5: Shipping zone builder and applier

**Files:**
- Create: `scripts/setup/shipping.mjs`
- Test: `scripts/setup/shipping.test.mjs`

**Interfaces:**
- Consumes: `Config` from Task 4; `adminGraphQL` from Task 2.
- Produces: `buildZone(config): ZoneInput`, `findCountryCollisions(profile, countries): {zone: string; country: string}[]`, `applyShipping({ dryRun, locationId }): Promise<void>`.

**Risk, stated up front:** the exact `DeliveryMethodDefinitionInput` / condition field names below are from the docs and memory, not from a live schema. Step 1 checks them against a real store first. If the live shape differs, change `buildZone` and its test together.

- [ ] **Step 1: Check the live schema on a development store**

Needs `.env.local` with a development store's `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_TOKEN` (human steps `dev-app` + `oauth`).

Run:

```bash
node scripts/shopify/introspect.mjs DeliveryMethodDefinitionInput
node scripts/shopify/introspect.mjs DeliveryRateDefinitionInput
node scripts/shopify/introspect.mjs DeliveryPriceConditionInput
node scripts/shopify/introspect.mjs DeliveryWeightConditionInput
node scripts/shopify/introspect.mjs DeliveryLocationGroupZoneInput
```

Expected shape (confirm each; adjust the code below if not):
- `DeliveryMethodDefinitionInput`: `name`, `active`, `rateDefinition`, `priceConditionsToCreate`, `weightConditionsToCreate`
- `DeliveryPriceConditionInput`: `operator`, `criteria: MoneyInput {amount, currencyCode}`
- `DeliveryWeightConditionInput`: `operator`, `criteria: WeightInput {value, unit}`
- `DeliveryLocationGroupZoneInput`: `name`, `countries`, `methodDefinitionsToCreate`

If this cannot be run yet (no development store), say so and mark Step 6 as unverified. Do not guess silently.

- [ ] **Step 2: Write the failing test**

```js
// scripts/setup/shipping.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildZone, findCountryCollisions } from "./shipping.mjs";

const config = {
  currency: "EUR",
  shippingCountries: ["GR"],
  freeShippingThreshold: 500,
  shippingRates: [
    { name: "Standard", price: 5.9, maxWeightKg: 30 },
    { name: "Heavy delivery", price: 29, minWeightKg: 30 },
  ],
};

test("zone covers the configured countries entirely", () => {
  assert.deepEqual(buildZone(config).countries, [{ code: "GR", includeAllProvinces: true }]);
});

test("free shipping is a real rule at the threshold, in the shop currency", () => {
  const free = buildZone(config).methodDefinitionsToCreate.find((m) => m.name === "Free shipping");
  assert.equal(free.rateDefinition.price.amount, "0.00");
  assert.deepEqual(free.priceConditionsToCreate, [
    { operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { amount: "500.00", currencyCode: "EUR" } },
  ]);
});

test("paid rates stop just below the threshold so both options never show together", () => {
  const std = buildZone(config).methodDefinitionsToCreate.find((m) => m.name === "Standard");
  assert.equal(std.rateDefinition.price.amount, "5.90");
  assert.deepEqual(std.priceConditionsToCreate, [
    { operator: "LESS_THAN_OR_EQUAL_TO", criteria: { amount: "499.99", currencyCode: "EUR" } },
  ]);
});

test("weight bounds become weight conditions in kilograms", () => {
  const methods = buildZone(config).methodDefinitionsToCreate;
  assert.deepEqual(methods.find((m) => m.name === "Standard").weightConditionsToCreate, [
    { operator: "LESS_THAN_OR_EQUAL_TO", criteria: { value: 30, unit: "KILOGRAMS" } },
  ]);
  assert.deepEqual(methods.find((m) => m.name === "Heavy delivery").weightConditionsToCreate, [
    { operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { value: 30, unit: "KILOGRAMS" } },
  ]);
});

test("no threshold means no free rule and no price cap", () => {
  const methods = buildZone({ ...config, freeShippingThreshold: null }).methodDefinitionsToCreate;
  assert.equal(methods.some((m) => m.name === "Free shipping"), false);
  assert.equal(methods[0].priceConditionsToCreate, undefined);
});

test("collisions are reported so the applier can refuse instead of duplicating", () => {
  const profile = {
    profileLocationGroups: [
      { locationGroupZones: { nodes: [{ zone: { name: "Domestic", countries: [{ code: { countryCode: "GR" } }] } }] } },
    ],
  };
  assert.deepEqual(findCountryCollisions(profile, ["GR", "CY"]), [{ zone: "Domestic", country: "GR" }]);
  assert.deepEqual(findCountryCollisions(profile, ["CY"]), []);
});
```

- [ ] **Step 3: Run, expect FAIL** (`Cannot find module './shipping.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 4: Implement the pure builders**

```js
// scripts/setup/shipping.mjs
import { adminGraphQL } from "../shopify/admin-client.mjs";
import { bad, info, ok } from "../shopify/env.mjs";

const money = (n, currencyCode) => ({ amount: n.toFixed(2), currencyCode });
const round2 = (n) => Math.round(n * 100) / 100;

/** One zone with every configured country, every paid rate, and the free rule. */
export function buildZone(config) {
  const { currency, freeShippingThreshold: threshold } = config;
  const methods = config.shippingRates.map((rate) => {
    const method = {
      name: rate.name,
      active: true,
      rateDefinition: { price: money(rate.price, currency) },
    };
    if (threshold !== null) {
      // Cap paid rates just under the threshold so the paid and free options never both show.
      method.priceConditionsToCreate = [{ operator: "LESS_THAN_OR_EQUAL_TO", criteria: money(round2(threshold - 0.01), currency) }];
    }
    const weight = [];
    if (rate.minWeightKg !== undefined) weight.push({ operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { value: rate.minWeightKg, unit: "KILOGRAMS" } });
    if (rate.maxWeightKg !== undefined) weight.push({ operator: "LESS_THAN_OR_EQUAL_TO", criteria: { value: rate.maxWeightKg, unit: "KILOGRAMS" } });
    if (weight.length) method.weightConditionsToCreate = weight;
    return method;
  });

  if (threshold !== null) {
    methods.push({
      name: "Free shipping",
      active: true,
      rateDefinition: { price: money(0, currency) },
      priceConditionsToCreate: [{ operator: "GREATER_THAN_OR_EQUAL_TO", criteria: money(threshold, currency) }],
    });
  }

  return {
    name: "Storefront shipping",
    countries: config.shippingCountries.map((code) => ({ code, includeAllProvinces: true })),
    methodDefinitionsToCreate: methods,
  };
}

export function findCountryCollisions(profile, countries) {
  const found = [];
  for (const group of profile.profileLocationGroups ?? []) {
    for (const { zone } of group.locationGroupZones?.nodes ?? []) {
      for (const country of zone.countries ?? []) {
        const code = country.code?.countryCode;
        if (countries.includes(code)) found.push({ zone: zone.name, country: code });
      }
    }
  }
  return found;
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm test:scripts`
Expected: PASS, 6 tests in shipping.test.mjs.

- [ ] **Step 6: Implement the applier (network, thin)**

Append to `scripts/setup/shipping.mjs`:

```js
const DISCOVERY = `
  query {
    locations(first: 10) { nodes { id name isActive } }
    deliveryProfiles(first: 10) {
      nodes {
        id name default
        profileLocationGroups {
          locationGroup { id }
          locationGroupZones(first: 50) {
            nodes { zone { id name countries { code { countryCode } } } }
          }
        }
      }
    }
  }`;

const UPDATE = `
  mutation($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      profile { id name }
      userErrors { field message }
    }
  }`;

/**
 * Adds the zone to the store's default (General) profile.
 * Refuses on a country collision rather than duplicate or overwrite: the person
 * decides what happens to a zone they or Shopify already created.
 * UNVERIFIED until run against a development store (Step 1 and Task 8).
 */
export async function applyShipping({ config, dryRun = false, locationId } = {}) {
  const data = await adminGraphQL(DISCOVERY);
  const active = data.locations.nodes.filter((l) => l.isActive);
  const location = locationId ? active.find((l) => l.id === locationId) : active.length === 1 ? active[0] : null;
  if (!location) {
    bad(`pick a location with --location=<id>: ${active.map((l) => `${l.name} ${l.id}`).join(", ") || "none active"}`);
    process.exit(1);
  }

  const profile = data.deliveryProfiles.nodes.find((p) => p.default);
  if (!profile) {
    bad("no default delivery profile found");
    process.exit(1);
  }

  const collisions = findCountryCollisions(profile, config.shippingCountries);
  if (collisions.length) {
    bad("these countries already have a shipping zone, not touching them:");
    for (const c of collisions) info(`${c.country} in zone "${c.zone}"`);
    info("Edit or delete those zones in Settings > Shipping and delivery, then re-run.");
    process.exit(2);
  }

  const zone = buildZone(config);
  const group = profile.profileLocationGroups[0]?.locationGroup;
  const input = group
    ? { locationGroupsToUpdate: [{ id: group.id, zonesToCreate: [zone] }] }
    : { locationGroupsToCreate: [{ locations: [location.id], zonesToCreate: [zone] }] };

  info(`profile ${profile.name} (${profile.id}), location ${location.name}`);
  info(JSON.stringify(zone, null, 2));
  if (dryRun) {
    ok("dry run, nothing written");
    return;
  }
  await adminGraphQL(UPDATE, { id: profile.id, profile: input });
  ok(`shipping zone created with ${zone.methodDefinitionsToCreate.length} rate(s)`);
}
```

- [ ] **Step 7: Re-run unit tests (the applier must not break imports)**

Run: `pnpm test:scripts`
Expected: PASS. (`applyShipping` is not called at import time.)

- [ ] **Step 8: Commit**

```bash
git add scripts/setup/shipping.mjs scripts/setup/shipping.test.mjs
git commit -m "feat(setup): shipping zone builder with free-shipping rule and collision guard"
```

---

### Task 6: CLI and the agent runbook

**Files:**
- Create: `scripts/setup/cli.mjs`, `.claude/skills/shopify-store-setup/SKILL.md`
- Modify: `AGENTS.md`, `.gitignore` (confirm `.env*` is ignored)

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm shop-setup status | next | done <id> [note] | preflight [--config-only] | shipping [--dry-run] [--location=<id>]`.

- [ ] **Step 1: Implement the CLI**

```js
// scripts/setup/cli.mjs
import { existsSync, readFileSync } from "node:fs";
import { nextActions } from "./engine.mjs";
import { STEPS } from "./steps.mjs";
import { loadState, markDone, saveState } from "./state.mjs";
import { validateConfig } from "./intake.mjs";
import { applyShipping } from "./shipping.mjs";
import { SCOPES, grantedScopes, missingScopes } from "../shopify/admin-client.mjs";
import { bad, heading, info, ok, warn } from "../shopify/env.mjs";

const STATE_FILE = "store-setup.state.json";
const CONFIG_FILE = "store-setup.config.json";
const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const args = rest.filter((a) => !a.startsWith("--"));

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    bad(`${CONFIG_FILE} not found. The intake step has not been done.`);
    process.exit(1);
  }
  const result = validateConfig(JSON.parse(readFileSync(CONFIG_FILE, "utf8")));
  if (!result.ok) {
    bad(`${CONFIG_FILE} is invalid:`);
    result.errors.forEach((e) => info(e));
    process.exit(1);
  }
  if (result.assumed.length) warn(`assumed from the ${result.config.profile} profile: ${result.assumed.join(", ")}. Tell the human.`);
  return result.config;
}

const state = loadState(STATE_FILE);

switch (command) {
  case "status": {
    for (const s of STEPS) {
      const mark = state.done[s.id] ? "done" : s.needs.every((n) => state.done[n]) ? "ready" : "wait ";
      console.log(`  [${mark}] ${s.owner.padEnd(7)} ${s.id.padEnd(17)} ${s.title}`);
    }
    break;
  }
  case "next": {
    const { agent, human } = nextActions(STEPS, state);
    heading("Agent can do now (start these first, in parallel with the human step):");
    if (!agent.length) info("nothing");
    for (const s of agent) info(`${s.id} (${s.owner}): ${s.instructions}`);
    heading("Ask the human for exactly this one thing:");
    if (!human.length) info("nothing, or everything is done");
    for (const s of human) info(`${s.id}: ${s.title}\n         ${s.instructions}`);
    break;
  }
  case "done": {
    const id = args[0];
    if (!STEPS.some((s) => s.id === id)) {
      bad(`unknown step: ${id}`);
      process.exit(1);
    }
    saveState(STATE_FILE, markDone(state, id, args.slice(1).join(" ") || undefined));
    ok(`${id} marked done`);
    break;
  }
  case "preflight": {
    const config = loadConfig();
    ok(`config valid (profile ${config.profile}, ${config.currency})`);
    if (flags["config-only"] !== undefined) break;
    const granted = await grantedScopes();
    const required = [...new Set([...SCOPES.shipping, ...SCOPES.policies])];
    const missing = missingScopes(granted, required);
    if (missing.length) {
      bad(`missing scopes: ${missing.join(", ")}. Release a new app version, then reinstall.`);
      process.exit(1);
    }
    ok(`admin token has: ${required.join(", ")}`);
    break;
  }
  case "shipping": {
    await applyShipping({ config: loadConfig(), dryRun: flags["dry-run"] !== undefined, locationId: flags.location });
    break;
  }
  default:
    console.log("usage: pnpm shop-setup status | next | done <id> [note] | preflight [--config-only] | shipping [--dry-run] [--location=<id>]");
    process.exit(command ? 1 : 0);
}
```

- [ ] **Step 2: Smoke-test what needs no network**

Run: `pnpm shop-setup status && pnpm shop-setup next`
Expected: `status` lists all 21 steps; only `intake` and `store-basics` are `ready`; everything else is `wait`. `next` shows no agent steps and asks the human for `intake`.

Run: `cp store-setup.config.example.json store-setup.config.json && pnpm shop-setup preflight --config-only && rm store-setup.config.json`
Expected: `[warn] assumed from the gr profile: currency, pricesIncludeTax, shippingCountries, invoicing, checkoutSubdomain` then `[ok] config valid (profile gr, EUR)`.

- [ ] **Step 3: Write the runbook**

Create `.claude/skills/shopify-store-setup/SKILL.md`:

````markdown
---
name: shopify-store-setup
description: Set up a Shopify store behind this headless frontend end to end - taxes, shipping, policies, invoicing, payments, test order - doing everything an agent can and handing the human one step at a time. Use whenever the user mentions setting up the shop, going live, taxes, shipping rates, invoices, policies, or "the Shopify side".
---

# Shopify store setup

The agent does its part and asks the human only for what only a human can do.

## The loop

1. `pnpm shop-setup next`. It prints what you can do now and the ONE thing to ask the human.
2. Start the agent steps immediately, in parallel with the human step.
3. Ask the human for the one step, in plain words, with the exact menu path. Wait.
4. When a step is done and checked, `pnpm shop-setup done <id> "<note>"`.
5. Repeat until `pnpm shop-setup status` shows everything done.

Do not ask for two human things at once. Do not ask anything the questionnaire already answered.

## Intake first

If `store-setup.config.json` is missing, ask the business decisions once with AskUserQuestion (concrete choices, trade-off in the description, commercial words not technical ones): stock tracking, shipping rates and free-shipping threshold, whether compare-at prices are real, reviews. Write the answers to `store-setup.config.json` (shape: `store-setup.config.example.json`). Tell the human which values the profile assumed (`pnpm shop-setup preflight --config-only` prints them).

If they say "decide later" on tax: push back once (it cannot change after the first order), then use tax-inclusive for EU retail and say you did.

## Browser steps

Only while the human is logged into Shopify and watching. Never type a password, card, bank, tax-number or ID. Read tokens off the screen into `.env.local`; never into a committed file or the chat. If the browser is unavailable, give the human the exact clicks.

## Rules

- Say "unverified" for anything not run against a real (development) store. Pure-logic tests are not proof.
- Never put `SHOPIFY_ADMIN_TOKEN`, client id or client secret in the deployed environment.
- Tokens pasted into chat: tell the human once to rotate them.
- Policies and legal text are drafted by you and approved by a person. Never publish unread.
- Never invent reviews, "was" prices or testimonials.
- Introspect before changing a mutation: `node scripts/shopify/introspect.mjs <InputTypeName>`.
- Shopify moves menus. If a path is gone, use the admin search box with the bold term, then fix `scripts/setup/steps.mjs`.

## Done means

`pnpm shop-setup status` all done, the test order placed and refunded, an invoice issued for it, and credentials rotated.
````

- [ ] **Step 4: Point AGENTS.md at it**

Append to `AGENTS.md` (after the existing Next.js block, outside its BEGIN/END markers):

```markdown

# Store setup

To set up or take live a Shopify store behind this frontend, follow `.claude/skills/shopify-store-setup/SKILL.md` and start with `pnpm shop-setup next`.
```

- [ ] **Step 5: Confirm secrets are ignored**

Run: `git check-ignore -v .env.local .env store-setup.config.json || true; grep -n "env" .gitignore`
Expected: `.env*` is ignored. If `.env.local` is not ignored, add `.env*` to `.gitignore`. `store-setup.config.json` and `store-setup.state.json` hold no secrets and may be committed per store.

- [ ] **Step 6: Commit**

```bash
git add scripts/setup/cli.mjs .claude/skills/shopify-store-setup/SKILL.md AGENTS.md .gitignore
git commit -m "feat(setup): setup CLI and agent runbook"
```

---

### Task 7: Browser test suite

The frontend in this repo is a demo shell and every real frontend will look different, so these tests never click a frontend's buttons. They test what every frontend shares: the Shopify theme URL, the `/api/cart` proxy from this SDK, and page basics. A test that cannot run (no store, no deployed URL) **skips with a reason**; a skip is never reported as a pass.

**Files:**
- Create: `playwright.config.mjs`, `e2e/env.mjs`, `e2e/env.test.mjs`, `e2e/checkout-host.spec.mjs`, `e2e/theme-redirect.spec.mjs`, `e2e/pages.spec.mjs`
- Modify: `package.json` (devDependency, `test:e2e`), `.gitignore`, `scripts/setup/cli.mjs` (add `e2e` command and usage text)

**Interfaces:**
- Consumes: `shopifyEnv` (Task 1), `validateConfig` (Task 4).
- Produces: `checkoutHost(config): string`, `isOnHost(url, host): boolean`, `loadE2E(): { config, env, siteUrl }`; `pnpm test:e2e`; `pnpm shop-setup e2e`.

- [ ] **Step 1: Install Playwright**

Run: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`
Add to `package.json` scripts: `"test:e2e": "playwright test"`. Add `/test-results/` and `/playwright-report/` to `.gitignore`.

- [ ] **Step 2: Write the failing unit test for the URL helpers**

```js
// e2e/env.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { checkoutHost, isOnHost } from "./env.mjs";

test("checkoutHost joins subdomain and site domain", () => {
  assert.equal(checkoutHost({ checkoutSubdomain: "checkout", siteDomain: "example.gr" }), "checkout.example.gr");
});

test("isOnHost matches the exact hostname only", () => {
  assert.equal(isOnHost("https://checkout.example.gr/checkouts/cn/abc", "checkout.example.gr"), true);
  assert.equal(isOnHost("https://shop.myshopify.com/checkouts/cn/abc", "checkout.example.gr"), false);
  assert.equal(isOnHost("https://checkout.example.gr.evil.com/", "checkout.example.gr"), false);
  assert.equal(isOnHost("not a url", "checkout.example.gr"), false);
});
```

- [ ] **Step 3: Run, expect FAIL** (`Cannot find module './env.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 4: Implement the helpers**

```js
// e2e/env.mjs
import { existsSync, readFileSync } from "node:fs";
import { shopifyEnv } from "../scripts/shopify/env.mjs";
import { validateConfig } from "../scripts/setup/intake.mjs";

export const checkoutHost = (config) => `${config.checkoutSubdomain}.${config.siteDomain}`;

export function isOnHost(url, host) {
  try {
    return new URL(url).hostname === host;
  } catch {
    return false;
  }
}

/** Everything the specs need. Missing pieces make specs skip, not fail. */
export function loadE2E() {
  const file = "store-setup.config.json";
  const config = existsSync(file) ? validateConfig(JSON.parse(readFileSync(file, "utf8"))).config : null;
  return { config, env: shopifyEnv(), siteUrl: (process.env.E2E_SITE_URL ?? "").replace(/\/+$/, "") };
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm test:scripts`

- [ ] **Step 6: Write the Playwright config and specs**

```js
// playwright.config.mjs
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.mjs",
  timeout: 60_000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
});
```

```js
// e2e/checkout-host.spec.mjs
import { test, expect } from "@playwright/test";
import { checkoutHost, isOnHost, loadE2E } from "./env.mjs";

const { config, env, siteUrl } = loadE2E();

/** First purchasable variant, read straight from the Storefront API with the public token. */
async function firstVariantId() {
  const res = await fetch(`https://${env.domain}/api/${env.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": env.storefrontToken },
    body: JSON.stringify({ query: "{ products(first: 20) { nodes { variants(first: 5) { nodes { id availableForSale } } } } }" }),
  });
  const json = await res.json();
  for (const product of json.data?.products?.nodes ?? []) {
    for (const variant of product.variants.nodes) if (variant.availableForSale) return variant.id;
  }
  return null;
}

test("a cart created through the site hands customers to the checkout subdomain", async ({ request }) => {
  test.skip(!config || !siteUrl || !env.domain || !env.storefrontToken, "needs store-setup.config.json, E2E_SITE_URL and a storefront token");
  const variantId = await firstVariantId();
  test.skip(!variantId, "the storefront has no purchasable variant yet");

  const res = await request.post(`${siteUrl}/api/cart`, {
    data: { action: "create", lines: [{ merchandiseId: variantId, quantity: 1 }] },
  });
  expect(res.ok(), `POST /api/cart returned ${res.status()}`).toBeTruthy();
  const cart = await res.json();
  expect(isOnHost(cart.checkoutUrl, checkoutHost(config)), `checkoutUrl was ${cart.checkoutUrl}`).toBe(true);
});
```

```js
// e2e/theme-redirect.spec.mjs
import { test, expect } from "@playwright/test";
import { loadE2E } from "./env.mjs";

const { config, env } = loadE2E();

test("the default Shopify theme URL ends up on the frontend", async ({ page }) => {
  test.skip(!config || !env.domain, "needs store-setup.config.json and SHOPIFY_STORE_DOMAIN");
  await page.goto(`https://${env.domain}/`, { waitUntil: "commit" });
  await page.waitForURL((url) => url.hostname === config.siteDomain, { timeout: 20_000 });
  expect(new URL(page.url()).hostname).toBe(config.siteDomain);
});

test("the redirect leaves customer account pages on Shopify", async ({ page }) => {
  test.skip(!config || !env.domain, "needs store-setup.config.json and SHOPIFY_STORE_DOMAIN");
  await page.goto(`https://${env.domain}/account/login`, { waitUntil: "commit" });
  // A late JS redirect would land after the load; give it a fair chance before concluding it did not happen.
  await page.waitForTimeout(5000);
  expect(new URL(page.url()).hostname).not.toBe(config.siteDomain);
});
```

```js
// e2e/pages.spec.mjs
import { test, expect } from "@playwright/test";
import { loadE2E } from "./env.mjs";

const { siteUrl } = loadE2E();
const paths = (process.env.E2E_PATHS ?? "/").split(",").map((p) => p.trim());

for (const path of paths) {
  test(`${path} loads without errors and without horizontal scroll`, async ({ page }) => {
    test.skip(!siteUrl, "needs E2E_SITE_URL");
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    const res = await page.goto(`${siteUrl}${path}`, { waitUntil: "networkidle" });
    expect(res.status()).toBeLessThan(400);
    expect(errors).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
  });
}
```

- [ ] **Step 7: Prove the suite lists and skips cleanly with nothing configured**

Run: `pnpm exec playwright test --list`
Expected: lists `checkout-host`, `theme-redirect` (2) and `pages` tests, for both `desktop` and `mobile`.

Run: `pnpm test:e2e`
Expected: exit 0 with every test reported as **skipped** and the reasons printed. Say in the report that nothing was actually exercised.

- [ ] **Step 8: Add the CLI command**

In `scripts/setup/cli.mjs` add `import { spawnSync } from "node:child_process";` and, before `default:`:

```js
  case "e2e": {
    const run = spawnSync("pnpm", ["exec", "playwright", "test"], { stdio: "inherit" });
    if (run.status === 0) info("Skipped tests are not passes. Check the output above for skips before marking this step done.");
    process.exit(run.status ?? 1);
  }
```

and add `| e2e` to the usage string.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore playwright.config.mjs e2e scripts/setup/cli.mjs
git commit -m "feat(setup): browser tests for theme redirect, checkout subdomain and page basics"
```

---

### Task 8: Verification gate (human-assisted)

**Files:** none changed unless a check fails.

- [ ] **Step 1: Repo gates**

Run: `pnpm test:scripts && pnpm lint && pnpm build`
Expected: all pass. Report real output; fix before continuing if anything fails.

- [ ] **Step 2: Dev-store run (the only proof for shipping)**

Needs a Shopify development store (human creates it in the Dev Dashboard) with `.env.local` set.

```bash
pnpm shop-setup preflight
pnpm shop-setup shipping --dry-run
pnpm shop-setup shipping
```

Expected: scopes ok; the dry run prints the zone; the real run creates it. Then in the store: Settings > Shipping and delivery shows the zone with the paid rates and the free rule, and a test checkout at 499.99 and at 500.00 shows the right option. Also run twice: the second run must refuse with the collision message, not duplicate.

- [ ] **Step 2b: Browser tests against the real site**

With the frontend deployed (or running on a reachable URL) and the pilot store connected:

```bash
E2E_SITE_URL=https://example.gr pnpm test:e2e
```

Expected: nothing skipped. The redirect, checkout-host and page tests all pass on desktop and mobile. If the account-page test fails, the redirect snippet is redirecting customer pages and must be fixed.

- [ ] **Step 3: Record the outcome**

If the live schema differed in Task 5 Step 1, the code and tests were already changed. State plainly in the handover: verified on a development store, or "shipping applier unverified — no development store was available".

---

## Follow-on plans (not in this plan)

1. **Policies:** drafting from config, human approval gate, `shopPolicyUpdate` (needs `write_legal_policies`).
2. **Domain, redirect and emails:** a generated theme-redirect snippet with tests for what it must NOT redirect (theme editor and preview, customer account pages, checkout); branded email Liquid generated from the frontend's brand into `email-templates/`; and click scripts for the paste steps. The pilot store's existing redirect is the starting point for the snippet: read it from the live theme first, do not rewrite it from memory. Also confirm whether `shopify theme push` with a Theme Access password works without the API exemption.
3. **Browser runbooks:** exact click scripts for `tax-inclusive`, `headless-channel`, `dev-app`, tested against a development store.
4. **Invoicing check:** confirm the myDATA app issues an invoice for the test order; wire into `test-order`.
5. **Catalogue push, OAuth helper and webhooks** ported from `landing-template` / `xristos-store` into `scripts/shopify/` with this repo's env names.
6. **Profiles:** more countries beyond `gr`.

## Self-review

- **Spec coverage:** one repo only (all tasks); Greece default with configurable profile (Task 4); app-based invoicing, no custom code (steps `invoicing`, `test-order`); browser steps with human watching and credential rules (registry + skill); human gets one step at a time (Task 3 engine); questionnaire asked once (Task 4, skill). Theme redirect, checkout subdomain and custom emails (added 2026-10-04) are in the registry and the intake config now, so the agent hands them out in the right order; their automation is in follow-on plan 2. Gaps by design: policies, browser click scripts, catalogue push, webhooks (follow-on list).
- **Placeholders:** none in code steps. Two honest unknowns are stated, not hidden: live Delivery* input shapes (Task 5 Step 1) and whether the tax toggle has an API (treated as browser step).
- **Type consistency:** `Step`, `State`, `Config`, `buildZone`, `findCountryCollisions`, `applyShipping({config, dryRun, locationId})`, `missingScopes(granted, required)` match across tasks 1–6. The CLI passes `config` into `applyShipping`, and the `profile` fixture shape in the collision test matches the `DISCOVERY` query.

## Corrections made while building (2026-10-04)

Found by running the code, not by reading it:

- `node --test scripts/` does not work on Node 24 (a bare folder is treated as a module). The script uses file globs: `node --test "scripts/**/*.test.mjs" "e2e/**/*.test.mjs"`.
- `setup` collides with pnpm's own built-in `setup` command, so the command is `pnpm shop-setup`.
- The first CLI parsed `--dry-run` as unset (`Object.fromEntries` gives `undefined` for a bare flag), so `shipping --dry-run` would have performed a real write. Fixed test-first with `scripts/setup/args.mjs` (`parseArgs`), where a bare flag is `true`, and the CLI checks `flags["dry-run"] === true`.
- Registry grew from 21 to 36 steps after a gap review (2026-10-04): legal-details, customer-accounts, hosting, catalogue, inventory, courier, eu-vat, cod-payment, staff-alerts, languages, cookie-consent, seo, search-console, withdrawal-button and go-live. A new owner kind `code` means the agent edits the frontend. `webhooks` and `e2e` now need `hosting`; `test-order` also needs `catalogue` and `courier`; `go-live` transitively waits for everything. A step that does not apply is marked done with an `n/a: reason`.
- Confirmed against shopify.dev: tax fields on `Shop` are read-only (so `tax-inclusive` stays a browser/human step); `inventoryItemUpdate` can set `tracked` (`write_inventory`); `fulfillmentCreate` takes tracking info; cash on delivery is a built-in manual payment method under Settings > Payments; the Customer Privacy API needs `setTrackingConsent` with `headlessStorefront`, `checkoutRootDomain`, `storefrontRootDomain` and the public token; customer login is optional. Not confirmed: the mutation that sets stock quantities, EU VAT/OSS rules, and how Greece applies the withdrawal-function directive.
