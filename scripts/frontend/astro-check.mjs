import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listSourceFiles } from "./walk.mjs";

/** Heuristic wiring checks complement Astro's compiler and an actual cart/browser rehearsal. */
export function checkAstroWiring(dir, audit) {
  const files = listSourceFiles(dir);
  const sources = files.map((file) => ({ file, text: readFileSync(path.join(dir, file), "utf8") }));
  const result = (what, where) => ({ what, where, ok: where.length === 0 });
  const installed = existsSync(path.join(dir, "src/lib/shopify/astro/index.ts"));
  const bridge = sources.some(({ text }) => /\bcreate(Astro|Shopify)Commerce\s*\(/.test(text) && /lib\/shopify\/(astro|index)/.test(text));
  const privateBrowser = [];
  const uncached = [], cachedCarts = [];
  for (const { file, text } of sources) {
    const browser = file.endsWith(".astro") ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n") : /["']use client["']|\.(client|browser)\.[jt]sx?$/.test(text + file) ? text : "";
    if (/astro:env\/server|SHOPIFY_STOREFRONT_(PRIVATE_TOKEN|TOKEN|ACCESS_TOKEN)|SHOPIFY_ADMIN_TOKEN|from\s*["'][^"']*lib\/shopify\/(?:astro\/(?:index|provider|client|config)|astro["'])/.test(browser)) privateBrowser.push(`${file}: server Shopify code or settings in browser code`);
    if (/\.astro$/.test(file) && /\.(listProducts|searchProducts|getCollection|getProduct)\s*\(/.test(text) && !/Astro\.cache\.set\s*\(/.test(text)) uncached.push(`${file}: catalogue page needs Astro.cache.set with a commerce tag and finite freshness`);
    if (/cart|checkout/.test(file) && /Astro\.cache\.set\s*\(|Cache-Control[^\n]*public/.test(text)) cachedCarts.push(`${file}: buyer-specific cart or checkout must never use a shared page cache`);
  }
  const cart = sources.some(({ text }) => /createCartEndpoint\s*\(|\b(getCommerce|readCart|sessionFrom)\s*\(/.test(text));
  const checkout = sources.some(({ text }) => /createCartEndpoint\s*\(|checkout\.url\s*\(/.test(text));
  const place = (d) => `${d.file}:${d.line} ${d.what}`;
  return [
    result("Astro has a supported SSR configuration", audit.stack.supported ? [] : [audit.stack.reason]),
    result("The Astro Shopify adapter is installed and connected to the storefront", installed && bridge ? [] : ["run kit-install and explicitly connect the existing provider to createAstroCommerce; installation alone is not wiring"]),
    result("The cart uses the provider and Shopify hosted checkout", cart && checkout ? [] : ["connect the existing commerce cart and hosted checkout, or the standalone cart endpoint"]),
    result("Shopify credentials and server imports stay out of browser scripts", privateBrowser),
    result("Catalogue pages have Astro cache rules", uncached),
    result("Cart and checkout responses never use shared caches", cachedCarts),
    result("No page imports hardcoded products", audit.dataReaders.map((r) => `${r.file}:${r.line} imports ${r.target}`)),
    result("No fake product APIs are called", audit.fakeApis.map(place)),
    result("No typed shop claims, legal text or stock photos reach pages", audit.typedClaims.map((c) => `${c.file}:${c.line} ${c.kind}: ${c.what}`)),
    result("No invented ratings, stock or badges", audit.inventedFields.map(place)),
    result("Prices use the currency Shopify returns", audit.hardcodedMoney.map(place)),
    result("No card payment form", audit.paymentForms.map(place)),
  ];
}
