/** Server configuration. No implicit demo, public env prefix, or Admin token. */
export interface StorefrontConfig {
  domain: string;
  apiVersion: string;
  publicToken: string;
  privateToken: string;
}

export function readShopifyConfig(get: (name: string) => string | undefined): StorefrontConfig {
  let domain = (get("SHOPIFY_STORE_DOMAIN") ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  if (domain && !domain.includes(".")) domain += ".myshopify.com";
  const apiVersion = get("SHOPIFY_API_VERSION") ?? get("SHOPIFY_STOREFRONT_API_VERSION") ?? "2026-07";
  const config = {
    domain,
    apiVersion,
    publicToken: (get("SHOPIFY_STOREFRONT_TOKEN") ?? get("SHOPIFY_STOREFRONT_ACCESS_TOKEN") ?? "").trim(),
    privateToken: (get("SHOPIFY_STOREFRONT_PRIVATE_TOKEN") ?? "").trim(),
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config: StorefrontConfig): void {
  if (!/^(?:[a-z0-9][a-z0-9-]*\.myshopify\.com|mock\.shop)$/.test(config.domain)) {
    throw new Error("Set SHOPIFY_STORE_DOMAIN to the store's myshopify.com hostname, or explicitly mock.shop for local testing.");
  }
  if (!/^20\d\d-(01|04|07|10)$/.test(config.apiVersion)) throw new Error("SHOPIFY_API_VERSION must be a quarterly version such as 2026-07.");
  if (config.domain !== "mock.shop" && !config.publicToken && !config.privateToken) throw new Error("Set a server-side Storefront token; an Admin token is not used by the storefront.");
  if (/^shpat_/.test(config.publicToken) || /^shpat_/.test(config.privateToken)) throw new Error("An Admin token cannot be used as a Storefront credential.");
}
