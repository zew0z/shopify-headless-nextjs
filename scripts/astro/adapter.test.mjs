import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
register("../test-support/ts-hooks.mjs", import.meta.url);
const root = existsSync("adapters/astro/provider.ts") ? "adapters/astro" : "src/lib/shopify/astro";
const load = (name) => import(pathToFileURL(path.resolve(root, `${name}.ts`)).href);
const { createStorefront } = await load("client");
const { readShopifyConfig } = await load("config");
const { createShopifyCommerce } = await load("provider");
const { createCartEndpoint } = await load("routes");
const { createCartClient } = await load("browser");
const { createShopifyContent } = await load("content");
const config = { domain: "fixture.myshopify.com", apiVersion: "2026-07", publicToken: "test-public", privateToken: "" };
const money = (amount) => ({ amount, currencyCode: "CAD" });
const image = { url: "https://cdn.shopify.com/fixture.jpg", altText: null, width: 800, height: 600 };
const item = { id: "gid://shopify/Product/1", handle: "fixture", title: "Fixture", vendor: "", availableForSale: true, featuredImage: image, priceRange: { minVariantPrice: money("25"), maxVariantPrice: money("30") }, compareAtPriceRange: { minVariantPrice: money("0") } };
const pageInfo = { hasNextPage: true, hasPreviousPage: false, endCursor: "next", startCursor: "previous" };
const response = (data) => Response.json({ data });
const session = { lang: "en", clientAddress: "192.0.2.1", token: "gid://shopify/Cart/1?key=test" };
const cart = { id: session.token, checkoutUrl: "https://fixture.myshopify.com/checkouts/test", totalQuantity: 1, cost: { subtotalAmount: money("25"), totalAmount: money("25"), totalTaxAmount: null }, lines: { nodes: [] }, discountCodes: [] };
const clientOptions = (fetchFn, extra = {}) => ({ getConfig: () => config, fetch: fetchFn, sleep: async () => {}, retries: 0, ...extra });

test("configuration is explicit, validates host/version, and refuses Admin credentials", () => {
  const read = (values) => readShopifyConfig((key) => values[key]);
  assert.throws(() => read({}), /SHOPIFY_STORE_DOMAIN/);
  assert.equal(read({ SHOPIFY_STORE_DOMAIN: "mock.shop" }).domain, "mock.shop");
  assert.equal(read({ SHOPIFY_STORE_DOMAIN: "fixture", SHOPIFY_STOREFRONT_TOKEN: "public" }).domain, config.domain);
  for (const host of ["127.0.0.1", "fixture.myshopify.com/private", "fixture.myshopify.com@evil.test", "evil.test"]) assert.throws(() => read({ SHOPIFY_STORE_DOMAIN: host, SHOPIFY_STOREFRONT_TOKEN: "public" }), undefined, host);
  assert.throws(() => read({ SHOPIFY_STORE_DOMAIN: config.domain, SHOPIFY_STOREFRONT_TOKEN: "shpat_test" }), /Admin token/);
  assert.throws(() => read({ SHOPIFY_STORE_DOMAIN: config.domain, SHOPIFY_STOREFRONT_TOKEN: "public", SHOPIFY_API_VERSION: "latest" }), /quarterly/);
});

test("private tokens, language and buyer IP stay scoped to each concurrent request", async () => {
  const calls = [];
  const api = createStorefront(clientOptions(async (url, init) => { calls.push({ url, ...init, body: JSON.parse(init.body) }); return response({ ok: true }); }, { country: "ca", getConfig: () => ({ ...config, privateToken: "private-test" }) }));
  await Promise.all([api({ query: "query Fixture { shop { name } }", lang: "el", buyerIp: "192.0.2.1" }), api({ query: "query Fixture { shop { name } }", lang: "en", buyerIp: "192.0.2.2" })]);
  assert.deepEqual(calls.map((c) => c.headers["Shopify-Storefront-Buyer-IP"]), ["192.0.2.1", "192.0.2.2"]);
  assert.deepEqual(calls.map((c) => c.body.variables.language), ["EL", "EN"]);
  assert.equal(calls[0].body.variables.country, "CA");
  assert.equal(calls[0].headers["Shopify-Storefront-Private-Token"], "private-test");
  assert.equal(calls[0].headers["X-Shopify-Storefront-Access-Token"], undefined);
  assert.equal(calls[0].cache, "no-store");
  assert.equal(calls[0].next, undefined);
});

test("explicit public mock never receives real-store tokens or buyer IP", async () => {
  const api = createStorefront(clientOptions(async (url, init) => {
    assert.equal(url, "https://mock.shop/api");
    assert.equal(init.headers["Shopify-Storefront-Private-Token"], undefined);
    assert.equal(init.headers["X-Shopify-Storefront-Access-Token"], undefined);
    assert.equal(init.headers["Shopify-Storefront-Buyer-IP"], undefined);
    return response({ ok: true });
  }, { getConfig: () => ({ ...config, domain: "mock.shop", privateToken: "test-private" }) }));
  await api({ query: "query Fixture { shop { name } }", lang: "en", buyerIp: session.clientAddress });
});

test("reads retry but ambiguous cart mutations are never replayed", async () => {
  let calls = 0;
  const api = createStorefront(clientOptions(async () => { calls++; if (calls === 1) throw new Error("fetch failed"); return response({ ok: true }); }, { retries: 2 }));
  await api({ query: "query Fixture { shop { name } }", lang: "en" });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(api({ query: "mutation Fixture { cartCreate { cart { id } } }", lang: "en" }), /cart has been kept/);
  assert.equal(calls, 1);
});

test("GraphQL and HTTP failures do not expose raw buyer payloads", async () => {
  for (const failure of [Response.json({ errors: [{ message: "private-buyer@example.test" }] }), new Response("private-token", { status: 500 }), Response.json({})]) {
    const api = createStorefront(clientOptions(async () => failure));
    await assert.rejects(api({ query: "query Fixture { shop { name } }", lang: "en" }), (error) => !/private-buyer|private-token/.test(error.message));
  }
});

test("template product lists retain currencies and cursors, and hide a non-discount", async () => {
  const calls = [];
  const provider = createShopifyCommerce(clientOptions(async (url, init) => { calls.push(JSON.parse(init.body)); return response({ products: { nodes: [item], pageInfo } }); }));
  const page = await provider.listProducts({ lang: "en", pageSize: 12, sort: "price-asc", after: "cursor" });
  assert.equal(page.products[0].price.currencyCode, "CAD");
  assert.equal(page.products[0].compareAtPrice, null);
  assert.equal(page.pageInfo.nextCursor, "next");
  assert.equal(calls[0].variables.first, 12);
  assert.equal(calls[0].variables.after, "cursor");
  assert.equal(calls[0].variables.sortKey, "PRICE");
  await provider.listProducts({ lang: "en", pageSize: 12, sort: "newest", before: "previous" });
  assert.equal(calls[1].variables.last, 12);
  assert.equal(calls[1].variables.before, "previous");
  assert.equal(calls[1].variables.first, undefined);
});

test("search and collection filters are sent to Shopify, missing collection remains null", async () => {
  let variables;
  const provider = createShopifyCommerce(clientOptions(async (url, init) => { const body = JSON.parse(init.body); variables = body.variables; return response(body.query.includes("query Search") ? { search: { nodes: [item], pageInfo, filters: [] } } : { collection: null }); }));
  await provider.searchProducts("fixture", { lang: "en", sort: "featured", pageSize: 24, filters: ['{"available":true}', "invalid"] });
  assert.deepEqual(variables.filters, [{ available: true }]);
  assert.equal(variables.query, "fixture");
  assert.equal(await provider.getCollection("absent", { lang: "en", sort: "featured", pageSize: 24 }), null);
});

test("facet capability is explicit and all-products filters are refused before a request", async () => {
  const calls = [];
  const provider = createShopifyCommerce(clientOptions(async (url, init) => { calls.push(init); return response({ products: { nodes: [item], pageInfo, filters: [{ id: "invented" }] } }); }));
  assert.deepEqual(provider.filterKinds, ["collection", "search"]);
  await assert.rejects(provider.listProducts({ lang: "en", sort: "title", pageSize: 12, filters: ['{"available":true}'] }), /collection or search/);
  assert.equal(calls.length, 0);
  assert.deepEqual((await provider.listProducts({ lang: "en", sort: "title", pageSize: 12 })).filters, []);
});

test("posted option choices never fall back to a stale hidden variant", async () => {
  for (const found of [null, { variantBySelectedOptions: null }]) {
    const calls = [];
    const provider = createShopifyCommerce(clientOptions(async (url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      if (body.query.includes("query VariantByOptions")) return response({ product: found });
      return response(body.query.includes("query Cart(") ? { cart } : { result: { cart, userErrors: [] } });
    }));
    const result = await provider.addLine(session, { handle: "fixture", merchandiseId: "gid://shopify/ProductVariant/2", options: [{ name: "Size", value: "Absent" }], quantity: 1 });
    assert.equal(result.error?.code, "unavailable");
    assert.equal(result.token, session.token);
    assert.equal(calls.length, 1);
    assert.ok(!calls.some(({ query }) => /^\s*mutation/.test(query)));
  }
  const noHandle = createShopifyCommerce(clientOptions(async () => { throw new Error("Must not call Shopify without the posted product handle"); }));
  assert.equal((await noHandle.addLine(session, { merchandiseId: "gid://shopify/ProductVariant/2", options: [{ name: "Size", value: "Absent" }], quantity: 1 })).error?.code, "unavailable");
});

test("valid posted options select the resolved variant instead of the hidden id", async () => {
  const calls = [];
  const provider = createShopifyCommerce(clientOptions(async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.query.includes("query VariantByOptions")) return response({ product: { variantBySelectedOptions: { id: "gid://shopify/ProductVariant/77" } } });
    return response(body.query.includes("query Cart(") ? { cart } : { result: { cart, userErrors: [] } });
  }));
  const result = await provider.addLine(session, { handle: "fixture", merchandiseId: "gid://shopify/ProductVariant/2", options: [{ name: "Size", value: "Large" }], quantity: 1 });
  assert.equal(result.error, undefined);
  assert.equal(calls.find(({ query }) => /^\s*mutation/.test(query)).variables.lines[0].merchandiseId, "gid://shopify/ProductVariant/77");
});

test("collections and sitemap read every page and refuse repeated cursors", async () => {
  const calls = [];
  const provider = createShopifyCommerce(clientOptions(async (url, init) => {
    const { query, variables } = JSON.parse(init.body); calls.push(variables);
    if (query.includes("query Collections")) return response({ collections: { nodes: [], pageInfo: { hasNextPage: !variables.after, endCursor: "collections-next" } } });
    return response({ products: { nodes: [{ handle: variables.after ? "second" : "first", updatedAt: "2026-10-09" }], pageInfo: { hasNextPage: !variables.after, endCursor: "products-next" } } });
  }));
  const sitemap = await provider.sitemap();
  assert.deepEqual(sitemap.products.map((p) => p.handle), ["first", "second"]);
  assert.equal(calls.length, 4);
  const broken = createShopifyCommerce(clientOptions(async () => response({ collections: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } } })));
  await assert.rejects(broken.listCollections("en"), /invalid collections cursor/);
});

test("multi-option product mapping preserves each variant id and options", async () => {
  const product = { ...item, description: "", descriptionHtml: "", updatedAt: "2026-10-09", seo: { title: null, description: null }, images: { nodes: [image] }, options: [{ name: "Size", optionValues: [{ name: "Small", swatch: null }, { name: "Large", swatch: null }] }], variants: { nodes: [{ id: "gid://shopify/ProductVariant/2", title: "Large", sku: null, availableForSale: true, selectedOptions: [{ name: "Size", value: "Large" }], price: money("30"), compareAtPrice: null, image }] }, collections: { nodes: [{ handle: "fixtures", title: "Fixtures" }] } };
  const provider = createShopifyCommerce(clientOptions(async () => response({ product })));
  const result = await provider.getProduct("fixture", "en");
  assert.equal(result.variants[0].id, "gid://shopify/ProductVariant/2");
  assert.equal(result.variants[0].selectedOptions[0].value, "Large");
  assert.deepEqual(result.options[0].values.map((v) => v.name), ["Small", "Large"]);
});

test("owner-selected specification metafields are requested without inferred namespace or values", async () => {
  let variables;
  const provider = createShopifyCommerce(clientOptions(async (url, init) => { variables = JSON.parse(init.body).variables; return response({ product: null }); }, { specMetafields: [{ namespace: "dimensions", key: "height" }] }));
  assert.equal(await provider.getProduct("absent", "en"), null);
  assert.deepEqual(variables.specMetafields, [{ namespace: "dimensions", key: "height" }]);
});

test("shop profile and FAQ stay empty until owner content exists, and backend failures propagate", async () => {
  const content = createShopifyContent(clientOptions(async () => response({ metaobjects: { nodes: [] } })));
  assert.equal(await content.getStoreProfile(), null);
  assert.deepEqual(await content.getFaq(), []);
  const broken = createShopifyContent(clientOptions(async () => { throw new Error("network"); }));
  await assert.rejects(broken.getStoreProfile());
  await assert.rejects(broken.getFaq());
});

test("invalid direct cart quantities are refused before touching the backend", async () => {
  const provider = createShopifyCommerce(clientOptions(async () => { throw new Error("backend must not be called"); }));
  for (const quantity of [-1, -0.5, 0.5, 1.2, undefined, NaN, Infinity, 1001]) {
    assert.equal((await provider.addLine(session, { merchandiseId: "gid://shopify/ProductVariant/2", options: [], quantity })).error.code, "invalid");
    assert.equal((await provider.updateLine(session, "line", quantity)).error.code, "invalid");
  }
});

test("a failed add mutation is not turned into a fresh cart", async () => {
  const calls = [];
  const provider = createShopifyCommerce(clientOptions(async (url, init) => { const body = JSON.parse(init.body); calls.push(body.query); if (/^\s*mutation/.test(body.query)) throw new Error("fetch failed"); return response({ cart }); }, { retries: 2 }));
  await assert.rejects(provider.addLine(session, { merchandiseId: "gid://shopify/ProductVariant/2", options: [], quantity: 1 }));
  assert.equal(calls.filter((q) => /^\s*mutation/.test(q)).length, 1);
  assert.equal(calls.some((q) => q.includes("mutation CartCreate")), false);
});

test("an absent cart creates one and preserves Shopify's stock/user errors", async () => {
  const provider = createShopifyCommerce(clientOptions(async (url, init) => response(/^\s*mutation/.test(JSON.parse(init.body).query) ? { result: { cart, userErrors: [{ message: "Quantity reduced", field: [] }] } } : { cart: null })));
  const result = await provider.addLine(session, { merchandiseId: "gid://shopify/ProductVariant/2", options: [], quantity: 1 });
  assert.equal(result.token, cart.id);
  assert.equal(result.cart.totalQuantity, 1);
  assert.equal(result.error.code, "unavailable");
});

test("hosted checkout comes from the cart and rejects foreign or non-https redirects", async () => {
  const provider = createShopifyCommerce(clientOptions(async () => response({ cart })));
  assert.equal(provider.checkout.kind, "hosted");
  assert.equal(await provider.checkout.url(session), cart.checkoutUrl);
  const api = createStorefront(clientOptions(async () => response({})));
  for (const url of ["http://fixture.myshopify.com/test", "https://evil.test/checkout", "https://user:pass@fixture.myshopify.com/checkout"]) assert.throws(() => api.checkoutUrl(url));
});

function context(body, { origin = "https://fixture.test", method = "POST", token = session.token } = {}) {
  const changed = [];
  return {
    changed,
    request: new Request("https://fixture.test/api/cart", { method, ...(method !== "GET" && { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", origin } }) }),
    url: new URL("https://fixture.test/api/cart"), clientAddress: session.clientAddress,
    cookies: { get: () => token ? { value: token } : undefined, set: (...args) => changed.push(args), delete: (...args) => changed.push(args) },
  };
}

test("cart API keeps access keys in secure httpOnly cookies and disables shared caching", async () => {
  const provider = createShopifyCommerce(clientOptions(async () => response({ cart })));
  const c = context({ action: "get" });
  const result = await createCartEndpoint(provider)(c);
  const json = await result.json();
  assert.equal(json.token, undefined);
  assert.equal(JSON.stringify(json).includes(session.token), false);
  assert.equal(c.changed[0][2].httpOnly, true);
  assert.equal(c.changed[0][2].secure, true);
  assert.equal(c.changed[0][2].sameSite, "lax");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("cart API rejects cross-origin, malformed and invalid actions before backend calls", async () => {
  const provider = new Proxy({}, { get() { throw new Error("backend must not be called"); } });
  const endpoint = createCartEndpoint(provider);
  assert.equal((await endpoint(context({ action: "add" }, { origin: "https://evil.test" }))).status, 403);
  for (const body of ["{broken", [], { action: "add", merchandiseId: "gid://shopify/ProductVariant/2", quantity: -1 }, { action: "update", lineId: "line", quantity: 1.2 }, { action: "unknown" }]) assert.equal((await endpoint(context(body))).status, 400);
});

test("cart API network failure preserves the existing session", async () => {
  const c = context({ action: "get" });
  const result = await createCartEndpoint({ getCart: async () => { throw new Error("private response"); } })(c);
  assert.equal(result.status, 502);
  assert.equal(c.changed.length, 0);
  assert.equal((await result.text()).includes("private response"), false);
});

test("public cart errors contain only known codes and retain the failed mutation session", async () => {
  for (const code of ["coupon", "PRIVATE-DETAIL-SENTINEL"]) {
    const c = context({ action: "discount", code: "INVALID" });
    const endpoint = createCartEndpoint({ applyDiscount: async () => ({ cart: null, token: null, error: { code, message: "PRIVATE-DETAIL-SENTINEL", debug: session.token } }) });
    const result = await endpoint(c);
    const json = await result.json();
    assert.deepEqual(json.error, { code: code === "coupon" ? "coupon" : "backend" });
    assert.doesNotMatch(JSON.stringify(json), /PRIVATE-DETAIL-SENTINEL|\?key=/);
    assert.equal(c.changed.length, 0);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  }
});

test("Shopify user errors without a returned cart preserve the existing provider token", async () => {
  const provider = createShopifyCommerce(clientOptions(async (url, init) => response(/^\s*mutation/.test(JSON.parse(init.body).query)
    ? { result: { cart: null, userErrors: [{ message: "Coupon rejected", field: [] }] } }
    : { cart })));
  const result = await provider.applyDiscount(session, "INVALID");
  assert.equal(result.error.code, "coupon");
  assert.equal(result.token, session.token);
});

test("browser mutations are serialized; failure does not replay or block the next action", async () => {
  let active = 0, max = 0;
  const calls = [];
  const browser = createCartClient("/api/cart", async (url, init) => {
    active++; max = Math.max(max, active); const body = JSON.parse(init.body); calls.push(body);
    assert.equal(init.credentials, "same-origin");
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return body.action === "add" ? Response.json({ error: "failed" }, { status: 502 }) : Response.json({ cart: null });
  });
  const results = await Promise.allSettled([browser.add("gid://shopify/ProductVariant/2"), browser.get()]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(max, 1);
  assert.deepEqual(calls.map((c) => c.action), ["add", "get"]);
});
