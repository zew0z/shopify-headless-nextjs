import { createShopifyRequestContext, type ShopifyScriptsI18n } from "@shopify/hydrogen";
import { analyticsRequestOrigin } from "./analytics-config";
import { analyticsConsentQuery, PRIVATE_ANALYTICS_HEADERS, type AnalyticsConfig } from "./analytics-policy";

const COOKIE = /^\s*(_shopify_essential|_shopify_y|_shopify_s|_tracking_consent|_landing_page|_orig_referrer)=/;
export async function proxyAnalyticsConsent(request: Request, config: AnalyticsConfig | null, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const reply = (error: string, status: number) => Response.json({ error }, { status, headers: PRIVATE_ANALYTICS_HEADERS });
  if (!config) return reply("Analytics disabled", 403);
  const origin = analyticsRequestOrigin(request, config);
  if (!origin) return reply("Origin is not permitted", 403);
  if (request.method !== "POST") return reply("Method not allowed", 405);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply("JSON required", 415);
  if (Number(request.headers.get("content-length")) > 8192) return reply("Request too large", 413);
  let query: string | null;
  try {
    const text = await request.text();
    if (text.length > 8192) return reply("Request too large", 413);
    query = analyticsConsentQuery(JSON.parse(text));
  } catch { return reply("Invalid consent request", 400); }
  if (!query) return reply("Only the bounded consent operation is allowed", 400);
  const headers = new Headers({ "content-type": "application/json", "Shopify-Storefront-Consent-Management": "1" });
  const cookies = (request.headers.get("cookie") ?? "").split(";").filter(part => COOKIE.test(part));
  if (cookies.length) headers.set("cookie", cookies.join(";"));
  for (const name of ["Sec-GPC", "X-Shopify-UniqueToken", "X-Shopify-VisitToken"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const safeRequest = new Request(`${origin}/api/unstable/graphql.json`, { method: "POST", headers });
  const context = createShopifyRequestContext({ request: safeRequest, i18n: config.i18n as Required<Pick<ShopifyScriptsI18n, "country" | "language">> });
  context.applyStorefrontRequestHeaders(headers);
  try {
    const upstream = await fetchImpl(`https://${config.shop.myshopifyDomain}/api/unstable/graphql.json`, {
      method: "POST", headers, body: JSON.stringify({ query, variables: {} }), cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) return reply("Shopify consent unavailable", 502);
    const result = await upstream.json();
    const consent = result?.data?.consentManagement;
    if (result.errors?.length || !consent?.cookies) return reply("Incomplete consent response", 502);
    const responseHeaders = new Headers(PRIVATE_ANALYTICS_HEADERS);
    const eligible = new Headers();
    for (const cookie of upstream.headers.getSetCookie()) if (COOKIE.test(cookie)) eligible.append("set-cookie", cookie);
    context.consumeStorefrontResponseHeaders(eligible);
    context.applyResponseHeaders(responseHeaders);
    for (const [key, value] of Object.entries(PRIVATE_ANALYTICS_HEADERS)) responseHeaders.set(key, value);
    const out: Record<string, unknown> = {};
    for (const key of ["trackingConsentCookie", "cookieDomain", "landingPageCookie", "origReferrerCookie", "shopifyUnique", "shopifyVisit"]) out[key] = consent.cookies[key] ?? null;
    return Response.json({ data: { consentManagement: { cookies: out, customerAccountUrl: "" } } }, { headers: responseHeaders });
  } catch { return reply("Shopify consent failed or timed out", 502); }
}
