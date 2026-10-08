import { AnalyticsEvent, getShopifyScriptTags, initializeShopifyScripts, trackCartAnalytics, type ShopifyScriptsI18n } from "@shopify/hydrogen";
import { createAnalyticsTracker, INITIAL_ANALYTICS_STATE, type AnalyticsPrivacy } from "./analytics-tracker";
import { ANALYTICS_ENDPOINT, analyticsConsentQuery, publicAnalyticsUrl, sanitizeAnalyticsBatch, type AnalyticsConfig } from "./analytics-policy";
import { loadAnalyticsScript } from "./analytics-script-loader";
import type { Cart, CartItemInput } from "./types";
import type { AnalyticsProduct } from "./analytics-events";

let controller: ReturnType<typeof createAnalyticsTracker> | undefined;
let config: AnalyticsConfig | undefined;
const paths: string[] = [];
const listeners = new Set<() => void>();
let startup: Promise<void> | undefined;
let routeVersion = 0;
let navigationPath = "";
let nonce: string | undefined;
let product: { path: string; products: AnalyticsProduct[] } | undefined;
let lastProduct = "";

function waitForPrivacy() {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      if (window.Shopify?.customerPrivacy?.consentStatus !== "loaded") return;
      clearTimeout(timeout); document.removeEventListener("consentTrackingApiLoaded", done); resolve();
    };
    const timeout = setTimeout(() => { document.removeEventListener("consentTrackingApiLoaded", done); reject(new Error("Consent unavailable")); }, 15000);
    document.addEventListener("consentTrackingApiLoaded", done); done();
  });
}

function installTransportBoundary() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin && url.pathname === "/api/unstable/graphql.json") {
      let query: string | null = null;
      try { query = typeof init?.body === "string" ? analyticsConsentQuery(JSON.parse(init.body)) : null; } catch { /* Invalid operation stays blocked. */ }
      if (!query) return Promise.resolve(Response.json({ errors: [{ message: "Consent unavailable" }] }, { status: 400 }));
      return originalFetch(input, { ...init, body: JSON.stringify({ query, variables: {} }), cache: "no-store", referrerPolicy: "no-referrer" });
    }
    if (url.href === ANALYTICS_ENDPOINT) {
      const body = controller?.canTrack() && config && typeof init?.body === "string" ? sanitizeAnalyticsBatch(init.body, window.location.origin, config, paths) : null;
      if (!body) return Promise.resolve(new Response(null, { status: 204 }));
      return originalFetch(input, { ...init, body, referrerPolicy: "no-referrer" }).then(response => {
        controller?.recordTransport(response.ok); return response;
      }, error => { controller?.recordTransport(false); throw error; });
    }
    return originalFetch(input, init);
  };
}

async function fetchConfig(): Promise<AnalyticsConfig | null> {
  const response = await fetch("/api/shopify/analytics/config", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: window.location.pathname }), cache: "no-store", referrerPolicy: "no-referrer" });
  if (response.status === 403) return null;
  if (!response.ok) throw new Error("Analytics unavailable");
  return response.json();
}

function emitProduct() {
  if (!config?.experimentalEvents || !controller?.canTrack() || !product || !publicAnalyticsUrl(location.href, location.origin, paths) ||
      product.path !== location.pathname) return;
  const key = `${product.path}:${product.products.map(p => p.variantGid).join(",")}`;
  if (key === lastProduct) return;
  lastProduct = key;
  window.Shopify?.analytics?.publish(AnalyticsEvent.PRODUCT_VIEWED, { url: `${location.origin}${location.pathname}`,
    products: product.products.map(p => ({ id: p.productGid, title: p.name, vendor: p.brand, price: p.price,
      variantId: p.variantGid || "", variantTitle: p.variantName || "", quantity: p.quantity || 1, sku: p.sku, productType: p.category })) });
}

async function start() {
  try {
    config = await fetchConfig() ?? undefined;
    if (!config) return;
    paths.push(...config.publicPaths);
    controller = createAnalyticsTracker({ origin: window.location.origin, paths,
      async loadPrivacy(onEnabled) {
        onEnabled();
        if (window.Shopify?.analytics) throw new Error("Another analytics bus is already present");
        installTransportBoundary();
        const tags = getShopifyScriptTags({ shop: config!.shop, i18n: config!.i18n as ShopifyScriptsI18n,
          analytics: { channel: "headless" }, consent: { mode: "custom-banner", setup: async () => {} }, shopifyAnalytics: false });
        for (const id of ["shopify-global-bootstrap", "shopify-analytics-bus"]) {
          const tag = tags.scripts.find(s => s.attributes?.id === id);
          if (!tag?.innerHTML) throw new Error("Analytics unavailable");
          const script = document.createElement("script"); script.id = id; script.textContent = tag.innerHTML;
          if (nonce) script.nonce = nonce;
          document.head.appendChild(script);
        }
        if (!window.Shopify?.analytics) throw new Error("Analytics bootstrap blocked");
        const tag = tags.scripts.find(s => s.attributes?.id === "shopify-consent");
        if (!tag?.attributes?.src) throw new Error("Consent unavailable");
        await loadAnalyticsScript(document, tag.attributes.src, "shopify-consent");
        await waitForPrivacy();
        const cp = window.Shopify!.customerPrivacy!;
        const originalConsent = cp.setTrackingConsent.bind(cp);
        // A banner outside this kit can withdraw directly: block before its asynchronous write.
        cp.setTrackingConsent = ((consent: Parameters<typeof originalConsent>[0]) => {
          if (consent.analytics !== true) controller?.withdrawImmediately();
          return originalConsent(consent);
        }) as typeof cp.setTrackingConsent;
        document.addEventListener("visitorConsentCollected", () => controller?.syncPrivacy());
        return { get consentStatus() { return cp.consentStatus; }, currentVisitorConsent: () => cp.currentVisitorConsent(),
          analyticsProcessingAllowed: () => cp.analyticsProcessingAllowed(), setTrackingConsent: originalConsent } as AnalyticsPrivacy;
      },
      async initialize() { await initializeShopifyScripts({ consent: { mode: "custom-banner", setup: async () => {} }, webMcp: false }); await Promise.resolve(); },
      async loadSender() { await loadAnalyticsScript(document, "https://cdn.shopify.com/storefront/analytics/shopify.js", "shopify-storefront-analytics"); },
      publish(payload) { window.Shopify!.analytics!.publish(AnalyticsEvent.PAGE_VIEWED, payload); emitProduct(); },
    });
    controller.subscribe(() => {
      if (!controller?.canTrack()) lastProduct = "";
      listeners.forEach(fn => fn());
    });
    controller.visit(window.location.href);
    await controller.boot();
  } catch {
    controller?.disable();
    console.warn("[Shopify analytics] Setup unavailable; tracking remains off.");
  }
}

export const analyticsStore = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  getSnapshot: () => controller?.getSnapshot() ?? INITIAL_ANALYTICS_STATE,
  getServerSnapshot: () => INITIAL_ANALYTICS_STATE,
  async visit(scriptNonce?: string) {
    if (typeof window === "undefined") return;
    nonce = scriptNonce;
    const epoch = ++routeVersion;
    if (navigationPath !== window.location.pathname) { controller?.visit(null); lastProduct = ""; }
    navigationPath = window.location.pathname;
    if (!startup) { startup = start(); await startup; }
    else {
      await startup;
      if (!controller) return;
      try {
        const next = await fetchConfig();
        if (epoch !== routeVersion) return;
        if (!next || JSON.stringify(next.shop) !== JSON.stringify(config?.shop) || JSON.stringify(next.i18n) !== JSON.stringify(config?.i18n)) {
          controller.disable(); return;
        }
        config = next;
        for (const path of next.publicPaths) if (!paths.includes(path)) paths.push(path);
      } catch { if (epoch === routeVersion) controller.disable(); return; }
    }
    if (epoch === routeVersion) controller?.visit(window.location.href);
  },
  open: () => controller?.open(),
  close: () => controller?.close(),
  choose: (accepted: boolean) => controller?.choose(accepted),
  productView(path: string, products: AnalyticsProduct[]) { product = { path, products }; emitProduct(); },
  addToCart(cart: Cart, lines: CartItemInput[]) {
    if (!config?.experimentalEvents || !controller?.canTrack() || !cart.updatedAt || !publicAnalyticsUrl(location.href, location.origin, paths)) return;
    try {
      // The official cart tracker computes the delta. Its adapter contains only public product/cost fields.
      const nodes = cart.lines.edges.map(({ node }) => ({ ...node, cost: { ...node.cost, amountPerQuantity: node.merchandise.price } }));
      const previous = nodes.flatMap(node => {
        const quantity = node.quantity - lines.filter(l => l.merchandiseId === node.merchandise.id).reduce((n, l) => n + l.quantity, 0);
        return quantity > 0 ? [{ ...node, quantity }] : [];
      });
      const data = (items: typeof nodes, updatedAt: string) => ({ id: cart.id.split(/[?#]/)[0], updatedAt,
        cost: cart.cost, lines: { nodes: items } });
      const prior = { data: data(previous, `before:${cart.updatedAt}`), revalidating: false,
        pending: { cost: false, lines: new Set(), discountCodes: new Set(), note: false, attributes: false } };
      const current = { ...prior, data: data(nodes, cart.updatedAt) };
      const adapter = { getState: () => prior, subscribe(fn: (state: typeof current) => void) { fn(current); return () => {}; } };
      trackCartAnalytics(adapter as unknown as Parameters<typeof trackCartAnalytics>[0])();
    } catch { /* Analytics cannot break a successful cart mutation. */ }
  },
};
