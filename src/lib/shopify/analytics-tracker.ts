/**
 * Decides when to send which Shopify analytics event: a page view on every
 * navigation, product views, add to cart. Nothing goes out before Shopify's
 * privacy API has loaded the visitor's consent, and nothing at all without
 * consent to analytics. When the visitor accepts later, the page they are on is
 * sent then. Browser-safe, no React: analytics.tsx wires it to the page.
 */
import {
  addToCartEvents,
  pageViewEvents,
  productViewEvents,
  sendToShopify,
  type AnalyticsPayload,
  type AnalyticsProduct,
  type AnalyticsShop,
  type BrowserParameters,
  type MonorailEvent,
} from "./analytics-events";
import { consentFlags, customerPrivacy, trackingValues, waitingForChoice, type CustomerPrivacy } from "./privacy";
import type { Cart, CartItemInput, CartLine } from "./types";

export interface TrackerDeps {
  send(events: MonorailEvent[]): Promise<unknown>;
  privacy(): CustomerPrivacy | null;
  browser(): BrowserParameters;
}

export interface AnalyticsTracker {
  setShop(shop: AnalyticsShop): void;
  /** Shopify's privacy API has loaded the visitor's consent. */
  ready(): void;
  /** The visitor made a choice in the cookie banner. */
  consentChanged(): void;
  /** The visitor is on this path now. */
  page(path: string): void;
  productView(path: string, products: AnalyticsProduct[]): void;
  /** After Shopify's cart came back from adding these lines. */
  addToCart(cart: Cart, lines: CartItemInput[]): void;
}

function navigation(): [string, string] {
  try {
    const entry = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (entry?.type) return [String(entry.type), "PerformanceNavigationTiming"];
  } catch {
    // No performance API: Shopify takes "unknown".
  }
  return ["unknown", "unknown"];
}

export function browserParameters(): BrowserParameters {
  const { uniqueToken, visitToken } = trackingValues();
  const [navigationType, navigationApi] = navigation();
  return {
    uniqueToken,
    visitToken,
    url: location.href,
    path: location.pathname,
    search: location.search,
    referrer: document.referrer,
    title: document.title,
    userAgent: navigator.userAgent,
    navigationType,
    navigationApi,
  };
}

const browserDeps = (): TrackerDeps => ({ send: (events) => sendToShopify(events), privacy: () => customerPrivacy(), browser: browserParameters });

function cartLineProduct(line: CartLine, quantity: number): AnalyticsProduct {
  const variant = line.merchandise;
  return {
    productGid: variant.product.id,
    variantGid: variant.id,
    name: variant.product.title,
    variantName: variant.title,
    brand: variant.product.vendor ?? "",
    category: variant.product.productType || undefined,
    price: variant.price.amount,
    sku: variant.sku || undefined,
    quantity,
  };
}

export function createAnalyticsTracker(deps: TrackerDeps = browserDeps()): AnalyticsTracker {
  let shop: AnalyticsShop | null = null;
  let isReady = false;
  let current: { path: string; sent: boolean } | null = null;
  let viewed: { path: string; products: AnalyticsProduct[] } | null = null;

  /** Everything every event carries, or null while nothing may be sent. */
  const base = (): AnalyticsPayload | null => {
    const cp = deps.privacy();
    if (!shop || !isReady || !cp || waitingForChoice(cp)) return null;
    const consent = consentFlags(cp);
    if (!consent.hasUserConsent) return null;
    return { ...shop, shopifySalesChannel: "headless", ...deps.browser(), ...consent };
  };

  const productPage = (products: AnalyticsProduct[]) => ({ pageType: "product", resourceId: products[0].productGid });

  const flush = () => {
    if (!current || current.sent) return;
    const payload = base();
    if (!payload) return;
    current.sent = true;
    const products = viewed?.path === current.path ? viewed.products : null;
    const events = products
      ? [...productViewEvents({ ...payload, ...productPage(products), products }), ...pageViewEvents({ ...payload, ...productPage(products) })]
      : pageViewEvents(payload);
    void deps.send(events);
  };

  return {
    setShop(next) {
      shop = next;
      flush();
    },
    ready() {
      isReady = true;
      flush();
    },
    consentChanged() {
      flush();
    },
    page(path) {
      if (current?.path === path) return;
      current = { path, sent: false };
      flush();
    },
    productView(path, products) {
      if (!products.length) return;
      viewed = { path, products };
      // Its page view already went out: send the product view on its own.
      if (current?.path === path && current.sent) {
        const payload = base();
        if (payload) void deps.send(productViewEvents({ ...payload, ...productPage(products), products }));
      }
    },
    addToCart(cart, lines) {
      const payload = base();
      if (!payload) return;
      const cartLines = cart.lines.edges.map((e) => e.node);
      const products = lines.flatMap((input) => {
        const line = cartLines.find((l) => l.merchandise.id === input.merchandiseId);
        return line ? [cartLineProduct(line, input.quantity)] : [];
      });
      if (products.length) void deps.send(addToCartEvents({ ...payload, cartId: cart.id, products }));
    },
  };
}
