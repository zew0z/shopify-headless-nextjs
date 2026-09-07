/**
 * Robust Shopify Storefront API Fetch Client
 *
 * Features:
 * - Automatic exponential backoff & retries for HTTP 429 (Rate Limits) and 503 (Temporary Unavailable).
 * - Automatic token selection (Private Storefront Token for SSR / Public for client fallback).
 * - Forwarding of client's real IP via `Shopify-Storefront-Buyer-IP` to prevent server-side IP throttling.
 * - Next.js tag-based on-demand ISR revalidation support (`next: { tags, revalidate }`).
 * - Detailed error handling with GraphQL userErrors and network logging.
 */

import { shopifyConfig, isShopifyConfigured } from "./config";
import { ShopifyResponse } from "./types";

export class ShopifyError extends Error {
  status: number;
  errors?: unknown[];

  constructor(message: string, status = 500, errors?: unknown[]) {
    super(message);
    this.name = "ShopifyError";
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Safely extracts client IP address when running inside Next.js server context.
 */
async function getBuyerIp(): Promise<string | undefined> {
  if (typeof window !== "undefined") return undefined;

  try {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");
    if (forwardedFor) {
      return forwardedFor.split(",")[0].trim();
    }
    return headerList.get("x-real-ip") || undefined;
  } catch {
    // Silently continue if invoked outside Next.js request context (e.g. build time)
    return undefined;
  }
}

interface ShopifyFetchParams {
  query: string;
  variables?: Record<string, unknown>;
  cache?: RequestCache;
  tags?: string[];
  revalidate?: number | false;
  retryCount?: number;
}

/**
 * Universal Storefront API fetcher with retry & error recovery
 */
export async function shopifyFetch<T>({
  query,
  variables = {},
  cache = "no-store",
  tags,
  revalidate,
  retryCount = 0,
}: ShopifyFetchParams): Promise<{ status: number; body: ShopifyResponse<T> }> {
  if (!isShopifyConfigured) {
    throw new ShopifyError("Shopify credentials not properly configured in environment.", 400);
  }

  const endpoint = `https://${shopifyConfig.domain}/api/${shopifyConfig.apiVersion}/graphql.json`;

  // Build Request Headers
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Attach appropriate token
  if (shopifyConfig.privateAccessToken) {
    requestHeaders["Shopify-Storefront-Private-Token"] = shopifyConfig.privateAccessToken;
    const buyerIp = await getBuyerIp();
    if (buyerIp) {
      requestHeaders["Shopify-Storefront-Buyer-IP"] = buyerIp;
    }
  } else {
    requestHeaders["X-Shopify-Storefront-Access-Token"] = shopifyConfig.publicAccessToken;
  }

  // Next.js caching configuration
  const nextConfig: { tags?: string[]; revalidate?: number | false } = {};
  if (tags && tags.length > 0) nextConfig.tags = tags;
  if (typeof revalidate !== "undefined") nextConfig.revalidate = revalidate;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), shopifyConfig.timeoutMs);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ query, variables }),
      cache,
      next: Object.keys(nextConfig).length > 0 ? nextConfig : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Rate Limit (429) or Server Unavailable (503) Retry Handling
    if ((response.status === 429 || response.status === 503) && retryCount < shopifyConfig.maxRetries) {
      const delay = shopifyConfig.retryDelayMs * Math.pow(2, retryCount);
      console.warn(
        `[Shopify] Rate limited (${response.status}). Retrying in ${delay}ms (Attempt ${retryCount + 1}/${shopifyConfig.maxRetries})...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return shopifyFetch<T>({
        query,
        variables,
        cache,
        tags,
        revalidate,
        retryCount: retryCount + 1,
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new ShopifyError(
        `Shopify HTTP ${response.status}: ${errorText || response.statusText}`,
        response.status
      );
    }

    const body: ShopifyResponse<T> = await response.json();

    if (body.errors && body.errors.length > 0) {
      const primaryMessage = body.errors[0]?.message || "GraphQL Execution Error";
      console.error("[Shopify GraphQL Errors]:", body.errors);
      throw new ShopifyError(primaryMessage, 400, body.errors);
    }

    return {
      status: response.status,
      body,
    };
  } catch (error: unknown) {
    if (error instanceof ShopifyError) {
      throw error;
    }

    // Abort timeout
    if (error instanceof Error && error.name === "AbortError") {
      throw new ShopifyError(`Shopify request timed out after ${shopifyConfig.timeoutMs}ms`, 408);
    }

    throw new ShopifyError(
      error instanceof Error ? error.message : "Unknown network failure querying Shopify",
      500
    );
  }
}
