import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findSdkDir } from "../shopify/sdk-dir.mjs";
import { auditFrontend, isKitRoute } from "./audit.mjs";
import { findImporters } from "./sources.mjs";
import { listSourceFiles } from "./walk.mjs";

const CATALOGUE_CALL = /\b(getProducts?|getProductsPage|getCollections?|getCollectionProducts|getCollectionProductsPage|searchProducts|getProductRecommendations|getShop|getMenu|getPolicies|getPolicy|getPage)\s*\(/;
const LAYOUT = /^(src\/)?app\/(.+\/)?layout\.[jt]sx?$/;
// The kit's cart client, which the wiring guide uses, calls /api/cart for the frontend.
const CART_CLIENT_IMPORT = /\bfrom\s+["'][^"']*lib\/shopify\/cart-client["']/;
// The kit's cart store and provider: their checkout() sends the customer to cart.checkoutUrl.
const KIT_CART_IMPORT = /\bfrom\s+["'][^"']*lib\/shopify\/cart-(provider|store)["']/;
const PAGE_OR_COMPONENT = /^(src\/)?(app|components)\//;
// One file out of the caching check, with its reason: the check prints both, so the exception stays visible.
const NO_PRODUCTS_MARK = /\/\/\s*shop-setup-check:\s*shows no products\s*-\s*(.+)/;

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

  // A marked file that reads Shopify itself does show shop data, so its marker does not count.
  const markers = files.map((f) => [f, NO_PRODUCTS_MARK.exec(text[f])?.[1]?.trim()]).filter(([, why]) => why);
  const marked = new Map(markers.filter(([f]) => !CATALOGUE_CALL.test(text[f])));
  const wronglyMarked = new Set(markers.filter(([f]) => !marked.has(f)).map(([f]) => f));
  const uncached = audit.cachingOff
    .filter((c) => !marked.has(c.file))
    .filter((c) => LAYOUT.test(c.file) || CATALOGUE_CALL.test(text[c.file] ?? ""))
    .map((c) => `${c.file}:${c.line} ${c.what}${wronglyMarked.has(c.file) ? " (marked as showing no products, but it reads Shopify)" : ""}`);

  const usesKitCart = files.some((f) => KIT_CART_IMPORT.test(text[f]));
  const usesCart = usesKitCart || files.some((f) => text[f].includes("/api/cart") || CART_CLIENT_IMPORT.test(text[f]));
  const usesCheckoutUrl = usesKitCart || files.some((f) => /\bcheckoutUrl\b/.test(text[f]));

  // A file nothing imports is never shown to a customer, unless it sits in app/ or components/.
  const importers = findImporters(dir, files);
  const reachesCustomers = (f) => importers.get(f)?.length > 0 || PAGE_OR_COMPONENT.test(f);
  const place = (d) => `${d.file}:${d.line} ${d.what}`;

  return [
    { ok: installed, what: "The Shopify SDK and /api/cart are installed", where: installed ? [] : ["run pnpm shop-setup kit-install from the kit"] },
    result("No page or component imports the hardcoded products", dataImports),
    result("No fake product APIs are called", audit.fakeApis.map((a) => `${a.file}:${a.line} ${a.kind === "route" ? `serves ${a.target}` : a.target}`)),
    { ...result("Pages that show products are cached", uncached), notes: [...marked].map(([f, why]) => `${f}: not checked for caching: ${why}`) },
    { ok: audit.images.ok, what: "Shopify images are allowed", where: audit.images.ok ? [] : [audit.images.note] },
    result("The cart talks to Shopify and checkout uses Shopify's checkoutUrl", [
      ...(usesCart ? [] : ["nothing calls /api/cart"]),
      ...(usesCheckoutUrl ? [] : ["nothing uses cart.checkoutUrl"]),
    ]),
    result("Prices use the currency Shopify returns, not a hardcoded symbol", audit.hardcodedMoney.map((m) => `${m.file}:${m.line} ${m.what}`)),
    result("No page or component imports hardcoded menus, policies, pages or store claims", audit.siteData.filter((d) => importers.get(d.file)?.length).map(place)),
    result(
      "No shop name, store claims, shop details, legal text or stock photos typed into pages or components",
      audit.typedClaims.map((c) => `${c.file}:${c.line} ${c.kind}: ${c.what}`)
    ),
    result("No invented ratings, reviews, stock or badges", audit.inventedFields.filter((d) => reachesCustomers(d.file)).map(place)),
    result("No payment form: Shopify's checkout takes the payment", audit.paymentForms.map(place)),
  ];
}

const SHOPIFY_IMAGE = "cdn.shopify.com";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The site's own product route ("/item/"), or by default /product/<handle> or /products/<handle>.
const productLink = (productPath) =>
  productPath
    ? new RegExp(`href=["'](${escapeRe(productPath.replace(/^\/?/, "/").replace(/\/?$/, "/"))}[^"'?#/]+)["']`)
    : /href=["'](\/products?\/[^"'?#/]+)["']/;

async function loadPage(url, fetchFn) {
  try {
    const res = await fetchFn(url);
    const html = await res.text();
    if (res.status !== 200) return { problem: `${url} answered ${res.status}` };
    if (!html.includes(SHOPIFY_IMAGE)) return { html, problem: `${url} shows no image from ${SHOPIFY_IMAGE}` };
    return { html };
  } catch (error) {
    return { problem: `${url} could not be reached: ${error instanceof Error ? error.message : error}` };
  }
}

/**
 * Looks at the running site: the home page and the first product it links to
 * must load and show Shopify's images. Network errors are failing results.
 * `productPath` is the site's product route when it is not /product/ or /products/.
 */
export async function smokeSite(url, fetchFn = fetch, { productPath } = {}) {
  const base = url.replace(/\/+$/, "");
  const home = await loadPage(`${base}/`, fetchFn);
  const results = [{ ok: !home.problem, what: "The home page loads and shows Shopify images", where: home.problem ? [home.problem] : [] }];
  const product = (what, where) => results.push({ ok: where.length === 0, what, where });
  const productPage = "A product page loads and shows Shopify images";
  if (home.html === undefined) {
    product(productPage, ["not checked: the home page did not load"]);
    return results;
  }
  const link = productLink(productPath).exec(home.html);
  if (!link) {
    product(productPage, [`no product link on the home page (looked for ${productPath ?? "/product/ or /products/"}; pass --product-path=/your-route/)`]);
    return results;
  }
  const page = await loadPage(`${base}${link[1]}`, fetchFn);
  product(productPage, page.problem ? [page.problem] : []);
  return results;
}
