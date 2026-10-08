/**
 * Shopify's Customer Privacy API (and, if asked, Shopify's own cookie banner),
 * loaded the way Hydrogen 2026.4 loads it, for a storefront that is not Hydrogen.
 * Browser-safe: imports only types.
 *
 * The API asks Shopify for the visitor's consent and ids at
 * /api/<version>/graphql.json on the page's own host, so the site needs the
 * storefront proxy route (app/api/[version]/graphql.json/route.ts). Shopify's
 * cookies then belong to the site, and checkout on checkout.<domain> shares them.
 */
import type { ConsentFlags } from "./analytics-events";

export const CONSENT_API = "https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js";
export const CONSENT_API_WITH_BANNER = "https://cdn.shopify.com/shopifycloud/privacy-banner/storefront-banner.js";
const SCRIPT_ID = "customer-privacy-api";

type Choice = "yes" | "no" | "";

/** The parts of Shopify's API this kit uses. */
export interface CustomerPrivacy {
  consentStatus?: "loading" | "loaded";
  config?: Record<string, unknown>;
  currentVisitorConsent(): Partial<Record<"marketing" | "analytics" | "preferences" | "sale_of_data", Choice>>;
  analyticsProcessingAllowed(): boolean;
  marketingAllowed(): boolean;
  saleOfDataAllowed(): boolean;
  shouldShowBanner(): boolean;
  setTrackingConsent(consent: Record<string, unknown>, callback?: (result?: { error: string }) => void): void;
  __internal?: {
    uniqueToken?(options: object): string | undefined;
    visitToken?(options: object): string | undefined;
  };
}

export interface PrivacyBanner {
  loadBanner(options?: object): void;
  showPreferences(options?: object): void;
}

export interface ShopifyWindow {
  location?: { host: string };
  Shopify?: { customerPrivacy?: Partial<CustomerPrivacy>; country?: string; locale?: string };
  privacyBanner?: PrivacyBanner;
}

export interface PrivacyOptions {
  /** The public Storefront API token. */
  storefrontAccessToken: string;
  /** Where checkout lives, e.g. checkout.example.com (the shop's primary domain). */
  checkoutDomain: string;
  /** Show Shopify's cookie banner, set up in the admin under Settings > Customer privacy. */
  withPrivacyBanner?: boolean;
  country?: string;
  /** Language code, e.g. "EN". */
  locale?: string;
}

/**
 * The domain the site and checkout share, for cookies: "example.com" for
 * www.example.com and checkout.example.com. Undefined when they share less than
 * two labels (a bare ".com" is no use as a cookie domain).
 */
export function sharedDomain(host: string, checkoutDomain: string): string | undefined {
  const a = host.split(":")[0].split(".").reverse();
  const b = checkoutDomain.split(":")[0].split(".").reverse();
  const same: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) same.push(a[i]);
  return same.length >= 2 ? same.reverse().join(".") : undefined;
}

const browserWindow = () => (typeof window === "undefined" ? {} : (window as unknown as ShopifyWindow));

/** Shopify's API once its script has loaded, else null (before that it is only our config object). */
export function customerPrivacy(win: ShopifyWindow = browserWindow()): CustomerPrivacy | null {
  const cp = win.Shopify?.customerPrivacy;
  return typeof cp?.setTrackingConsent === "function" ? (cp as CustomerPrivacy) : null;
}

export function privacyBanner(win: ShopifyWindow = browserWindow()): PrivacyBanner | null {
  const banner = win.privacyBanner;
  return typeof banner?.loadBanner === "function" && typeof banner.showPreferences === "function" ? banner : null;
}

/** Shopify has loaded the visitor's consent and it allows analytics. */
export function analyticsAllowed(cp: CustomerPrivacy | null): boolean {
  try {
    if (!cp || cp.consentStatus !== "loaded") return false;
    if (cp.currentVisitorConsent?.().analytics !== "yes") return false;
    return cp.analyticsProcessingAllowed?.() ?? false;
  } catch {
    return false;
  }
}

/** A banner is due and the visitor has not chosen anything about analytics, marketing or preferences yet. */
export function waitingForChoice(cp: CustomerPrivacy): boolean {
  if (!cp.shouldShowBanner()) return false;
  const consent = cp.currentVisitorConsent();
  return ![consent.marketing, consent.analytics, consent.preferences].some((v) => v === "yes" || v === "no");
}

export function consentFlags(cp: CustomerPrivacy): ConsentFlags {
  const analytics = cp.analyticsProcessingAllowed();
  const marketing = cp.marketingAllowed();
  const saleOfData = cp.saleOfDataAllowed();
  return {
    hasUserConsent: analyticsAllowed(cp),
    analyticsAllowed: analytics,
    marketingAllowed: marketing,
    saleOfDataAllowed: saleOfData,
    ccpaEnforced: !saleOfData,
    gdprEnforced: !(marketing && analytics),
  };
}

/** Shopify's ids for the visitor and the visit. The old _shopify_y/_s cookies count only when the API is absent. */
export function trackingValues(
  win: ShopifyWindow = browserWindow(),
  cookie: string = typeof document === "undefined" ? "" : document.cookie
): { uniqueToken: string; visitToken: string } {
  const privacy = win.Shopify?.customerPrivacy;
  const internal = privacy?.__internal;
  // Shopify's options for these readers; the tag names the integration Hydrogen's analytics use.
  const options = { generateFallback: privacy?.config?.asyncConsent === true, tag: "hydrogen:classic" };
  return {
    uniqueToken: internal?.uniqueToken ? (internal.uniqueToken(options) ?? "") : (cookie.match(/\b_shopify_y=([^;]+)/)?.[1] ?? ""),
    visitToken: internal?.visitToken ? (internal.visitToken(options) ?? "") : (cookie.match(/\b_shopify_s=([^;]+)/)?.[1] ?? ""),
  };
}

// Shopify's own objects are wrapped once; a later mount only swaps the settings they use.
const wrapped = new WeakMap<object, { config: Record<string, unknown> }>();

function wrapConsent(cp: CustomerPrivacy, config: Record<string, unknown>) {
  const seen = wrapped.get(cp);
  if (seen) {
    seen.config = config;
    return;
  }
  const state = { config };
  wrapped.set(cp, state);
  const original = cp.setTrackingConsent;
  cp.setTrackingConsent = (consent, callback) => {
    // Language and country are for the banner only.
    const headless = { ...state.config };
    delete headless.locale;
    delete headless.country;
    original.call(cp, { ...headless, headlessStorefront: true, ...consent }, callback);
  };
}

function wrapBanner(banner: PrivacyBanner, config: Record<string, unknown>) {
  const seen = wrapped.get(banner);
  if (seen) {
    seen.config = config;
    return;
  }
  const state = { config };
  wrapped.set(banner, state);
  const { loadBanner, showPreferences } = banner;
  banner.loadBanner = (options) => loadBanner.call(banner, { ...state.config, ...options });
  banner.showPreferences = (options) => showPreferences.call(banner, { ...state.config, ...options });
}

/**
 * Loads Shopify's Customer Privacy API, set up for a headless site. Calls
 * onReady once the visitor's consent is known (and the banner is there, when
 * asked for), and onConsent after every choice the visitor makes. Returns a
 * function that stops listening.
 */
export function loadCustomerPrivacy(
  options: PrivacyOptions,
  handlers: { onReady(): void; onConsent(): void },
  win: ShopifyWindow = browserWindow(),
  doc: Document = document
): () => void {
  const host = win.location?.host ?? "";
  const root = sharedDomain(host, options.checkoutDomain);
  const config: Record<string, unknown> = {
    // Consent requests go to this site's own proxy: cross-site requests carry no cookies, so the visitor would be new on every page.
    checkoutRootDomain: host,
    storefrontRootDomain: root ? `.${root}` : undefined,
    storefrontAccessToken: options.storefrontAccessToken,
    country: options.country,
    locale: options.locale,
  };

  // Shopify's scripts read this while they load, so it goes in first.
  const shopify = (win.Shopify ??= {});
  const privacy = (shopify.customerPrivacy ??= {});
  privacy.config = {
    ...privacy.config,
    isHeadless: true,
    asyncConsent: true,
    asyncVisitorState: true,
    consentDomain: host,
    storefrontAccessToken: options.storefrontAccessToken,
  };
  if (options.country) shopify.country = options.country;
  if (options.locale) shopify.locale = options.locale.toLowerCase();

  let active = true;
  let notified = false;
  const check = () => {
    if (!active) return false;
    const cp = customerPrivacy(win);
    const banner = privacyBanner(win);
    if (cp) wrapConsent(cp, config);
    if (options.withPrivacyBanner && banner) wrapBanner(banner, config);
    if (cp?.consentStatus !== "loaded" || (options.withPrivacyBanner && !banner)) return false;
    if (!notified) {
      notified = true;
      handlers.onReady();
    }
    return true;
  };
  const collected = () => {
    if (check()) handlers.onConsent();
  };

  doc.addEventListener("consentTrackingApiLoaded", check);
  doc.addEventListener("visitorConsentCollected", collected);
  if (!check()) {
    // Shopify's ready event can come before the banner is in place, so the script's own load is checked too.
    const existing = doc.getElementById(SCRIPT_ID);
    if (existing) existing.addEventListener("load", check);
    else {
      const script = doc.createElement("script");
      script.id = SCRIPT_ID;
      script.src = options.withPrivacyBanner ? CONSENT_API_WITH_BANNER : CONSENT_API;
      script.async = true;
      script.addEventListener("load", check);
      script.addEventListener("error", () => {
        if (active) console.error("[Shopify analytics] Could not load Shopify's Customer Privacy API from cdn.shopify.com, so no visit is counted.");
      });
      doc.head.appendChild(script);
    }
  }

  return () => {
    active = false;
    doc.removeEventListener("consentTrackingApiLoaded", check);
    doc.removeEventListener("visitorConsentCollected", collected);
  };
}
