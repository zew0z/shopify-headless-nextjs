/** Import only from Astro frontmatter, endpoints, or server modules. Astro rejects this import in browser bundles. */
import { getSecret } from "astro:env/server";
import { readShopifyConfig } from "./config";
import { createShopifyCommerce } from "./provider";
import type { StorefrontOptions } from "./client";
import { createShopifyContent } from "./content";

export function createAstroCommerce(options: Omit<StorefrontOptions, "getConfig"> = {}) {
  return createShopifyCommerce({ ...options, getConfig: () => readShopifyConfig(getSecret) });
}
export function createAstroContent(options: Omit<StorefrontOptions, "getConfig"> = {}) {
  return createShopifyContent({ ...options, getConfig: () => readShopifyConfig(getSecret) });
}
export { createCartEndpoint } from "./routes";
export type * from "./commerce-types";
