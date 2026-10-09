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
  content: ["write_metaobject_definitions", "write_metaobjects"],
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
