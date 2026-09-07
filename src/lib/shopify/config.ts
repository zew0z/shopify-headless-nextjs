/**
 * Shopify Configuration & Environment Validation Module
 *
 * Provides sanitized environment variables, validation checks,
 * and default settings for the Shopify Storefront API client.
 */

function sanitizeDomain(domain?: string): string {
  if (!domain) return "";
  return domain
    .replace(/^https?:\/\//, "") // Remove protocol if present
    .replace(/\/+$/, "")        // Remove trailing slashes
    .trim();
}

const rawDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
const rawPublicToken = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const rawPrivateToken = process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN;
const rawApiVersion = process.env.SHOPIFY_STOREFRONT_API_VERSION || "2025-01";
const rawWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

export const shopifyConfig = {
  /** myshopify.com domain (e.g. your-store.myshopify.com) */
  domain: sanitizeDomain(rawDomain),

  /** Public Storefront API Access Token (safe for client and server) */
  publicAccessToken: rawPublicToken?.trim() || "",

  /** Private Storefront API Token (recommended for SSR to bypass server IP rate limits) */
  privateAccessToken: rawPrivateToken?.trim() || "",

  /** Shopify GraphQL Storefront API Version (default: 2025-01) */
  apiVersion: rawApiVersion.trim(),

  /** Webhook Secret for HMAC verification of revalidation webhooks */
  webhookSecret: rawWebhookSecret?.trim() || "",

  /** Maximum retries for rate-limited requests (HTTP 429) */
  maxRetries: 3,

  /** Initial delay for exponential backoff in milliseconds */
  retryDelayMs: 500,

  /** Request timeout in milliseconds */
  timeoutMs: 10000,
} as const;

/**
 * Returns true if valid Shopify credentials are configured.
 * If false, the integration falls back gracefully to mock catalog data.
 */
export const isShopifyConfigured = Boolean(
  shopifyConfig.domain &&
  (shopifyConfig.publicAccessToken || shopifyConfig.privateAccessToken) &&
  !shopifyConfig.domain.includes("your-store") &&
  !shopifyConfig.publicAccessToken.includes("your_storefront_access_token")
);

/**
 * Validates configuration and logs clear warnings if values are missing.
 */
export function validateShopifyConfig(): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!shopifyConfig.domain) {
    issues.push("NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN is missing");
  } else if (!shopifyConfig.domain.includes(".myshopify.com")) {
    issues.push("NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN must end with .myshopify.com");
  }

  if (!shopifyConfig.publicAccessToken && !shopifyConfig.privateAccessToken) {
    issues.push("Neither NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN nor SHOPIFY_STOREFRONT_PRIVATE_TOKEN is set");
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}
