"use client";

/**
 * Shopify analytics for the storefront, so the shop's Live View and reports
 * count its visitors: a page view on every navigation, product views and add to
 * cart, sent the way Hydrogen sends them, and only with the visitor's consent.
 *
 * In the root layout:   <ShopifyAnalytics shop={await getShopAnalytics()} />
 * On the product page:  <ShopifyProductView product={product} variant={selectedVariant} />
 * The kit's CartProvider reports adds itself; a cart of the site's own calls
 * trackAddToCart(cart, lines) after Shopify's cart comes back.
 * Needs the Storefront API proxy route app/api/[version]/graphql.json/route.ts.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createAnalyticsTracker } from "./analytics-tracker";
import { loadCustomerPrivacy } from "./privacy";
import type { Cart, CartItemInput, Money, ShopAnalytics } from "./types";

// One per page load, shared by every component below.
const tracker = createAnalyticsTracker();

export function ShopifyAnalytics({
  shop,
  withPrivacyBanner = true,
}: {
  /** From getShopAnalytics(). With null nothing is sent. */
  shop: ShopAnalytics | null;
  /** Shopify's own cookie banner, set up in the admin under Settings > Customer privacy. Pass false only when the site has its own banner that calls Shopify's setTrackingConsent. */
  withPrivacyBanner?: boolean;
}) {
  const pathname = usePathname();
  const shopId = shop?.shopId;
  const currency = shop?.currency;
  const language = shop?.acceptedLanguage;
  const token = shop?.storefrontAccessToken;
  const checkoutDomain = shop?.checkoutDomain;

  useEffect(() => {
    if (!shopId || !currency || !language || !token || !checkoutDomain) return;
    tracker.setShop({ shopId, currency, acceptedLanguage: language });
    return loadCustomerPrivacy(
      { storefrontAccessToken: token, checkoutDomain, withPrivacyBanner, locale: language },
      { onReady: tracker.ready, onConsent: tracker.consentChanged }
    );
  }, [shopId, currency, language, token, checkoutDomain, withPrivacyBanner]);

  useEffect(() => {
    tracker.page(pathname);
  }, [pathname]);

  return null;
}

export function ShopifyProductView({
  product,
  variant,
}: {
  product: { id: string; title: string; vendor: string; productType?: string | null };
  /** The selected variant; nothing is reported until there is one. */
  variant: { id: string; title: string; price: Money; sku?: string | null } | null | undefined;
}) {
  const pathname = usePathname();
  const { id: productId, title, vendor } = product;
  const category = product.productType || undefined;
  const variantId = variant?.id;
  const variantTitle = variant?.title;
  const price = variant?.price.amount;
  const sku = variant?.sku || undefined;

  useEffect(() => {
    if (!variantId || !price) return;
    tracker.productView(pathname, [
      { productGid: productId, variantGid: variantId, name: title, variantName: variantTitle, brand: vendor, category, price, sku, quantity: 1 },
    ]);
  }, [pathname, productId, title, vendor, category, variantId, variantTitle, price, sku]);

  return null;
}

/** Call after Shopify's cart came back from adding these lines. */
export function trackAddToCart(cart: Cart, lines: CartItemInput[]): void {
  tracker.addToCart(cart, lines);
}
