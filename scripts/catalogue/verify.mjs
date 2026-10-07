/**
 * Proof through the layer the customer uses. The Admin API saying the data is
 * there does not mean the storefront serves it: unpublished products exist in
 * the Admin and are invisible here. Uses only the PUBLIC Storefront token.
 */
import { shopifyEnv } from "../shopify/env.mjs";

const VARIANT_PAGE = 100; // the nested variants(first: 100) below

export function summarise(products, collections) {
  return {
    products: products.length,
    variants: products.reduce((sum, p) => sum + p.variantCount, 0),
    withImage: products.filter((p) => p.images.length > 0).length,
    collections: collections.length,
  };
}

export function compareToCatalogue({ handles, summary }, catalog) {
  const problems = [];
  const expected = catalog.products.filter((p) => (p.status ?? "ACTIVE") === "ACTIVE");
  const seen = new Set(handles);
  const missing = expected.filter((p) => !seen.has(p.handle)).map((p) => p.handle);
  if (missing.length) {
    problems.push(`missing from the storefront: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}. Usually never published to the Headless channel.`);
  }
  if (summary.products !== expected.length) problems.push(`products: expected ${expected.length}, storefront has ${summary.products}`);
  const expectedVariants = expected.reduce((sum, p) => sum + Math.min(p.variants.length, VARIANT_PAGE), 0);
  if (summary.variants !== expectedVariants) problems.push(`variants: expected ${expectedVariants}, storefront has ${summary.variants}`);
  if (summary.collections !== catalog.collections.length) problems.push(`collections: expected ${catalog.collections.length}, storefront has ${summary.collections}`);
  const expectedImages = expected.filter((p) => (p.images ?? []).length > 0).length;
  if (summary.withImage < expectedImages) problems.push(`images: ${expectedImages} products should have one, storefront shows ${summary.withImage}. Image processing is asynchronous; wait and re-run, then look for FAILED media.`);
  return problems;
}

async function storefront(query, variables, env) {
  const response = await fetch(`https://${env.domain}/api/${env.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": env.storefrontToken },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Storefront API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const json = await response.json();
  if (json.errors) throw new Error(`Storefront API errors: ${JSON.stringify(json.errors)}`);
  return { data: json.data, served: response.headers.get("x-shopify-api-version") };
}

const PRODUCTS = `query($after: String) { products(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { handle images(first: 1) { nodes { url } } variants(first: ${VARIANT_PAGE}) { nodes { id } } } } }`;
const COLLECTIONS = `query($after: String) { collections(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { handle } } }`;

export async function fetchStorefront({ env = shopifyEnv() } = {}) {
  if (!env.domain || !env.storefrontToken) throw new Error("needs SHOPIFY_STORE_DOMAIN and a public Storefront token in .env.local");
  let served = null;
  const all = async (query, key) => {
    const nodes = [];
    let after = null;
    for (;;) {
      const { data, served: v } = await storefront(query, { after }, env);
      served = v ?? served;
      nodes.push(...data[key].nodes);
      if (!data[key].pageInfo.hasNextPage) return nodes;
      after = data[key].pageInfo.endCursor;
    }
  };
  const products = (await all(PRODUCTS, "products")).map((p) => ({ handle: p.handle, images: p.images.nodes, variantCount: p.variants.nodes.length }));
  const collections = await all(COLLECTIONS, "collections");
  return { products, collections, served };
}
