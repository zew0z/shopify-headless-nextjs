/** Server-only runtime configuration; no tokens are serialized to the browser. */
import type { AnalyticsConfig } from "./analytics-policy";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function readAnalyticsConfig(env: Record<string, string | undefined> = process.env): { config: AnalyticsConfig | null; issues: string[] } {
  if (env.SHOPIFY_ANALYTICS_ENABLED !== "1") return { config: null, issues: ["SHOPIFY_ANALYTICS_ENABLED must be 1 to enable analytics"] };
  const issues: string[] = [];
  const domain = (env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || env.SHOPIFY_STORE_DOMAIN || "").trim();
  const shopId = (env.SHOPIFY_ANALYTICS_SHOP_ID || "").replace(/^gid:\/\/shopify\/Shop\//, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) issues.push("Use the verified permanent myshopify.com domain");
  if (!/^[1-9]\d*$/.test(shopId)) issues.push("SHOPIFY_ANALYTICS_SHOP_ID must be the verified numeric Shop ID or Shop GID");
  const origins = (env.SHOPIFY_ANALYTICS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!origins.length) issues.push("SHOPIFY_ANALYTICS_ORIGINS needs the permitted frontend origins");
  for (const origin of origins) {
    try {
      const u = new URL(origin);
      if (u.origin !== origin || u.username || u.password || u.pathname !== "/" || u.search || u.hash ||
          (LOOPBACK.has(u.hostname) ? env.SHOPIFY_ANALYTICS_LOCAL !== "1" || !["http:", "https:"].includes(u.protocol) : u.protocol !== "https:")) throw new Error();
    } catch { issues.push("Analytics origins must be exact HTTPS origins; loopback also requires SHOPIFY_ANALYTICS_LOCAL=1"); }
  }
  const country = env.SHOPIFY_ANALYTICS_COUNTRY || "";
  const language = env.SHOPIFY_ANALYTICS_LANGUAGE || "";
  const currency = env.SHOPIFY_ANALYTICS_CURRENCY || "";
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{2}(?:_[A-Z]{2})?$/.test(language) || !/^[A-Z]{3}$/.test(currency)) issues.push("Configure country, language and currency with the store's verified localization codes");
  const rawPaths = (env.SHOPIFY_ANALYTICS_PUBLIC_PATHS || "/").split(",").map(x => x.trim());
  const prefix = env.SHOPIFY_ANALYTICS_PRODUCT_PATH_PREFIX || "/products";
  const validPath = (p: string) => /^\/(?:[\p{L}\p{N}%._~-]+\/?)*$/u.test(p) && !p.includes("..") && !p.includes("//");
  if (!rawPaths.every(validPath) || !validPath(prefix) || prefix === "/" || prefix.endsWith("/")) issues.push("Analytics paths must be public absolute paths, without queries or fragments");
  if (issues.length) return { config: null, issues };
  const publicPaths = rawPaths.map(p => new URL(p, "https://policy.invalid").pathname);
  if (issues.length) return { config: null, issues };
  return { issues: [], config: { shop: { shopId, storefrontId: "0", myshopifyDomain: domain }, i18n: { country, language, currency },
    origins: [...new Set(origins)], publicPaths: [...new Set(publicPaths)], productPathPrefix: prefix, experimentalEvents: env.SHOPIFY_ANALYTICS_EXPERIMENTAL_EVENTS === "1" } };
}

/** Accept an internal HTTP reverse proxy only when the public Host and Origin match the allowlist. */
export function analyticsRequestOrigin(request: Request, config: AnalyticsConfig): string | null {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") ?? url.host;
    if (!origin || !config.origins.includes(origin) || new URL(origin).host !== host || url.search ||
        ![null, "same-origin"].includes(request.headers.get("sec-fetch-site"))) return null;
    return origin;
  } catch { return null; }
}

/** Dynamic paths are admitted only after a server-side Shopify product lookup succeeds. */
export async function analyticsPaths(path: unknown, config: AnalyticsConfig, getProduct: (handle: string) => Promise<unknown>): Promise<string[]> {
  if (typeof path !== "string" || path.length > 2048 || path.includes("?") || path.includes("#")) return config.publicPaths;
  const u = new URL(path, "https://policy.invalid");
  if (u.origin !== "https://policy.invalid") return config.publicPaths;
  if (config.publicPaths.includes(u.pathname)) return config.publicPaths;
  const prefix = `${config.productPathPrefix}/`;
  if (!u.pathname.startsWith(prefix)) return config.publicPaths;
  try {
    const handle = decodeURIComponent(u.pathname.slice(prefix.length));
    if (!/^[\p{L}\p{N}-]+$/u.test(handle)) return config.publicPaths;
    const product = await getProduct(handle);
    return product ? [...config.publicPaths, u.pathname] : config.publicPaths;
  } catch { return config.publicPaths; }
}
