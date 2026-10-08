"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { analyticsStore } from "./analytics-browser";
import type { Cart, CartItemInput, Money, ShopAnalytics } from "./types";

/** Runtime config is fetched from the site's own server. The old shop prop remains source-compatible. */
export function ShopifyAnalytics({ withPrivacyBanner = true, nonce }: { shop?: ShopAnalytics | null; withPrivacyBanner?: boolean; nonce?: string }) {
  const pathname = usePathname();
  const state = useSyncExternalStore(analyticsStore.subscribe, analyticsStore.getSnapshot, analyticsStore.getServerSnapshot);
  useEffect(() => { void analyticsStore.visit(nonce); }, [pathname, nonce]);
  return <>
    <span hidden data-shopify-analytics data-consent={state.choice} data-published={state.published} data-delivered={state.delivered} data-transport={state.transport} />
    {withPrivacyBanner && state.enabled && <>
      <button type="button" onClick={analyticsStore.open} aria-label="Cookie settings" className="fixed bottom-3 left-3 z-40 rounded border bg-white px-3 py-2 text-sm text-black">Cookie settings</button>
      {state.open && <section aria-label="Cookie preferences" className="fixed inset-x-3 bottom-14 z-50 mx-auto max-w-xl rounded border bg-white p-5 text-black shadow-lg">
        <p className="font-semibold">Your cookie choice</p>
        <p className="my-3 text-sm">Essential cookies support shopping. With your permission, Shopify statistics help us understand which public pages people visit. Advertising stays off. You can change your choice here at any time.</p>
        {state.failed && <p role="status" className="my-2 text-sm">Statistics remain off. You can continue shopping.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void analyticsStore.choose(false)} disabled={!state.ready} className="rounded border px-3 py-2">{state.choice === "accepted" ? "Withdraw consent" : "Reject statistics"}</button>
          <button type="button" onClick={() => void analyticsStore.choose(true)} disabled={!state.ready || state.busy} className="rounded border px-3 py-2">Accept statistics</button>
          <button type="button" onClick={analyticsStore.close} className="rounded border px-3 py-2">Close</button>
        </div>
        {state.busy && <span role="status" className="text-sm">Saving your choice…</span>}
      </section>}
    </>}
  </>;
}

/** For an existing, localized consent UI rendered with withPrivacyBanner={false}. */
export const setAnalyticsConsent = analyticsStore.choose;
export const openAnalyticsPreferences = analyticsStore.open;
export function CookiePreferencesButton({ children = "Cookie settings" }: { children?: React.ReactNode }) {
  return <button type="button" onClick={analyticsStore.open}>{children}</button>;
}

/** Preserved product hook; reporting requires SHOPIFY_ANALYTICS_EXPERIMENTAL_EVENTS=1. */
export function ShopifyProductView({ product, variant }: {
  product: { id: string; title: string; vendor: string; productType?: string | null };
  variant: { id: string; title: string; price: Money; sku?: string | null } | null | undefined;
}) {
  const pathname = usePathname();
  const variantId = variant?.id, title = variant?.title, price = variant?.price.amount, sku = variant?.sku;
  const { id, title: name, vendor, productType } = product;
  useEffect(() => {
    if (variantId && price) analyticsStore.productView(pathname, [{ productGid: id, variantGid: variantId, name, variantName: title,
      brand: vendor, category: productType || undefined, price, sku: sku || undefined, quantity: 1 }]);
  }, [pathname, id, name, vendor, productType, variantId, title, price, sku]);
  return null;
}

/** Preserved successful-add hook; uses the official cart delta tracker when explicitly enabled. */
export function trackAddToCart(cart: Cart, lines: CartItemInput[]) { analyticsStore.addToCart(cart, lines); }
