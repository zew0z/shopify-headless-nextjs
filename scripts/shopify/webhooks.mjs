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
import { shopifyEnv } from "./env.mjs";

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

/** A dry run with no store configured plans as if nothing were registered, and says so with offline: true. */
export async function registerWebhooks({ siteUrl, dryRun = false, env = shopifyEnv() }) {
  if (!/^https:\/\/[^/]+/.test(siteUrl ?? "")) {
    throw new Error("a public https URL is required (SITE_URL or --url=https://...). Shopify will not deliver to http:// or localhost; do this after the first deploy.");
  }
  if (dryRun && !env.domain) return { ...planWebhooks([], siteUrl), offline: true };
  const plan = planWebhooks(await listWebhooks(), siteUrl);
  if (dryRun) return plan;
  for (const stale of plan.remove) await adminGraphQL(DELETE, { id: stale.id });
  for (const topic of plan.create) await adminGraphQL(CREATE, { topic, subscription: { callbackUrl: plan.callbackUrl, format: "JSON" } });
  return plan;
}
