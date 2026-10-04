/**
 * .env access for the setup scripts. They run outside Next (plain node), so they
 * read the env files themselves: `.env` first, then `.env.local` so the local file wins.
 *
 * site + scripts   SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_API_VERSION
 * site only        storefront tokens, SHOPIFY_WEBHOOK_SECRET
 * scripts only     SHOPIFY_ADMIN_TOKEN, SHOPIFY_APP_CLIENT_ID, SHOPIFY_APP_CLIENT_SECRET
 *
 * Keep the admin token out of the deployed environment: it can rewrite the shop.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
export const ENV_PATH = path.join(ROOT, ".env.local");
const ENV_FILES = [path.join(ROOT, ".env"), ENV_PATH];

export const API_VERSION_DEFAULT = "2026-07";

export function parseEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

export function readEnv() {
  const env = {};
  for (const file of ENV_FILES) if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, "utf8")));
  return env;
}

/** Writes one key to `.env.local`, in place when present so comments survive. */
export function upsertEnv(key, value) {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(ENV_PATH, pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`.trimStart());
}

export function normalizeDomain(raw) {
  const domain = (raw ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return domain && !domain.includes(".") ? `${domain}.myshopify.com` : domain;
}

const pick = (env, ...names) => names.map((n) => env[n]).find(Boolean) ?? "";

export function shopifyEnv(env = readEnv()) {
  return {
    domain: normalizeDomain(pick(env, "SHOPIFY_STORE_DOMAIN", "NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN")),
    apiVersion: pick(env, "SHOPIFY_API_VERSION", "SHOPIFY_STOREFRONT_API_VERSION") || API_VERSION_DEFAULT,
    storefrontToken: pick(env, "SHOPIFY_STOREFRONT_TOKEN", "NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN"),
    storefrontPrivateToken: env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN ?? "",
    adminToken: env.SHOPIFY_ADMIN_TOKEN ?? "",
    webhookSecret: env.SHOPIFY_WEBHOOK_SECRET ?? "",
    clientId: env.SHOPIFY_APP_CLIENT_ID ?? "",
    clientSecret: env.SHOPIFY_APP_CLIENT_SECRET ?? "",
    siteUrl: (env.SITE_URL ?? "").replace(/\/+$/, ""),
  };
}

export const mask = (token) => (token ? `${token.slice(0, 6)}...${token.slice(-4)} (${token.length} chars)` : "-");

export const ok = (message) => console.log(`  [ok]   ${message}`);
export const bad = (message) => console.log(`  [FAIL] ${message}`);
export const warn = (message) => console.log(`  [warn] ${message}`);
export const info = (message) => console.log(`         ${message}`);
export const heading = (message) => console.log(`\n${message}`);
