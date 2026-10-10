import type { CommerceProvider, CommerceSession, CartResponse } from "./commerce-types";

export interface CartContext {
  request: Request;
  url: URL;
  clientAddress: string;
  cookies: {
    get(name: string): { value: string } | undefined;
    set(name: string, value: string, options: { path: string; httpOnly: boolean; secure: boolean; sameSite: "lax"; maxAge: number }): void;
    delete(name: string, options: { path: string }): void;
  };
}

/** Optional standalone API. Template integrations keep their existing commerce form routes and cookie handler. */
export function createCartEndpoint(provider: CommerceProvider, { language = "en", cookie = "shopify_cart" } = {}) {
  const publicCodes = new Set(["invalid", "rateLimited", "unavailable", "notFound", "backend", "coupon", "adjusted"]);
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  return async (context: CartContext): Promise<Response> => {
    const { request, url, cookies } = context;
    const token = cookies.get(cookie)?.value ?? null;
    const session: CommerceSession = { token, lang: language, clientAddress: context.clientAddress };
    const remember = (response: CartResponse) => {
      if (response.token) cookies.set(cookie, response.token, { path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", maxAge: 60 * 60 * 24 * 10 });
      else if (!response.error) cookies.delete(cookie, { path: "/" });
      // Cart ids contain an access key. The browser gets cart display data only.
      return reply({ cart: response.cart, ...(response.error && { error: { code: publicCodes.has(response.error.code) ? response.error.code : "backend" } }) });
    };
    try {
      if (request.method === "GET") return remember(await provider.getCart(session));
      if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
      if (request.headers.get("origin") !== url.origin) return reply({ error: "Invalid origin" }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Use application/json" }, 415);
      const text = await request.text();
      if (text.length > 16384) return reply({ error: "Request too large" }, 413);
      let data: Record<string, unknown>;
      try { const value: unknown = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); data = value as Record<string, unknown>; }
      catch { return reply({ error: "Invalid request" }, 400); }
      const quantity = data.quantity;
      const validQuantity = typeof quantity === "number" && Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= 1000;
      const id = typeof data.lineId === "string" && data.lineId.length <= 512 ? data.lineId : "";
      switch (data.action) {
        case "get": return remember(await provider.getCart(session));
        case "add": {
          if (!validQuantity || quantity < 1 || typeof data.merchandiseId !== "string" || !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(data.merchandiseId)) return reply({ error: "A variant id and positive quantity are required" }, 400);
          return remember(await provider.addLine(session, { merchandiseId: data.merchandiseId, options: [], quantity }));
        }
        case "update": if (id && validQuantity && quantity > 0) return remember(await provider.updateLine(session, id, quantity)); break;
        case "remove": if (id) return remember(await provider.removeLine(session, id)); break;
        case "discount": case "discount-remove": {
          const code = typeof data.code === "string" ? data.code.trim() : "";
          if (code && code.length <= 100) return remember(await (data.action === "discount" ? provider.applyDiscount(session, code) : provider.removeDiscount(session, code)));
          break;
        }
        case "checkout": {
          if (provider.checkout.kind !== "hosted") return reply({ error: "Hosted checkout is required" }, 400);
          return reply({ checkoutUrl: await provider.checkout.url(session) });
        }
      }
      return reply({ error: "Invalid cart action" }, 400);
    } catch {
      // Keep the session on network failures, and never expose a token or buyer payload.
      return reply({ error: "Shopify is unavailable. Check your cart before trying again." }, 502);
    }
  };
}
