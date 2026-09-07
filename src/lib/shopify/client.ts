/**
 * Shopify Storefront GraphQL Client
 *
 * Universal, dependency-free GraphQL client featuring:
 * - Automatic exponential backoff retry on HTTP 429 (Rate Limits) and HTTP 503
 * - Shopify-Storefront-Buyer-IP forwarding from x-forwarded-for headers (protects SSR servers)
 * - Support for both public and private Storefront API tokens
 * - Configurable request abort timeouts
 * - Next.js App Router cache tag integration
 */

import { headers } from "next/headers";
import { shopifyConfig, isShopifyConfigured } from "./config";
import { ShopifyResponse, ShopifyGraphQLError } from "./types";

export class ShopifyError extends Error {
  public status: number;
  public errors?: ShopifyGraphQLError[];

  constructor(message: string, status: number = 500, errors?: ShopifyGraphQLError[]) {
    super(message);
    this.name = "ShopifyError";
    this.status = status;
    this.errors = errors;
  }
}

interface ShopifyFetchOptions {
  query: string;
  variables?: Record<string, unknown>;
  cache?: RequestCache;
  tags?: string[];
  revalidate?: number | false;
  retries?: number;
  buyerIp?: string;
}

/**
 * Universal fetch wrapper for Shopify Storefront GraphQL API.
 */
export async function shopifyFetch<T>({
  query,
  variables,
  cache = "no-store",
  tags,
  revalidate,
  retries = shopifyConfig.maxRetries,
  buyerIp,
}: ShopifyFetchOptions): Promise<{ status: number; body: ShopifyResponse<T> }> {
  if (!isShopifyConfigured) {
    throw new ShopifyError(
      "Shopify is not configured. Please set NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN and access token in .env.local",
      500
    );
  }

  const endpoint = `https://${shopifyConfig.domain}/api/${shopifyConfig.apiVersion}/graphql.json`;

  // Build headers
  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Determine authentication method
  if (shopifyConfig.privateAccessToken) {
    reqHeaders["Shopify-Storefront-Private-Token"] = shopifyConfig.privateAccessToken;
  } else {
    reqHeaders["X-Shopify-Storefront-Access-Token"] = shopifyConfig.publicAccessToken;
  }

  // Forward client Buyer IP to prevent SSR server throttling
  let clientIp = buyerIp;
  if (!clientIp) {
    try {
      const headerList = await headers();
      const forwardedFor = headerList.get("x-forwarded-for");
      if (forwardedFor) {
        clientIp = forwardedFor.split(",")[0].trim();
      } else {
        clientIp = headerList.get("x-real-ip") || undefined;
      }
    } catch {
      // In non-request contexts (e.g. background tasks or static generation), headers() throws
    }
  }

  if (clientIp) {
    reqHeaders["Shopify-Storefront-Buyer-IP"] = clientIp;
  }

  // Next.js caching configuration
  const nextOptions: { tags?: string[]; revalidate?: number | false } = {};
  if (tags && tags.length > 0) nextOptions.tags = tags;
  if (typeof revalidate === "number" || revalidate === false) {
    nextOptions.revalidate = revalidate;
  }

  const fetchInit: RequestInit = {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify({ query, variables }),
    cache,
    ...(Object.keys(nextOptions).length > 0 ? { next: nextOptions } : {}),
  };

  // Execute request with timeout and exponential backoff retry loop
  let attempt = 0;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), shopifyConfig.timeoutMs);

    try {
      const res = await fetch(endpoint, {
        ...fetchInit,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle rate limiting (429) or transient gateway errors (503)
      if (res.status === 429 || res.status === 503) {
        if (attempt < retries) {
          // Check for Retry-After header or compute exponential jittered backoff
          const retryAfterHeader = res.headers.get("Retry-After");
          const retryAfterMs = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : shopifyConfig.retryDelayMs * Math.pow(2, attempt) + Math.random() * 200;

          console.warn(
            `[Shopify SDK] Rate limited (${res.status}). Retrying attempt ${attempt + 1}/${retries} in ${Math.round(retryAfterMs)}ms...`
          );

          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          attempt++;
          continue;
        }
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new ShopifyError(
          `Shopify HTTP ${res.status}: ${errorText}`,
          res.status
        );
      }

      const body: ShopifyResponse<T> = await res.json();

      // Check for throttled code inside GraphQL errors
      if (body.errors && body.errors.length > 0) {
        const isThrottled = body.errors.some(
          (e) => e.extensions?.code === "THROTTLED" || e.message?.toLowerCase().includes("throttled")
        );

        if (isThrottled && attempt < retries) {
          const delayMs = shopifyConfig.retryDelayMs * Math.pow(2, attempt) + Math.random() * 200;
          console.warn(
            `[Shopify SDK] GraphQL THROTTLED error. Retrying attempt ${attempt + 1}/${retries} in ${Math.round(delayMs)}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          attempt++;
          continue;
        }

        const msg = body.errors.map((e) => e.message).join(", ");
        throw new ShopifyError(`Shopify GraphQL Error: ${msg}`, 400, body.errors);
      }

      return { status: res.status, body };
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      // Retry on network abort or transient fetch errors
      if (attempt < retries) {
        const isAbort = (err as Error)?.name === "AbortError";
        const isNetworkErr = (err as Error)?.message?.includes("fetch failed");

        if (isAbort || isNetworkErr) {
          const delayMs = shopifyConfig.retryDelayMs * Math.pow(2, attempt);
          console.warn(
            `[Shopify SDK] Network/timeout retry (${attempt + 1}/${retries}) in ${delayMs}ms:`,
            (err as Error).message
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          attempt++;
          continue;
        }
      }

      if (err instanceof ShopifyError) throw err;
      throw new ShopifyError((err as Error).message || "Unknown network error", 500);
    }
  }

  throw new ShopifyError(`Request failed after ${retries} retries`, 429);
}
