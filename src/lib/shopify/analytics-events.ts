/**
 * Shopify's analytics events, built and sent the way @shopify/hydrogen-react
 * 2026.4.4 does it (sendShopifyAnalytics and its two event schemas), copied so
 * the kit needs no extra package. Browser-safe: imports nothing.
 *
 * scripts/shopify/analytics-events.test.mjs compares these events with what that
 * package sent for the same input (scripts/shopify/fixtures/monorail-hydrogen-react.json).
 * When Shopify changes the format, regenerate the fixture from the new package
 * (docs/frontend-wiring.md, "Shopify analytics") and change this file to match.
 */

/** The hydrogen-react version this file copies. Sent as the event's asset version. */
export const ANALYTICS_FORMAT_VERSION = "2026.4.4";
export const MONORAIL_URL = "https://monorail-edge.shopifysvc.com/unstable/produce_batch";

const APP_IDS = { hydrogen: "6167201", headless: "12875497473" } as const;
const TREKKIE_PAGE_VIEW = "trekkie_storefront_page_view/1.4";
const CUSTOMER_TRACKING = "custom_storefront_customer_tracking/1.2";

/** What Shopify needs to know about the shop. */
export interface AnalyticsShop {
  /** gid://shopify/Shop/<id> */
  shopId: string;
  currency: string;
  acceptedLanguage: string;
}

/** The visitor's page and browser, and Shopify's ids for the visitor and the visit. */
export interface BrowserParameters {
  uniqueToken: string;
  visitToken: string;
  url: string;
  path: string;
  search: string;
  referrer: string;
  title: string;
  userAgent: string;
  navigationType: string;
  navigationApi: string;
}

/** The visitor's choices, as Shopify's Customer Privacy API reports them. */
export interface ConsentFlags {
  hasUserConsent: boolean;
  analyticsAllowed: boolean;
  marketingAllowed: boolean;
  saleOfDataAllowed: boolean;
  ccpaEnforced: boolean;
  gdprEnforced: boolean;
}

export interface AnalyticsProduct {
  productGid: string;
  variantGid?: string;
  name: string;
  variantName?: string;
  brand: string;
  category?: string;
  /** Shopify's decimal string, e.g. "12.50". */
  price: string;
  sku?: string;
  quantity?: number;
}

export interface AnalyticsPayload extends AnalyticsShop, BrowserParameters, ConsentFlags {
  shopifySalesChannel?: keyof typeof APP_IDS;
  assetVersionId?: string;
  /** Only Hydrogen storefronts have one. */
  storefrontId?: string;
  customerId?: string;
  canonicalUrl?: string;
  pageType?: string;
  resourceId?: string;
  products?: AnalyticsProduct[];
  totalValue?: number;
  cartId?: string;
}

export interface MonorailEvent {
  schema_id: string;
  payload: Record<string, unknown>;
  metadata: { event_created_at_ms: number };
}

type Data = Record<string, unknown>;

function wrap(schemaId: string, payload: Data): MonorailEvent {
  return { schema_id: schemaId, payload, metadata: { event_created_at_ms: Date.now() } };
}

/** gid://shopify/Product/123 -> { id: "123", resource: "Product" }. A cart's id keeps its ?key=. */
export function parseGid(gid: string | undefined): { id: string; resource: string | null } {
  if (typeof gid !== "string") return { id: "", resource: null };
  try {
    const { search, pathname, hash } = new URL(gid);
    const parts = pathname.split("/");
    const last = parts[parts.length - 1];
    const resource = parts[parts.length - 2];
    if (!last || !resource) return { id: "", resource: null };
    return { id: `${last}${search}${hash}`, resource };
  } catch {
    return { id: "", resource: null };
  }
}

/** Copies the truthy values into `into`, as Shopify's code does: 0, "", NaN and null are left out. */
function addIf(values: Data, into: Data): Data {
  for (const [key, value] of Object.entries(values)) if (value) into[key] = value;
  return into;
}

const numericId = (gid: string | undefined) => parseInt(parseGid(gid).id);
const customerNumber = (gid: string | undefined) => parseInt(parseGid(gid).id || "0");

/** Shopify's event id: the time in hex, then random hex in a fixed pattern. */
function eventId(): string {
  const now = (Date.now() >>> 0) + ((globalThis.performance?.now() ?? 0) >>> 0);
  const time = Math.abs(now).toString(16).toLowerCase().padStart(8, "0");
  const random = new Uint16Array(31);
  globalThis.crypto.getRandomValues(random);
  let i = 0;
  const hash = "xxxx-4xxx-xxxx-xxxxxxxxxxxx".replace(/x/g, () => (random[i++] % 16).toString(16)).toUpperCase();
  return `${time}-${hash}`;
}

/** Shopify does not count visits from the shop owner's own preview hosts. */
function isMerchantRequest(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.includes("myshopify.dev") || host === "localhost";
  } catch {
    return false;
  }
}

function trekkiePageView(p: AnalyticsPayload): MonorailEvent {
  const { id, resource } = parseGid(p.resourceId);
  return wrap(
    TREKKIE_PAGE_VIEW,
    addIf(
      {
        pageType: p.pageType,
        customerId: customerNumber(p.customerId),
        resourceType: resource ? resource.toLowerCase() : undefined,
        resourceId: parseInt(id),
      },
      {
        appClientId: APP_IDS[p.shopifySalesChannel ?? "headless"],
        isMerchantRequest: isMerchantRequest(p.url),
        hydrogenSubchannelId: p.storefrontId || "0",
        isPersistentCookie: p.hasUserConsent,
        uniqToken: p.uniqueToken,
        visitToken: p.visitToken,
        microSessionId: eventId(),
        microSessionCount: 1,
        url: p.url,
        path: p.path,
        search: p.search,
        referrer: p.referrer,
        title: p.title,
        shopId: numericId(p.shopId),
        currency: p.currency,
        contentLanguage: p.acceptedLanguage || "en",
      }
    )
  );
}

function customerTracking(p: AnalyticsPayload, values: Data): MonorailEvent {
  return wrap(
    CUSTOMER_TRACKING,
    addIf(values, {
      source: p.shopifySalesChannel || "headless",
      asset_version_id: p.assetVersionId || ANALYTICS_FORMAT_VERSION,
      hydrogenSubchannelId: p.storefrontId || "0",
      is_persistent_cookie: p.hasUserConsent,
      deprecated_visit_token: p.visitToken,
      unique_token: p.uniqueToken,
      event_time: Date.now(),
      event_id: eventId(),
      event_source_url: p.url,
      referrer: p.referrer,
      user_agent: p.userAgent,
      navigation_type: p.navigationType,
      navigation_api: p.navigationApi,
      shop_id: numericId(p.shopId),
      currency: p.currency,
      ccpa_enforced: p.ccpaEnforced || false,
      gdpr_enforced: p.gdprEnforced || false,
      gdpr_enforced_as_string: p.gdprEnforced ? "true" : "false",
      analytics_allowed: p.analyticsAllowed || false,
      marketing_allowed: p.marketingAllowed || false,
      sale_of_data_allowed: p.saleOfDataAllowed || false,
    })
  );
}

const pageFields = (p: AnalyticsPayload) => ({ canonical_url: p.canonicalUrl || p.url, customer_id: customerNumber(p.customerId) });

/** Each product is a JSON string, keys in Shopify's order. */
function productStrings(products: AnalyticsProduct[] | undefined): string[] {
  return (products ?? []).map((x) =>
    JSON.stringify(
      addIf(
        { variant_gid: x.variantGid, category: x.category, sku: x.sku, product_id: numericId(x.productGid), variant_id: numericId(x.variantGid) },
        { product_gid: x.productGid, name: x.name, variant: x.variantName || "", brand: x.brand, price: parseFloat(x.price), quantity: Number(x.quantity || 0) }
      )
    )
  );
}

/** A page view: Shopify's classic page view plus page_rendered (hydrogen-react's PAGE_VIEW_2). */
export function pageViewEvents(p: AnalyticsPayload): MonorailEvent[] {
  return [trekkiePageView(p), customerTracking(p, { event_name: "page_rendered", ...pageFields(p) })];
}

export function productViewEvents(p: AnalyticsPayload): MonorailEvent[] {
  return [
    customerTracking(p, {
      event_name: "product_page_rendered",
      ...pageFields(p),
      products: productStrings(p.products),
      total_value: p.totalValue,
    }),
  ];
}

export function addToCartEvents(p: AnalyticsPayload): MonorailEvent[] {
  const cart = parseGid(p.cartId);
  return [
    customerTracking(p, {
      event_name: "product_added_to_cart",
      customerId: p.customerId,
      cart_token: cart.id ? `${cart.id}` : null,
      total_value: p.totalValue,
      products: productStrings(p.products),
      customer_id: customerNumber(p.customerId),
    }),
  ];
}

/**
 * Sends events to Shopify. Returns whether Shopify took them all. Never throws:
 * a lost analytics event must not break the page.
 */
export async function sendToShopify(events: MonorailEvent[], send: typeof fetch = fetch): Promise<boolean> {
  if (!events.length) return true;
  if (typeof navigator !== "undefined" && /Chrome-Lighthouse/.test(navigator.userAgent ?? "")) return true;
  try {
    const res = await send(MONORAIL_URL, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ events, metadata: { event_sent_at_ms: Date.now() } }),
    });
    if (!res.ok) throw new Error(`Shopify answered ${res.status}`);
    const text = await res.text();
    const results: Array<{ status: number; message?: string }> = text ? (JSON.parse(text).result ?? []) : [];
    const refused = results.filter((r) => r.status !== 200);
    if (refused.length) console.warn("[Shopify analytics] Shopify refused an event:", refused.map((r) => r.message).join("; "));
    return refused.length === 0;
  } catch (err) {
    console.warn("[Shopify analytics] Could not send events to Shopify:", err);
    return false;
  }
}
