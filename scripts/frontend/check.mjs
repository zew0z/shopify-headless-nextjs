import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findSdkDir } from "../shopify/sdk-dir.mjs";
import { auditFrontend, isKitRoute } from "./audit.mjs";
import { listSourceFiles } from "./walk.mjs";

const CATALOGUE_CALL = /\b(getProducts?|getCollections?|getCollectionProducts|getProductRecommendations)\s*\(/;
const LAYOUT = /^(src\/)?app\/(.+\/)?layout\.[jt]sx?$/;
// The kit's cart client, which the wiring guide uses, calls /api/cart for the frontend.
const CART_CLIENT_IMPORT = /\bfrom\s+["'][^"']*lib\/shopify\/cart-client["']/;

/**
 * Whether a received frontend is really wired to Shopify, once the agent has
 * done the work. Each result names the places still to fix.
 */
export function checkWiring(dir) {
  const audit = auditFrontend(dir);
  const files = listSourceFiles(dir).filter((f) => !isKitRoute(dir, f));
  const text = Object.fromEntries(files.map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
  const result = (what, where) => ({ ok: where.length === 0, what, where });

  const appRoot = audit.stack.appRoot ?? "";
  const installed = Boolean(findSdkDir(dir)) && existsSync(path.join(dir, `${appRoot}app/api/cart/route.ts`));

  const dataImports = audit.dataReaders.map((r) => `${r.file}:${r.line} imports ${r.target}`);

  const uncached = audit.cachingOff
    .filter((c) => LAYOUT.test(c.file) || CATALOGUE_CALL.test(text[c.file] ?? ""))
    .map((c) => `${c.file}:${c.line} ${c.what}`);

  const usesCart = files.some((f) => text[f].includes("/api/cart") || CART_CLIENT_IMPORT.test(text[f]));
  const usesCheckoutUrl = files.some((f) => /\bcheckoutUrl\b/.test(text[f]));

  return [
    { ok: installed, what: "The Shopify SDK and /api/cart are installed", where: installed ? [] : ["run pnpm shop-setup kit-install from the kit"] },
    result("No page or component imports the hardcoded products", dataImports),
    result("No fake product APIs are called", audit.fakeApis.map((a) => `${a.file}:${a.line} ${a.kind === "route" ? `serves ${a.target}` : a.target}`)),
    result("Pages that show products are cached", uncached),
    { ok: audit.images.ok, what: "Shopify images are allowed", where: audit.images.ok ? [] : [audit.images.note] },
    result("The cart talks to Shopify and checkout uses Shopify's checkoutUrl", [
      ...(usesCart ? [] : ["nothing calls /api/cart"]),
      ...(usesCheckoutUrl ? [] : ["nothing uses cart.checkoutUrl"]),
    ]),
  ];
}
