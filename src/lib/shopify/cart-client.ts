/**
 * Browser-side client for the /api/cart route.
 *
 * The route answers with the cart itself (or null when Shopify is not
 * configured), never wrapped in { cart }. Failures come back as { error, code }
 * with a 4xx/5xx status, and are thrown here so callers never mistake a
 * failed request for an empty answer.
 */

import type { Cart } from "./types";

export class CartRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = "CartRequestError"; }
}

async function cartRequest(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new CartRequestError(typeof data?.error === "string" ? data.error : `Cart request failed (${res.status})`, typeof data?.code === "string" ? data.code : undefined);
  return data ?? null;
}

export async function cartAction(body: Record<string, unknown>): Promise<Cart | null> {
  return await cartRequest(body) as Cart | null;
}

/** Only the explicit checkout handoff receives the keyed navigation URL. */
export async function cartCheckoutUrl(cartId: string): Promise<string | null> {
  const data = await cartRequest({ action: "checkout", cartId }) as { checkoutUrl?: unknown } | null;
  return typeof data?.checkoutUrl === "string" && data.checkoutUrl ? data.checkoutUrl : null;
}

/** Shopify cart ids look like gid://shopify/Cart/...; anything else is stale local data. */
export function isShopifyCartId(id: string | null | undefined): id is string {
  return Boolean(id?.startsWith("gid://shopify/Cart/"));
}
