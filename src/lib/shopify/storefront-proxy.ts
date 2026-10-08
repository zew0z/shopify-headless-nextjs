/**
 * Passes the browser's Storefront API requests through the site's own domain,
 * as Hydrogen's request handler does. Shopify's Customer Privacy API (privacy.ts)
 * asks for the visitor's consent and ids at /api/<version>/graphql.json on the
 * page's own host; without this, those requests fail and Shopify counts no
 * visitors. The route is app/api/[version]/graphql.json/route.ts. Server-only.
 */
import { shopifyConfig } from "./config";

const VERSION = /^(unstable|2\d{3}-\d{2})$/;

// Only these reach Shopify: unexpected headers get 403s. Hydrogen's list.
const FORWARDED = [
  "accept",
  "accept-language",
  "access-control-request-headers",
  "access-control-request-method",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "shopify-storefront-consent-management",
  "x-shopify-storefront-access-token",
  "x-shopify-uniquetoken",
  "x-shopify-visittoken",
];

// Node's fetch has already unpacked the body, so passing these on would make the browser unpack it again.
// Server-Timing can carry tracking values Hydrogen also keeps out of the browser.
const DROPPED_FROM_ANSWER = ["content-encoding", "content-length", "transfer-encoding", "server-timing"];

export async function forwardStorefrontRequest(
  request: Request,
  version: string,
  options: { domain?: string; fetch?: typeof fetch } = {}
): Promise<Response> {
  if (!VERSION.test(version)) return new Response("Not found", { status: 404 });
  const domain = options.domain ?? shopifyConfig.domain;
  if (!domain) return Response.json({ errors: [{ message: "Shopify is not configured" }] }, { status: 503 });

  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip");
  if (ip) headers.set("x-forwarded-for", ip);

  try {
    const answer = await (options.fetch ?? fetch)(`https://${domain}/api/${version}/graphql.json`, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    });
    const out = new Headers(answer.headers);
    for (const name of DROPPED_FROM_ANSWER) out.delete(name);
    return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out });
  } catch (err) {
    console.error("[Shopify] The Storefront API proxy could not reach Shopify:", err);
    return Response.json({ errors: [{ message: "Shopify could not be reached" }] }, { status: 502 });
  }
}
