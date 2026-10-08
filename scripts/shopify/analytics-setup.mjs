import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadSdk } from "../test-support/load-sdk.mjs";
import { findSdkDir } from "./sdk-dir.mjs";

const { readAnalyticsConfig } = await loadSdk("analytics-config");
const { ANALYTICS_PACKAGE_VERSION } = await loadSdk("analytics-policy");
const FLAGS = { "shop-id": "SHOPIFY_ANALYTICS_SHOP_ID", origins: "SHOPIFY_ANALYTICS_ORIGINS", country: "SHOPIFY_ANALYTICS_COUNTRY",
  language: "SHOPIFY_ANALYTICS_LANGUAGE", currency: "SHOPIFY_ANALYTICS_CURRENCY", paths: "SHOPIFY_ANALYTICS_PUBLIC_PATHS",
  "product-prefix": "SHOPIFY_ANALYTICS_PRODUCT_PATH_PREFIX" };

export function analyticsConfiguration(flags, env) {
  const changes = {};
  if (flags.enable && flags.disable) return { changes, issues: ["Choose --enable or --disable"] };
  if (flags.disable) return { changes: { SHOPIFY_ANALYTICS_ENABLED: "0" }, issues: [] };
  if (flags.enable) changes.SHOPIFY_ANALYTICS_ENABLED = "1";
  for (const [flag, key] of Object.entries(FLAGS)) if (flag in flags) {
    if (typeof flags[flag] !== "string") return { changes: {}, issues: [`--${flag} needs a value (use --${flag}=...)`] };
    changes[key] = flags[flag];
  }
  if (flags.local) changes.SHOPIFY_ANALYTICS_LOCAL = "1";
  if (flags["experimental-events"]) changes.SHOPIFY_ANALYTICS_EXPERIMENTAL_EVENTS = "1";
  if (flags["page-views-only"]) changes.SHOPIFY_ANALYTICS_EXPERIMENTAL_EVENTS = "0";
  if (!Object.keys(changes).length) return { changes, issues: ["Pass --enable, --disable, or a public configuration flag"] };
  return { changes, issues: readAnalyticsConfig({ ...env, ...changes }).issues };
}

/** Read-only wiring/configuration checks. These never publish Shopify events. */
export async function checkAnalytics({ dir = process.cwd(), env = {}, site, fetchImpl = fetch } = {}) {
  const { config, issues } = readAnalyticsConfig(env);
  const checks = [{ ok: !!config, what: "Analytics is enabled with valid public configuration", details: issues }];
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  checks.push({ ok: pkg.dependencies?.["@shopify/hydrogen"] === ANALYTICS_PACKAGE_VERSION, what: "Official Shopify preview dependency is pinned", details: [`Required: ${ANALYTICS_PACKAGE_VERSION}`] });
  const sdk = findSdkDir(dir);
  const prefix = sdk ? path.relative(dir, path.dirname(path.dirname(sdk))) : "src";
  const app = path.join(dir, prefix, "app");
  for (const file of ["api/shopify/analytics/config/route.ts", "api/[version]/graphql.json/route.ts"]) checks.push({ ok: existsSync(path.join(app, file)), what: `Installed ${file}`, details: [] });
  const layout = ["tsx", "jsx", "ts", "js"].map(ext => path.join(app, `layout.${ext}`)).find(existsSync);
  checks.push({ ok: !!layout && /<ShopifyAnalytics\b/.test(readFileSync(layout, "utf8")), what: "Root layout mounts ShopifyAnalytics", details: [] });
  if (site) {
    try {
      const origin = new URL(site).origin;
      if (!config?.origins.includes(origin)) throw new Error("The site origin must be configured first");
      const response = await fetchImpl(`${origin}/api/shopify/analytics/config`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ path: "/" }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      const hasCredentialField = value => value && typeof value === "object" && Object.entries(value).some(([key, child]) =>
        /token|secret|credential/i.test(key) || hasCredentialField(child));
      const privateResult = hasCredentialField(result);
      checks.push({ ok: response.ok && result.shop?.shopId === config.shop.shopId && result.shop?.myshopifyDomain === config.shop.myshopifyDomain &&
        /no-store/.test(response.headers.get("cache-control") || "") && !privateResult,
        what: "Deployed public configuration matches, is uncached, and contains no credential fields", details: [] });
    } catch { checks.push({ ok: false, what: "Deployed configuration could not be verified", details: [] }); }
  }
  checks.push({ ok: true, what: "Dashboard receipt is a separate human live-view step; HTTP success is not dashboard proof", details: [] });
  return checks;
}
