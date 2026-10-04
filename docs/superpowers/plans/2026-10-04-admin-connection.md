# Admin API Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the connection to a store's Admin API: the agent gets its own token without a human where Shopify allows it, falls back to one Install click where it does not, registers the cache webhooks, and the site's webhook route stops accepting unsigned requests.

**Architecture:** `admin-client` resolves the Admin token itself (explicit token, else the client credentials grant, held in memory only). A hardened OAuth helper covers stores outside the app's Shopify organization. A planner/applier registers webhooks against the SDK's `/api/revalidate`. The route's signature check moves into a small pure module that fails closed.

**Tech Stack:** Node ESM `.mjs`, `node --test`, Node 24 native type stripping for one `.ts` import in tests. No new dependencies.

**Spec:** Section "Design decisions" below. Builds on `2026-10-04-store-setup-foundation.md` (the `dev-app`, `oauth`, `preflight`, `webhooks` steps).

## Design decisions (confirmed on shopify.dev, 2026-10-04)

- **Client credentials grant:** `POST https://{shop}.myshopify.com/admin/oauth/access_token`, form-encoded `grant_type=client_credentials`, `client_id`, `client_secret`. Returns `access_token`, `scope`, `expires_in` (86399 s, 24 h). No redirect. **Only works when the app and the store are in the same Shopify organization**, and the app must be installed on the store. A dev store created in the Dev Dashboard qualifies; a client's own store does not.
- **Authorization code grant** stays as the fallback for stores outside the org. The callback carries `code, hmac, host, shop, state, timestamp`. Verify: drop `hmac`, sort the rest, join `k=v&...`, HMAC-SHA256 with the client secret, constant-time compare; validate `shop` against `^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$`. The old landing-template script skipped the HMAC and shop checks.
- **Webhooks** created through the Admin API are signed with the app's **client secret** (`X-Shopify-Hmac-SHA256`, base64 HMAC-SHA256 of the raw body). Shopify allows 5 s per delivery and deletes a subscription after 8 failed retries.
- The token is never written to disk when minted. Only an explicit `SHOPIFY_ADMIN_TOKEN` (from the OAuth fallback) is stored in `.env.local`.
- **Behaviour change:** `/api/revalidate` currently accepts unsigned requests when `SHOPIFY_WEBHOOK_SECRET` is unset. It will answer 503 instead.

## Global Constraints

- No new npm dependencies. Unit tests use `node:test`; run with `pnpm test:scripts`.
- Every JS block in this plan starts with its path as a `// comment` line.
- Never log a token or secret; use `mask()`.
- Nothing is "verified" until it has run against a real (development) store. Say "unverified" otherwise.

## Known risks, stated up front

- The docs say the authorization-code exchange for **public** apps needs `expiring=1`. For an app in your own organization we send no `expiring` flag and expect a non-expiring token. If the response carries `expires_in`, the CLI warns: the token will stop working.
- The OAuth `hmac` is compared as a hex digest. That matches Shopify's long-standing behaviour but was not shown in the docs page read; the first live run settles it, and a failure prints a clear diagnostic instead of proceeding.
- The exact Dev Dashboard clicks to install an app were not found in the docs (404), so the `dev-app` step's install instruction stays "use the Dev Dashboard's Install button", with the human fallback.

## File structure

```
scripts/shopify/token.mjs                 client credentials: mintAdminToken(), explainTokenError()
scripts/shopify/token.test.mjs
scripts/shopify/admin-client.mjs          modify (full replacement): resolveAdminToken(), all scopes
scripts/shopify/admin-client.test.mjs     modify: token resolution tests
scripts/shopify/introspect.mjs            modify: use resolveAdminToken()
scripts/shopify/oauth.mjs                 buildAuthorizeUrl(), computeHmac(), verifyCallback(), runOAuth()
scripts/shopify/oauth.test.mjs
scripts/shopify/webhooks.mjs              planWebhooks(), webhookSecretStatus(), registerWebhooks(), listWebhooks()
scripts/shopify/webhooks.test.mjs
src/lib/shopify/webhook.ts                verifyShopifyWebhook(): pure, fails closed
scripts/shopify/webhook-verify.test.mjs
src/app/api/revalidate/route.ts           modify: use verifyShopifyWebhook()
scripts/setup/cli.mjs                     modify: token, oauth, webhooks commands, preflight scopes
scripts/setup/steps.mjs                   modify: oauth, dev-app, webhooks steps
docs/shopify-api-gotchas.md               modify
.claude/skills/shopify-store-setup/SKILL.md   modify
README.md                                 modify: webhook secret is required
```

---

### Task 1: Mint the Admin token

**Files:**
- Create: `scripts/shopify/token.mjs`, `scripts/shopify/token.test.mjs`
- Modify (full replacement): `scripts/shopify/admin-client.mjs`; modify `scripts/shopify/admin-client.test.mjs`, `scripts/shopify/introspect.mjs`

**Interfaces:**
- Produces: `mintAdminToken({ domain, clientId, clientSecret, fetchFn? }): Promise<{ token, scope, expiresIn }>`, `explainTokenError(status, body): string`, `resolveAdminToken(): Promise<{ token: string; source: "SHOPIFY_ADMIN_TOKEN" | "client credentials" }>`, `resetTokenCache(): void`, `allScopes(): string[]`, and `SCOPES.catalogue`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/shopify/token.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mintAdminToken, explainTokenError } from "./token.mjs";

const creds = { domain: "shop.myshopify.com", clientId: "id", clientSecret: "secret" };

test("posts the client credentials grant, form-encoded, to the store's token endpoint", async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ access_token: "shpat_abc", scope: "write_products", expires_in: 86399 }), { status: 200 });
  };
  const minted = await mintAdminToken({ ...creds, fetchFn });
  assert.equal(seen.url, "https://shop.myshopify.com/admin/oauth/access_token");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen.init.body)), { grant_type: "client_credentials", client_id: "id", client_secret: "secret" });
  assert.deepEqual(minted, { token: "shpat_abc", scope: "write_products", expiresIn: 86399 });
});

test("a refusal explains the same-organization rule and names the fallback", async () => {
  const fetchFn = async () => new Response('{"error":"shop_not_permitted"}', { status: 400 });
  await assert.rejects(mintAdminToken({ ...creds, fetchFn }), (error) => {
    assert.match(error.message, /HTTP 400/);
    assert.match(error.message, /same Shopify organization/);
    assert.match(error.message, /pnpm shop-setup oauth/);
    return true;
  });
});

test("explainTokenError never prints more than a short slice of the body", () => {
  assert.ok(explainTokenError(500, "x".repeat(5000)).length < 900);
});
```

Append to `scripts/shopify/admin-client.test.mjs`:

```js
import { mock, beforeEach, afterEach } from "node:test";
import { allScopes, resolveAdminToken, resetTokenCache } from "./admin-client.mjs";

const clearEnv = () => {
  for (const key of ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_APP_CLIENT_ID", "SHOPIFY_APP_CLIENT_SECRET"]) delete process.env[key];
};
beforeEach(() => {
  clearEnv();
  resetTokenCache();
  process.env.SHOPIFY_STORE_DOMAIN = "tok-test";
});
afterEach(() => {
  clearEnv();
  mock.restoreAll();
});

test("allScopes covers shipping, policies and the catalogue push", () => {
  const all = allScopes();
  for (const scope of ["write_shipping", "write_legal_policies", "write_products", "write_publications", "write_inventory", "read_locations"]) {
    assert.ok(all.includes(scope), `${scope} missing`);
  }
});

test("an explicit SHOPIFY_ADMIN_TOKEN wins and nothing is minted", async () => {
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_explicit";
  process.env.SHOPIFY_APP_CLIENT_ID = "id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "secret";
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call the network");
  });
  assert.deepEqual(await resolveAdminToken(), { token: "shpat_explicit", source: "SHOPIFY_ADMIN_TOKEN" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("without a token it mints one from the client credentials, once, and reuses it", async () => {
  process.env.SHOPIFY_APP_CLIENT_ID = "id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "secret";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ access_token: "shpat_minted", scope: "x", expires_in: 86399 }), { status: 200 }));
  assert.deepEqual(await resolveAdminToken(), { token: "shpat_minted", source: "client credentials" });
  assert.deepEqual(await resolveAdminToken(), { token: "shpat_minted", source: "client credentials" });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("a token about to expire is minted again", async () => {
  process.env.SHOPIFY_APP_CLIENT_ID = "id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "secret";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ access_token: "shpat_short", scope: "x", expires_in: 30 }), { status: 200 }));
  await resolveAdminToken();
  await resolveAdminToken();
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("with no token and no client credentials it stops with a readable message", async () => {
  mock.method(console, "error", () => {});
  mock.method(process, "exit", (code) => {
    throw new Error(`exit ${code}`);
  });
  await assert.rejects(resolveAdminToken(), /exit 1/);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm test:scripts`
Expected: FAIL (`Cannot find module './token.mjs'`; `resolveAdminToken` is not exported).

- [ ] **Step 3: Implement the minter**

```js
// scripts/shopify/token.mjs
/**
 * Client credentials grant: the app exchanges its own client id and secret for
 * an Admin API token. No redirect, no click. Only works when the app and the
 * store are in the SAME Shopify organization and the app is installed on the
 * store (shopify.dev, checked 2026-10-04). Tokens last 24 hours.
 */
export function explainTokenError(status, body) {
  return (
    `client credentials grant failed (HTTP ${status}): ${String(body).slice(0, 300)}\n` +
    "  This grant only works when the app is installed on the store AND the store is in the same Shopify organization as the app\n" +
    "  (a dev store created in the Dev Dashboard is; a client's own store is not). Otherwise run: pnpm shop-setup oauth"
  );
}

export async function mintAdminToken({ domain, clientId, clientSecret, fetchFn = fetch }) {
  const response = await fetchFn(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(explainTokenError(response.status, text));
  const json = JSON.parse(text);
  return { token: json.access_token, scope: json.scope ?? "", expiresIn: json.expires_in ?? null };
}
```

- [ ] **Step 4: Replace `admin-client.mjs`**

```js
// scripts/shopify/admin-client.mjs
/**
 * Shopify Admin GraphQL client for the setup scripts.
 *
 * - Resolves its own token: an explicit SHOPIFY_ADMIN_TOKEN wins, otherwise it
 *   mints one with the client credentials grant and keeps it in memory only.
 * - Surfaces `userErrors`: Shopify returns most write failures as HTTP 200 with a
 *   populated userErrors array, so a status-only check reports success on a
 *   failed write.
 * - Backs off before the leaky bucket runs dry and retries THROTTLED / 429 / 5xx.
 */
import { shopifyEnv } from "./env.mjs";
import { mintAdminToken } from "./token.mjs";

/** Scopes per capability, so preflight and the app setup ask for exactly what the steps need. */
export const SCOPES = {
  shipping: ["write_shipping", "read_locations"],
  policies: ["write_legal_policies"],
  catalogue: ["write_products", "write_publications", "write_inventory", "write_files", "read_locations"],
};

export const allScopes = () => [...new Set(Object.values(SCOPES).flat())];

export function adminConfig() {
  const env = shopifyEnv();
  if (!env.domain) {
    console.error("\n  SHOPIFY_STORE_DOMAIN is missing from .env.local\n");
    process.exit(1);
  }
  return env;
}

let cached = null; // { token, expiresAt }
export const resetTokenCache = () => {
  cached = null;
};

/** An explicit SHOPIFY_ADMIN_TOKEN wins; otherwise mint one (24 h, memory only, refreshed a minute early). */
export async function resolveAdminToken() {
  const env = adminConfig();
  if (env.adminToken) return { token: env.adminToken, source: "SHOPIFY_ADMIN_TOKEN" };
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.token, source: "client credentials" };
  if (env.clientId && env.clientSecret) {
    const minted = await mintAdminToken({ domain: env.domain, clientId: env.clientId, clientSecret: env.clientSecret });
    cached = { token: minted.token, expiresAt: Date.now() + (minted.expiresIn ?? 86_399) * 1000 };
    return { token: minted.token, source: "client credentials" };
  }
  console.error("\n  No Admin token. Put SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET in .env.local and run: pnpm shop-setup token\n  (for a store outside the app's organization: pnpm shop-setup oauth)\n");
  process.exit(1);
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

let served = null;
/** The API version Shopify actually used for the most recent Admin call. */
export const servedVersion = () => served;

export async function adminGraphQL(query, variables = {}, attempt = 0) {
  const { domain, apiVersion } = adminConfig();
  const { token } = await resolveAdminToken();
  const response = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  served = response.headers.get("x-shopify-api-version") ?? served;

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
  const { domain } = adminConfig();
  const { token } = await resolveAdminToken();
  const response = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!response.ok) throw new Error(`access_scopes HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).access_scopes.map((scope) => scope.handle);
}

export const PUBLICATIONS_QUERY = `query { publications(first: 25) { nodes { id name } } }`;

/** Every sales channel the store can publish to, including Headless. */
export async function publicationInputs() {
  const nodes = (await adminGraphQL(PUBLICATIONS_QUERY)).publications.nodes;
  return { nodes, input: nodes.map((publication) => ({ publicationId: publication.id })) };
}
```

In `scripts/shopify/introspect.mjs` replace the lines

```js
const cfg = adminConfig();
console.log(`${type.name} (${type.kind})  api ${cfg.apiVersion}  token ${mask(cfg.adminToken)}`);
```

with

```js
const cfg = adminConfig();
const { token, source } = await resolveAdminToken();
console.log(`${type.name} (${type.kind})  api ${cfg.apiVersion}  token ${mask(token)} (${source})`);
```

and change its import to `import { adminGraphQL, adminConfig, resolveAdminToken } from "./admin-client.mjs";`.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm test:scripts && node --check scripts/shopify/introspect.mjs`
Expected: all pass, including the existing flow tests (they set `SHOPIFY_ADMIN_TOKEN`).

- [ ] **Step 6: Commit**

```bash
git add scripts/shopify
git commit -m "feat(setup): mint the Admin token with the client credentials grant when no token is set"
```

---

### Task 2: OAuth fallback, with the checks the old script skipped

**Files:**
- Create: `scripts/shopify/oauth.mjs`
- Test: `scripts/shopify/oauth.test.mjs`

**Interfaces:**
- Produces: `REDIRECT_PORT`, `SHOP_PATTERN`, `redirectUri(port?)`, `buildAuthorizeUrl({ domain, clientId, scopes, redirect, state })`, `computeHmac(params: URLSearchParams, secret): string` (hex), `verifyCallback({ query, state, clientSecret, domain }): { ok: true, code } | { ok: false, problem }`, `runOAuth({ domain, clientId, clientSecret, scopes, port?, fetchFn?, save, onReady?, timeoutMs? }): Promise<{ token, scope, expiresIn }>`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/shopify/oauth.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizeUrl, computeHmac, verifyCallback, redirectUri, runOAuth, SHOP_PATTERN } from "./oauth.mjs";

const secret = "client-secret";
const domain = "shop.myshopify.com";
const signed = (fields) => {
  const params = new URLSearchParams(fields);
  params.set("hmac", computeHmac(params, secret));
  return params;
};

test("the authorize URL carries client id, scopes, redirect and state", () => {
  const url = new URL(buildAuthorizeUrl({ domain, clientId: "id", scopes: ["write_products", "read_locations"], redirect: redirectUri(3456), state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://shop.myshopify.com/admin/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "write_products,read_locations");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3456/callback");
  assert.equal(url.searchParams.get("state"), "s1");
});

test("the hmac ignores the hmac field and the order of the others", () => {
  const a = computeHmac(new URLSearchParams("b=2&a=1&hmac=zzz"), secret);
  const b = computeHmac(new URLSearchParams("a=1&b=2"), secret);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("a correct callback is accepted and yields the code", () => {
  const query = signed({ code: "c1", shop: domain, state: "s1", timestamp: "1", host: "aG9zdA==" });
  assert.deepEqual(verifyCallback({ query, state: "s1", clientSecret: secret, domain }), { ok: true, code: "c1" });
});

test("a wrong state, a tampered hmac, a foreign shop or a missing code are each refused", () => {
  const good = { code: "c1", shop: domain, state: "s1", timestamp: "1" };
  const refuse = (query, why) => {
    const r = verifyCallback({ query, state: "s1", clientSecret: secret, domain });
    assert.equal(r.ok, false, why);
    return r.problem;
  };
  assert.match(refuse(signed({ ...good, state: "other" }), "state"), /state/);
  const tampered = signed(good);
  tampered.set("code", "evil");
  assert.match(refuse(tampered, "hmac"), /hmac/i);
  assert.match(refuse(signed({ ...good, shop: "evil.myshopify.com" }), "shop"), /shop/);
  const noCode = signed({ shop: domain, state: "s1", timestamp: "1" });
  assert.match(refuse(noCode, "code"), /code/);
});

test("the shop pattern is anchored so a lookalike domain cannot pass", () => {
  assert.ok(SHOP_PATTERN.test("my-shop.myshopify.com"));
  assert.ok(!SHOP_PATTERN.test("my-shop.myshopify.com.evil.com"));
  assert.ok(!SHOP_PATTERN.test("evil.com/my-shop.myshopify.com"));
});

/** Plays the part of the browser: waits for the server to be ready, then calls back. */
function run({ callback, exchange, timeoutMs = 5000 }) {
  const saved = [];
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const promise = runOAuth({
    domain,
    clientId: "id",
    clientSecret: secret,
    scopes: ["write_products"],
    port: 0,
    timeoutMs,
    fetchFn: exchange,
    save: (key, value) => saved.push([key, value]),
    onReady: resolveReady,
  });
  const browser = ready.then(async ({ redirect, authorizeUrl }) => {
    const state = new URL(authorizeUrl).searchParams.get("state");
    const target = new URL(redirect.replace("localhost", "127.0.0.1"));
    for (const [k, v] of callback(state)) target.searchParams.set(k, v);
    await fetch(target);
  });
  return { promise, browser, saved };
}

const okExchange = async () => new Response(JSON.stringify({ access_token: "shpat_oauth", scope: "write_products" }), { status: 200 });

test("a good callback exchanges the code and saves the token", async () => {
  const { promise, browser, saved } = run({
    exchange: okExchange,
    callback: (state) => signed({ code: "c1", shop: domain, state, timestamp: "1" }).entries(),
  });
  const result = await promise;
  await browser;
  assert.deepEqual(result, { token: "shpat_oauth", scope: "write_products", expiresIn: null });
  assert.deepEqual(saved, [["SHOPIFY_ADMIN_TOKEN", "shpat_oauth"]]);
});

test("a forged callback is refused and nothing is exchanged or saved", async () => {
  let exchanged = false;
  const { promise, browser, saved } = run({
    exchange: async () => {
      exchanged = true;
      return okExchange();
    },
    callback: (state) => new URLSearchParams({ code: "c1", shop: domain, state, timestamp: "1", hmac: "0".repeat(64) }).entries(),
  });
  await assert.rejects(promise, /hmac/i);
  await browser;
  assert.equal(exchanged, false);
  assert.deepEqual(saved, []);
});

test("Shopify refusing the exchange is reported with its status", async () => {
  const { promise, browser } = run({
    exchange: async () => new Response("bad code", { status: 400 }),
    callback: (state) => signed({ code: "c1", shop: domain, state, timestamp: "1" }).entries(),
  });
  await assert.rejects(promise, /HTTP 400/);
  await browser;
});

test("an expiring token is reported so the caller can warn", async () => {
  const { promise, browser } = run({
    exchange: async () => new Response(JSON.stringify({ access_token: "shpat_x", scope: "s", expires_in: 3600 }), { status: 200 }),
    callback: (state) => signed({ code: "c1", shop: domain, state, timestamp: "1" }).entries(),
  });
  assert.equal((await promise).expiresIn, 3600);
  await browser;
});

test("nobody clicking Install ends in a timeout, not a hang", async () => {
  const { promise } = run({ exchange: okExchange, callback: () => [], timeoutMs: 50 });
  await assert.rejects(promise, /timed out/);
});
```

Note the last test's `browser` promise is intentionally not awaited: with an empty callback the "browser" still calls the redirect without a state, which the server may already have closed; the unhandled fetch error is harmless and is silenced by the test finishing first. If it proves flaky, call `run(...).browser.catch(() => {})`.

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './oauth.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```js
// scripts/shopify/oauth.mjs
/**
 * Authorization-code grant, for stores OUTSIDE the app's Shopify organization
 * (the client credentials grant covers the rest). Runs a one-shot localhost
 * server for the redirect and checks everything Shopify tells us to check:
 * state, the shop hostname, and the callback HMAC.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const REDIRECT_PORT = 3456; // must match the redirect URL registered on the app
export const SHOP_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
export const redirectUri = (port = REDIRECT_PORT) => `http://localhost:${port}/callback`;

export function buildAuthorizeUrl({ domain, clientId, scopes, redirect, state }) {
  const query = new URLSearchParams({ client_id: clientId, scope: scopes.join(","), redirect_uri: redirect, state });
  return `https://${domain}/admin/oauth/authorize?${query}`;
}

/** HMAC-SHA256 (hex) over the query without `hmac`, sorted, joined `k=v&k=v`, keyed with the client secret. */
export function computeHmac(params, secret) {
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function verifyCallback({ query, state, clientSecret, domain }) {
  if (query.get("state") !== state) return { ok: false, problem: "state mismatch. Re-run the command and use the fresh URL." };
  const shop = query.get("shop") ?? "";
  if (!SHOP_PATTERN.test(shop) || shop !== domain) return { ok: false, problem: `shop "${shop}" is not the store being set up (${domain}).` };
  const given = Buffer.from(query.get("hmac") ?? "");
  const expected = Buffer.from(computeHmac(query, clientSecret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, problem: "hmac check failed: the callback was not signed with this app's client secret." };
  }
  const code = query.get("code");
  if (!code) return { ok: false, problem: `no code in the callback: ${[...query.keys()].join(", ")}` };
  return { ok: true, code };
}

const page = (title, body) => `<body style="font:16px system-ui;padding:3rem;max-width:34rem"><h2>${title}</h2><p>${body}</p></body>`;

export function runOAuth({ domain, clientId, clientSecret, scopes, port = REDIRECT_PORT, fetchFn = fetch, save, onReady = () => {}, timeoutMs = 600_000 }) {
  return new Promise((resolve, reject) => {
    const state = randomBytes(16).toString("hex");
    let timer;
    let server;

    const stop = () => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
    };
    const respond = (res, status, title, body, settle) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(page(title, body), () => {
        stop();
        settle();
      });
    };

    server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/callback") return void res.writeHead(404).end("not found");

      const check = verifyCallback({ query: url.searchParams, state, clientSecret, domain });
      if (!check.ok) return respond(res, 400, "Failed", check.problem, () => reject(new Error(check.problem)));

      try {
        const exchange = await fetchFn(`https://${domain}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: check.code }).toString(),
        });
        const text = await exchange.text();
        if (!exchange.ok) throw new Error(`token exchange HTTP ${exchange.status}: ${text.slice(0, 300)}`);
        const json = JSON.parse(text);
        save("SHOPIFY_ADMIN_TOKEN", json.access_token);
        respond(res, 200, "Token saved", "Written to .env.local. Close this tab.", () =>
          resolve({ token: json.access_token, scope: json.scope ?? "", expiresIn: json.expires_in ?? null }),
        );
      } catch (error) {
        respond(res, 500, "Failed", String(error.message ?? error), () => reject(error));
      }
    });

    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(port, () => {
      const redirect = redirectUri(server.address().port);
      timer = setTimeout(() => {
        stop();
        reject(new Error("timed out waiting for the Install click"));
      }, timeoutMs);
      onReady({ redirect, authorizeUrl: buildAuthorizeUrl({ domain, clientId, scopes, redirect, state }) });
    });
  });
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test:scripts`
Expected: PASS. If the timeout test leaves an unhandled rejection, apply the note in Step 1.

- [ ] **Step 5: Commit**

```bash
git add scripts/shopify/oauth.mjs scripts/shopify/oauth.test.mjs
git commit -m "feat(setup): OAuth fallback that verifies state, shop and callback hmac"
```

---

### Task 3: Webhook registration

**Files:**
- Create: `scripts/shopify/webhooks.mjs`
- Test: `scripts/shopify/webhooks.test.mjs`

**Interfaces:**
- Consumes: `adminGraphQL` (Task 1).
- Produces: `WEBHOOK_PATH` (`/api/revalidate`), `TOPICS`, `planWebhooks(existing, siteUrl, topics?): { callbackUrl, remove: {id, topic, url}[], keep: string[], create: string[] }`, `webhookSecretStatus({ clientSecret, webhookSecret }): { ok, note }`, `listWebhooks(): Promise<node[]>`, `registerWebhooks({ siteUrl, dryRun? }): Promise<plan>`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/shopify/webhooks.test.mjs
import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { planWebhooks, webhookSecretStatus, registerWebhooks, TOPICS, WEBHOOK_PATH } from "./webhooks.mjs";

const node = (id, topic, callbackUrl) => ({ id, topic, endpoint: { callbackUrl } });
const site = "https://shop.example.gr";
const target = `${site}${WEBHOOK_PATH}`;

test("the target is the SDK's revalidate route", () => {
  assert.equal(WEBHOOK_PATH, "/api/revalidate");
  assert.equal(planWebhooks([], `${site}/`).callbackUrl, target);
});

test("with nothing registered every topic is created", () => {
  const plan = planWebhooks([], site);
  assert.deepEqual(plan.create, TOPICS);
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.remove, []);
});

test("topics already pointing at the target are kept, the rest created", () => {
  const plan = planWebhooks([node("1", "PRODUCTS_CREATE", target)], site);
  assert.deepEqual(plan.keep, ["PRODUCTS_CREATE"]);
  assert.ok(!plan.create.includes("PRODUCTS_CREATE"));
  assert.equal(plan.create.length, TOPICS.length - 1);
});

test("a subscription for this route at an old URL is removed, so a stale staging site stops being called", () => {
  const plan = planWebhooks([node("9", "PRODUCTS_UPDATE", `https://old.example.gr${WEBHOOK_PATH}`)], site);
  assert.deepEqual(plan.remove, [{ id: "9", topic: "PRODUCTS_UPDATE", url: `https://old.example.gr${WEBHOOK_PATH}` }]);
  assert.ok(plan.create.includes("PRODUCTS_UPDATE"));
});

test("webhooks for other routes are left alone", () => {
  const plan = planWebhooks([node("5", "ORDERS_PAID", "https://invoices.example.com/hook")], site);
  assert.deepEqual(plan.remove, []);
});

test("the secret must be the app client secret, and each failure says what to do", () => {
  assert.equal(webhookSecretStatus({ clientSecret: "a", webhookSecret: "a" }).ok, true);
  assert.match(webhookSecretStatus({ clientSecret: "a", webhookSecret: "b" }).note, /differs/);
  assert.match(webhookSecretStatus({ clientSecret: "a", webhookSecret: "" }).note, /refuses every request/);
  assert.equal(webhookSecretStatus({ clientSecret: "", webhookSecret: "a" }).ok, false);
});

function fakeShopify(existing) {
  const calls = [];
  const reply = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  const handler = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    if (/webhookSubscriptions\(/.test(query)) return reply({ webhookSubscriptions: { nodes: existing } });
    if (/webhookSubscriptionCreate/.test(query)) return reply({ webhookSubscriptionCreate: { webhookSubscription: { id: "gid://new" }, userErrors: [] } });
    if (/webhookSubscriptionDelete/.test(query)) return reply({ webhookSubscriptionDelete: { userErrors: [] } });
    throw new Error("unexpected query");
  };
  return { handler, calls };
}
const count = (calls, pattern) => calls.filter((c) => pattern.test(c.query)).length;

beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "hook-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_hooktest";
});
afterEach(() => {
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  mock.restoreAll();
});

test("registering creates the missing topics with the JSON format and the target URL", async () => {
  const shop = fakeShopify([node("1", "PRODUCTS_CREATE", target)]);
  mock.method(globalThis, "fetch", shop.handler);
  await registerWebhooks({ siteUrl: site });
  const creates = shop.calls.filter((c) => /webhookSubscriptionCreate/.test(c.query));
  assert.equal(creates.length, TOPICS.length - 1);
  assert.deepEqual(creates[0].variables.subscription, { callbackUrl: target, format: "JSON" });
  assert.ok(creates.every((c) => c.variables.topic !== "PRODUCTS_CREATE"));
});

test("registering twice changes nothing the second time", async () => {
  const all = TOPICS.map((t, i) => node(String(i), t, target));
  const shop = fakeShopify(all);
  mock.method(globalThis, "fetch", shop.handler);
  await registerWebhooks({ siteUrl: site });
  assert.equal(count(shop.calls, /webhookSubscriptionCreate/), 0);
  assert.equal(count(shop.calls, /webhookSubscriptionDelete/), 0);
});

test("a dry run reads but writes nothing", async () => {
  const shop = fakeShopify([]);
  mock.method(globalThis, "fetch", shop.handler);
  const plan = await registerWebhooks({ siteUrl: site, dryRun: true });
  assert.equal(plan.create.length, TOPICS.length);
  assert.equal(count(shop.calls, /webhookSubscriptionCreate/), 0);
});

test("stale subscriptions are deleted before new ones are created", async () => {
  const shop = fakeShopify([node("9", "PRODUCTS_UPDATE", `https://old.example.gr${WEBHOOK_PATH}`)]);
  mock.method(globalThis, "fetch", shop.handler);
  await registerWebhooks({ siteUrl: site });
  const order = shop.calls.map((c) => (/Delete/.test(c.query) ? "delete" : /Create/.test(c.query) ? "create" : "list"));
  assert.ok(order.indexOf("delete") < order.indexOf("create"));
});

test("a non-https or missing URL is refused before any call", async () => {
  const shop = fakeShopify([]);
  mock.method(globalThis, "fetch", shop.handler);
  await assert.rejects(registerWebhooks({ siteUrl: "http://localhost:3000" }), /public https/);
  await assert.rejects(registerWebhooks({ siteUrl: "" }), /public https/);
  assert.equal(shop.calls.length, 0);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './webhooks.mjs'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```js
// scripts/shopify/webhooks.mjs
/**
 * Registers the cache-invalidation webhooks against the SDK's /api/revalidate.
 *
 * Subscriptions created through the Admin API are signed with the app's CLIENT
 * SECRET (shopify.dev, checked 2026-10-04), so SHOPIFY_WEBHOOK_SECRET must equal
 * SHOPIFY_APP_CLIENT_SECRET, locally and on the host. Shopify allows 5 seconds
 * per delivery and deletes a subscription after 8 failed retries, so a wrong
 * secret quietly stops the site from ever refreshing.
 */
import { adminGraphQL } from "./admin-client.mjs";

export const WEBHOOK_PATH = "/api/revalidate";
export const TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "COLLECTIONS_CREATE",
  "COLLECTIONS_UPDATE",
  "COLLECTIONS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
];

const LIST = `query { webhookSubscriptions(first: 100) { nodes { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }`;
const CREATE = `mutation($topic: WebhookSubscriptionTopic!, $subscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) { webhookSubscription { id } userErrors { field message } } }`;
const DELETE = `mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { field message } } }`;

export function planWebhooks(existing, siteUrl, topics = TOPICS) {
  const callbackUrl = `${siteUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
  const url = (n) => n.endpoint?.callbackUrl;
  const remove = existing
    .filter((n) => url(n)?.endsWith(WEBHOOK_PATH) && url(n) !== callbackUrl)
    .map((n) => ({ id: n.id, topic: n.topic, url: url(n) }));
  const present = new Set(existing.filter((n) => url(n) === callbackUrl).map((n) => n.topic));
  return { callbackUrl, remove, keep: topics.filter((t) => present.has(t)), create: topics.filter((t) => !present.has(t)) };
}

export function webhookSecretStatus({ clientSecret, webhookSecret }) {
  if (!clientSecret) return { ok: false, note: "SHOPIFY_APP_CLIENT_SECRET is not set, so the secret to use cannot be checked." };
  if (!webhookSecret) {
    return { ok: false, note: "SHOPIFY_WEBHOOK_SECRET is not set. Webhooks created by the app are signed with the app client secret: set it to that value locally and on the host. /api/revalidate refuses every request until it is set." };
  }
  if (webhookSecret !== clientSecret) {
    return { ok: false, note: "SHOPIFY_WEBHOOK_SECRET differs from SHOPIFY_APP_CLIENT_SECRET. Webhooks created by the app are signed with the client secret, so every delivery would be a 401. Set them equal, locally and on the host, then redeploy." };
  }
  return { ok: true, note: "SHOPIFY_WEBHOOK_SECRET matches the app client secret." };
}

export async function listWebhooks() {
  return (await adminGraphQL(LIST)).webhookSubscriptions.nodes;
}

export async function registerWebhooks({ siteUrl, dryRun = false }) {
  if (!/^https:\/\/[^/]+/.test(siteUrl ?? "")) {
    throw new Error("a public https URL is required (SITE_URL or --url=https://...). Shopify will not deliver to http:// or localhost; do this after the first deploy.");
  }
  const plan = planWebhooks(await listWebhooks(), siteUrl);
  if (dryRun) return plan;
  for (const stale of plan.remove) await adminGraphQL(DELETE, { id: stale.id });
  for (const topic of plan.create) await adminGraphQL(CREATE, { topic, subscription: { callbackUrl: plan.callbackUrl, format: "JSON" } });
  return plan;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test:scripts`

- [ ] **Step 5: Commit**

```bash
git add scripts/shopify/webhooks.mjs scripts/shopify/webhooks.test.mjs
git commit -m "feat(setup): register the revalidation webhooks and check the signing secret"
```

---

### Task 4: The webhook route fails closed

**Files:**
- Create: `src/lib/shopify/webhook.ts`
- Test: `scripts/shopify/webhook-verify.test.mjs`
- Modify: `src/app/api/revalidate/route.ts`, `README.md`

**Interfaces:**
- Produces: `verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, secret: string | undefined): { ok: true } | { ok: false; status: number; reason: string }`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/shopify/webhook-verify.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyShopifyWebhook } from "../../src/lib/shopify/webhook.ts";

const secret = "client-secret";
const body = JSON.stringify({ id: 1, handle: "milano-sofa" });
const sign = (b, s = secret) => createHmac("sha256", s).update(b, "utf8").digest("base64");

test("a correctly signed body is accepted", () => {
  assert.deepEqual(verifyShopifyWebhook(body, sign(body), secret), { ok: true });
});

test("no secret configured refuses everything with 503 instead of accepting unsigned requests", () => {
  const r = verifyShopifyWebhook(body, sign(body), undefined);
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.match(r.reason, /SHOPIFY_WEBHOOK_SECRET/);
  assert.equal(verifyShopifyWebhook(body, null, "").status, 503);
});

test("a missing signature header is a 401", () => {
  assert.equal(verifyShopifyWebhook(body, null, secret).status, 401);
});

test("a body changed after signing, or signed with another secret, is a 401", () => {
  assert.equal(verifyShopifyWebhook(body + " ", sign(body), secret).status, 401);
  assert.equal(verifyShopifyWebhook(body, sign(body, "other"), secret).status, 401);
});

test("a signature of the wrong length does not throw", () => {
  assert.equal(verifyShopifyWebhook(body, "short", secret).status, 401);
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '.../webhook.ts'`)

Run: `pnpm test:scripts`

- [ ] **Step 3: Implement**

```ts
// src/lib/shopify/webhook.ts
import crypto from "node:crypto";

export type WebhookCheck = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Verifies Shopify's X-Shopify-Hmac-SHA256 header (base64 HMAC-SHA256 of the raw
 * body, keyed with the app client secret). Fails CLOSED: with no secret
 * configured it refuses, because accepting unsigned requests lets anyone who
 * finds the URL force cache purges.
 */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, secret: string | undefined): WebhookCheck {
  if (!secret) return { ok: false, status: 503, reason: "SHOPIFY_WEBHOOK_SECRET is not set; refusing unsigned webhooks" };
  if (!hmacHeader) return { ok: false, status: 401, reason: "Missing x-shopify-hmac-sha256 header" };

  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"));
  const given = Buffer.from(hmacHeader);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, status: 401, reason: "Invalid HMAC signature" };
  }
  return { ok: true };
}
```

In `src/app/api/revalidate/route.ts` replace the whole block from `// 1. Verify HMAC if secret is configured` through its closing brace (the `if (shopifyConfig.webhookSecret) { ... }`) with:

```ts
    // 1. Verify the signature. Fails closed: no secret means no webhooks accepted.
    const check = verifyShopifyWebhook(rawBody, hmacHeader, shopifyConfig.webhookSecret);
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: check.status });
    }
```

and add `import { verifyShopifyWebhook } from "@/lib/shopify/webhook";` next to the existing imports; remove the now-unused `import crypto from "crypto";`.

In `README.md` change the line `# Optional: Webhook secret for HMAC cache revalidation` to `# Required for /api/revalidate: webhook secret (the app client secret when webhooks are created through the Admin API)`.

- [ ] **Step 4: Run, expect PASS, and type-check**

Run: `pnpm test:scripts && pnpm exec tsc --noEmit && pnpm lint`
Expected: all pass; 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add src scripts/shopify/webhook-verify.test.mjs README.md
git commit -m "fix(security): /api/revalidate refuses unsigned webhooks when no secret is set"
```

---

### Task 5: CLI, registry, runbook and docs

**Files:**
- Modify: `scripts/setup/cli.mjs`, `scripts/setup/steps.mjs`, `scripts/setup/steps.test.mjs`, `docs/shopify-api-gotchas.md`, `.claude/skills/shopify-store-setup/SKILL.md`

**Interfaces:**
- Produces: `pnpm shop-setup token | oauth | webhooks [--list] [--dry-run] [--url=https://...]`; preflight checks `allScopes()`.

- [ ] **Step 1: Write the failing registry test**

Append to `scripts/setup/steps.test.mjs`:

```js
test("the admin connection steps name the commands, and the scopes cover every step that writes", () => {
  assert.match(byId.oauth.instructions, /pnpm shop-setup token/);
  assert.match(byId.oauth.instructions, /pnpm shop-setup oauth/);
  assert.equal(byId.webhooks.automation, "webhooks");
  assert.match(byId.webhooks.instructions, /pnpm shop-setup webhooks/);
  for (const scope of ["write_shipping", "write_legal_policies", "write_products", "write_publications", "write_inventory", "read_locations"]) {
    assert.match(byId["dev-app"].instructions, new RegExp(scope), `dev-app must list ${scope}`);
  }
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm test:scripts`

- [ ] **Step 3: Update the registry**

In `scripts/setup/steps.mjs`, replace the `dev-app`, `oauth` and `webhooks` steps:

```js
  {
    id: "dev-app",
    title: "Create the Dev Dashboard app with the Admin scopes and install it",
    owner: "browser",
    needs: ["store-basics"],
    instructions: `Settings > Apps and sales channels > Develop apps > Build apps in Dev Dashboard. Scopes: write_shipping, read_locations, write_legal_policies, write_products, write_publications, write_inventory, write_files. Redirect URL exactly http://localhost:3456/callback (only needed for the OAuth fallback). Release a new app version, then install the app on the store from the Dev Dashboard (use its Install button; the exact clicks were not in Shopify's docs, so say what you see). Read Client ID and Client secret into .env.local (SHOPIFY_APP_CLIENT_ID, SHOPIFY_APP_CLIENT_SECRET). ${FALLBACK}`,
  },
  {
    id: "oauth",
    title: "Get the Admin token (the agent mints it, or one Install click)",
    owner: "human",
    needs: ["dev-app"],
    instructions:
      "Do not ask the human yet. First run: pnpm shop-setup token. If it prints a working token (client credentials grant: works when the store is in the same Shopify organization as the app, such as a dev store made in the Dev Dashboard), mark this step done with the note \"n/a: client credentials worked\". If it fails, run pnpm shop-setup oauth: it prints a URL, and the person opens it while logged into the store and clicks Install. That writes SHOPIFY_ADMIN_TOKEN to .env.local.",
    automation: "token",
  },
```

and the `webhooks` step:

```js
  {
    id: "webhooks",
    title: "Register cache-invalidation webhooks",
    owner: "api",
    needs: ["preflight", "hosting"],
    instructions:
      "Needs the public https SITE_URL from the hosting step. Run pnpm shop-setup webhooks --dry-run, show the plan, then pnpm shop-setup webhooks. Set SHOPIFY_WEBHOOK_SECRET to the app client secret locally and on the host (webhooks created by the app are signed with it) and redeploy. Prove it: change a product title in the Admin and reload the product page; it changes at once when the webhook works. /api/revalidate refuses every request while the secret is unset.",
    automation: "webhooks",
  },
```

(Keep each step in its current position in the list.)

- [ ] **Step 4: Add the CLI commands**

In `scripts/setup/cli.mjs` add imports `mask` (already from env.mjs if present), `resolveAdminToken` and `allScopes` from `../shopify/admin-client.mjs`, `{ REDIRECT_PORT, runOAuth, redirectUri }` from `../shopify/oauth.mjs`, `{ listWebhooks, registerWebhooks, webhookSecretStatus }` from `../shopify/webhooks.mjs`, and `upsertEnv` from `../shopify/env.mjs`. In the `preflight` case change `const required = [...new Set([...SCOPES.shipping, ...SCOPES.policies])];` to `const required = allScopes();`. Add before `case "validate-queries"`:

```js
  case "token": {
    const env = shopifyEnv();
    if (!env.domain) {
      bad("SHOPIFY_STORE_DOMAIN is missing from .env.local");
      process.exit(1);
    }
    let resolved;
    try {
      resolved = await resolveAdminToken();
    } catch (error) {
      bad(String(error.message ?? error));
      process.exit(1);
    }
    const granted = await grantedScopes();
    ok(`Admin token works: ${mask(resolved.token)} from ${resolved.source}`);
    info(`scopes: ${granted.join(", ")}`);
    if (resolved.source === "client credentials") info("minted for this run only (valid 24 hours), never written to disk");
    break;
  }
  case "oauth": {
    const env = shopifyEnv();
    if (!env.domain || !env.clientId || !env.clientSecret) {
      bad("needs SHOPIFY_STORE_DOMAIN, SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET in .env.local");
      process.exit(1);
    }
    try {
      const result = await runOAuth({
        domain: env.domain,
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        scopes: allScopes(),
        save: upsertEnv,
        onReady: ({ authorizeUrl }) => {
          info(`Listening on ${redirectUri(REDIRECT_PORT)}. Confirm that exact URL is an allowed redirection URL on the app.`);
          info("Give the person this URL to open while logged into the store, then they click Install:");
          console.log(`\n${authorizeUrl}\n`);
        },
      });
      ok(`token saved to .env.local: ${mask(result.token)}`);
      info(`granted: ${result.scope}`);
      if (result.expiresIn) warn(`this token expires in ${result.expiresIn} seconds: it will stop working. Re-run when it does.`);
    } catch (error) {
      bad(String(error.message ?? error));
      process.exit(1);
    }
    break;
  }
  case "webhooks": {
    const env = shopifyEnv();
    if (flags.list) {
      const nodes = await listWebhooks();
      info(`${nodes.length} registered`);
      nodes.forEach((n) => info(`${n.topic.padEnd(24)} ${n.endpoint?.callbackUrl ?? "(not http)"}`));
      break;
    }
    const siteUrl = typeof flags.url === "string" ? flags.url : env.siteUrl;
    try {
      const plan = await registerWebhooks({ siteUrl, dryRun: flags["dry-run"] === true });
      info(`target ${plan.callbackUrl}`);
      plan.remove.forEach((r) => warn(`remove stale ${r.topic} -> ${r.url}`));
      plan.keep.forEach((t) => info(`= ${t} already registered`));
      plan.create.forEach((t) => ok(`${flags["dry-run"] === true ? "would add" : "added"} ${t}`));
    } catch (error) {
      bad(String(error.message ?? error));
      process.exit(1);
    }
    const secret = webhookSecretStatus({ clientSecret: env.clientSecret, webhookSecret: env.webhookSecret });
    (secret.ok ? ok : bad)(secret.note);
    if (!secret.ok) process.exit(1);
    break;
  }
```

Add the three commands to the usage string.

- [ ] **Step 5: Docs and runbook**

Append to `docs/shopify-api-gotchas.md` under `## Auth`:

```markdown
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
```

and under `## Visibility`:

```markdown
### Every webhook delivery is a 401, or 503
401: `SHOPIFY_WEBHOOK_SECRET` differs from the secret that signed the payload.
Subscriptions created through the Admin API are signed with the app client
secret, so set it equal to `SHOPIFY_APP_CLIENT_SECRET`, on the host too.
503: the secret is not set at all. `/api/revalidate` refuses everything until it
is (it used to accept unsigned requests). Shopify gives 5 seconds per delivery and
deletes a subscription after 8 failed retries, so a site with a wrong secret
quietly stops refreshing: re-run `pnpm shop-setup webhooks`.
```

In `.claude/skills/shopify-store-setup/SKILL.md` add to the `## Rules` list:

```markdown
- Admin token: run `pnpm shop-setup token` before asking the human to click Install. It mints a token itself when the store is in the app's Shopify organization. Only fall back to `pnpm shop-setup oauth` when it fails.
- Never mark `webhooks` done without the change-a-title test, and never leave `SHOPIFY_WEBHOOK_SECRET` unset on the host: the route refuses everything.
```

- [ ] **Step 6: Run, expect PASS and smoke the CLI**

Run: `pnpm test:scripts && pnpm lint`
Run: `pnpm -s shop-setup token; echo "exit=$?"`
Expected: with no `.env.local`, prints `SHOPIFY_STORE_DOMAIN is missing` and exits 1.
Run: `pnpm -s shop-setup webhooks --dry-run; echo "exit=$?"`
Expected: a readable missing-domain message, exit 1, no stack trace.

- [ ] **Step 7: Commit**

```bash
git add scripts docs .claude
git commit -m "feat(setup): token, oauth and webhooks commands, registry wiring, runbook and docs"
```

---

### Task 6: Verification gate

- [ ] **Step 1: Repo gates**

Run: `pnpm test:scripts && pnpm lint && pnpm exec tsc --noEmit && pnpm build`
Expected: all pass.

- [ ] **Step 2: The webhook route for real, locally**

Start the built app with a secret and call the route:

```bash
SHOPIFY_WEBHOOK_SECRET=local-secret pnpm start &    # use the project's usual server tool
BODY='{"id":1,"handle":"milano-sofa"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac local-secret -binary | base64)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/revalidate -H "x-shopify-topic: products/update" -H "x-shopify-hmac-sha256: $SIG" -d "$BODY"        # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/revalidate -H "x-shopify-topic: products/update" -d "$BODY"                                            # 401
```

Then restart WITHOUT the secret and repeat the first call: expect 503. Stop only the server you started.

- [ ] **Step 3: Development-store run (the only proof for the Shopify side)**

Needs a development store created in the Dev Dashboard, an app with the scopes released and installed, and the client id and secret in `.env.local`.

```bash
pnpm shop-setup token        # client credentials: must print scopes and "never written to disk"
pnpm shop-setup preflight
pnpm shop-setup webhooks --dry-run
pnpm shop-setup webhooks     # after the first deploy; then change a product title and reload
pnpm shop-setup webhooks     # second run: nothing changes
```

For a store outside the organization: `pnpm shop-setup oauth`, open the printed URL, click Install, and confirm the token lands in `.env.local`. This settles the hex-hmac and `expires_in` questions.

- [ ] **Step 4: Record the outcome**

State plainly what ran against a real store and what did not. Record any schema or flow surprise in `docs/shopify-api-gotchas.md`.

---

## Follow-on plans (not in this plan)

1. **Metafield and metaobject definitions** (filters, swatches) and the Search & Discovery browser step.
2. **Image rehosting** for sources that block Shopify's fetcher.
3. **Redirect snippet, email templates, click-by-click browser steps.**
4. **Policies** (draft, human approval, `shopPolicyUpdate`).

## Self-review

- **Spec coverage:** token without a click where Shopify allows it (Task 1); fallback with state, shop and hmac checks (2); webhook registration with stale cleanup and secret check (3); fail-closed route (4); CLI, registry, runbook (5); verification including a real local run of the route (6).
- **Placeholders:** none in code steps. Unknowns are named: hex hmac, `expires_in` for own-org auth-code tokens, Dev Dashboard install clicks.
- **Type consistency:** `resolveAdminToken() -> { token, source }`, `mintAdminToken -> { token, scope, expiresIn }`, `runOAuth -> { token, scope, expiresIn }`, `planWebhooks -> { callbackUrl, remove, keep, create }`, `verifyShopifyWebhook -> { ok } | { ok: false, status, reason }` are used with the same names in the tests, implementations and CLI.
