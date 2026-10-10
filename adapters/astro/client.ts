import { validateConfig, type StorefrontConfig } from "./config";

export class ShopifyError extends Error {
  constructor(message: string, readonly status = 502) { super(message); this.name = "ShopifyError"; }
}

export interface StorefrontOptions {
  getConfig: () => StorefrontConfig;
  country?: string;
  defaultLanguage?: string;
  specMetafields?: Array<{ namespace: string; key: string }>;
  fetch?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
  /** Tests may replace the delay; credentials and buyer state remain request-scoped. */
  sleep?: (ms: number) => Promise<void>;
}
export interface StorefrontRequest {
  query: string;
  variables?: Record<string, unknown>;
  lang: string;
  buyerIp?: string;
}

/** No Next headers/cache, global buyer state, or shared cart cache. */
export function createStorefront(options: StorefrontOptions) {
  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retries = options.retries ?? 2;
  const config = () => { const c = options.getConfig(); validateConfig(c); return c; };
  const storefront = async <T>({ query, variables = {}, lang, buyerIp }: StorefrontRequest): Promise<T> => {
    let c: StorefrontConfig;
    try { c = config(); } catch { throw new ShopifyError("Shopify is not configured: check server-side domain and Storefront credentials.", 503); }
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    // Never send store credentials to the public demo endpoint.
    if (c.domain !== "mock.shop") {
      if (c.privateToken) headers["Shopify-Storefront-Private-Token"] = c.privateToken;
      else headers["X-Shopify-Storefront-Access-Token"] = c.publicToken;
      if (c.privateToken && buyerIp) headers["Shopify-Storefront-Buyer-IP"] = buyerIp;
    }
    const endpoint = c.domain === "mock.shop" ? "https://mock.shop/api" : `https://${c.domain}/api/${c.apiVersion}/graphql.json`;
    const body = JSON.stringify({ query, variables: { ...variables, language: lang.toUpperCase(), ...(options.country && { country: options.country.toUpperCase() }) } });
    const mutation = /^\s*mutation\b/m.test(query);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetchFn(endpoint, { method: "POST", headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 10000) });
      } catch {
        // A mutation may already be applied; a retry could add the item twice.
        if (!mutation && attempt < retries) { await sleep(400 * 2 ** attempt); continue; }
        throw new ShopifyError("Shopify could not be reached. Check your cart before trying again.", 503);
      }
      if (!mutation && (response.status === 429 || response.status >= 500) && attempt < retries) {
        const seconds = Number(response.headers.get("Retry-After"));
        await sleep(seconds > 0 ? Math.min(seconds, 30) * 1000 : 400 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new ShopifyError(`Shopify HTTP ${response.status}.`, response.status);
      let json: { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
      try { json = await response.json(); } catch { throw new ShopifyError("Shopify returned an invalid response."); }
      if (json.errors?.length) {
        if (!mutation && json.errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < retries) { await sleep(400 * 2 ** attempt); continue; }
        // Error payloads may include buyer data; do not log or expose their raw contents.
        throw new ShopifyError("Shopify rejected the request.");
      }
      if (!json.data) throw new ShopifyError("Shopify returned no data.");
      return json.data;
    }
  };
  storefront.isConfigured = () => { try { config(); return true; } catch { return false; } };
  storefront.checkoutUrl = (value: string) => {
    const url = new URL(value);
    const c = config();
    const allowed = url.hostname === c.domain || url.hostname === "checkout.shopify.com" || (c.domain === "mock.shop" && url.hostname.endsWith(".mock.shop"));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed) throw new ShopifyError("Shopify returned an invalid hosted checkout address.");
    return url.href;
  };
  return storefront;
}
