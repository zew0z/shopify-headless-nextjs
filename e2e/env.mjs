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
