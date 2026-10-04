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
