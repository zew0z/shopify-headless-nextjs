/**
 * Shopify Storefront SDK - Universal Backend Module
 *
 * Plug-and-play functions for products, collections, predictive search, cart, and checkout.
 */

import { shopifyFetch, ShopifyError } from "./client";
import { shopifyConfig, isShopifyConfigured, validateShopifyConfig } from "./config";
import {
  Product,
  Collection,
  Cart,
  CartItemInput,
  CartLineUpdateInput,
  CartBuyerIdentity,
  GetProductsOptions,
  GetCollectionProductsOptions,
  PredictiveSearchResult,
  CartUserError,
  ShopInfo,
  ConnectionHealthCheck,
  PageInfo,
  Filter,
  ProductPage,
  SearchProductsOptions,
} from "./types";
import {
  shopQuery,
  getProductsQuery,
  getProductByHandleQuery,
  getProductRecommendationsQuery,
  getCollectionsQuery,
  getCollectionByHandleQuery,
  getCollectionProductsQuery,
  searchProductsQuery,
  predictiveSearchQuery,
  getCartQuery,
} from "./queries";
import {
  createCartMutation,
  addToCartMutation,
  updateCartLinesMutation,
  removeFromCartMutation,
  updateCartDiscountCodesMutation,
  addCartGiftCardCodesMutation,
  removeCartGiftCardCodesMutation,
  updateCartBuyerIdentityMutation,
} from "./mutations";

// Re-export configs, client, and types
export * from "./types";
export * from "./config";
export * from "./client";
export * from "./queries";
export * from "./mutations";
export * from "./money";

/**
 * Catalogue reads are shared by every visitor, so they live in the Next.js data
 * cache and are purged by tag from /api/revalidate when Shopify sends a webhook.
 */
const CATALOGUE_CACHE: RequestCache = "force-cache";

/**
 * Every product comes from Shopify; nothing is made up. Without Shopify settings
 * the catalogue reads throw and say what to set, in development and production.
 * To work without the owner's store, point the settings at mock.shop.
 */
function requireShopify(): void {
  if (isShopifyConfigured) return;
  throw new ShopifyError(
    "Shopify is not configured: set NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN and NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN (mock.shop works for development).",
    500
  );
}

// -------------------------------------------------------------
// Connection & Health Operations
// -------------------------------------------------------------

/**
 * Retrieves basic store metadata (name, currency, primary domain).
 */
export async function getShopInfo(): Promise<ShopInfo | null> {
  if (!isShopifyConfigured) return null;

  try {
    const res = await shopifyFetch<{ shop: ShopInfo }>({
      query: shopQuery,
      cache: "no-store",
    });
    return res.body.data?.shop || null;
  } catch (err) {
    console.warn("[Shopify SDK] getShopInfo error:", err);
    return null;
  }
}

/**
 * Executes a full live diagnostic check of the Shopify Storefront API connection.
 * Tests configuration, authentication, domain resolution, and network latency.
 */
export async function checkShopifyConnection(): Promise<ConnectionHealthCheck> {
  const configValidation = validateShopifyConfig();
  const baseResult: ConnectionHealthCheck = {
    isConfigured: isShopifyConfigured,
    canConnect: false,
    domain: shopifyConfig.domain,
    apiVersion: shopifyConfig.apiVersion,
    errors: configValidation.issues,
  };

  if (!isShopifyConfigured) {
    return baseResult;
  }

  const startTime = Date.now();
  try {
    const res = await shopifyFetch<{ shop: ShopInfo }>({
      query: shopQuery,
      cache: "no-store",
    });

    const latencyMs = Date.now() - startTime;
    const shop = res.body.data?.shop;

    if (shop) {
      return {
        isConfigured: true,
        canConnect: true,
        domain: shopifyConfig.domain,
        apiVersion: shopifyConfig.apiVersion,
        shopName: shop.name,
        currency: shop.paymentSettings?.currencyCode,
        latencyMs,
      };
    }

    return {
      ...baseResult,
      errors: ["Response received from Shopify but shop metadata was missing"],
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Unknown connection failure";
    return {
      ...baseResult,
      latencyMs,
      errors: [message],
    };
  }
}

// -------------------------------------------------------------
// Product Operations
// -------------------------------------------------------------

type Edges<T> = { pageInfo: PageInfo; edges: Array<{ node: T }>; filters?: Filter[] };

/** Shopify answered without an error but without the data we asked for. */
function dataOrThrow<T>(data: T | undefined): T {
  if (!data) throw new ShopifyError("Shopify returned no data", 502);
  return data;
}

/**
 * Fetches a list of products with optional query filtering, sorting, and pagination.
 *
 * @example
 * const products = await getProducts({ limit: 12, sortKey: "PRICE", reverse: true });
 */
export async function getProducts(options?: GetProductsOptions): Promise<Product[]> {
  return (await getProductsPage(options)).products;
}

/** One page of products plus what the next page needs. */
export async function getProductsPage(options?: GetProductsOptions): Promise<ProductPage> {
  requireShopify();

  const res = await shopifyFetch<{ products: Edges<Product> }>({
    query: getProductsQuery,
    variables: {
      first: options?.limit || 20,
      after: options?.cursor,
      query: options?.query,
      sortKey: options?.sortKey || "RELEVANCE",
      reverse: options?.reverse || false,
    },
    cache: options?.cache ?? CATALOGUE_CACHE,
    tags: ["products"],
    revalidate: options?.revalidate,
  });

  const conn = dataOrThrow(res.body.data).products;
  return { products: conn.edges.map((e) => e.node), pageInfo: conn.pageInfo, filters: [] };
}

/** A full search results page: products only, with the total and Shopify's filters. */
export async function searchProducts(options: SearchProductsOptions): Promise<ProductPage> {
  requireShopify();

  const res = await shopifyFetch<{
    search: { totalCount: number; pageInfo: PageInfo; productFilters: Filter[]; edges: Array<{ node: Product & { __typename: string } }> };
  }>({
    query: searchProductsQuery,
    variables: {
      query: options.query,
      first: options.limit || 20,
      after: options.cursor,
      sortKey: options.sortKey || "RELEVANCE",
      reverse: options.reverse || false,
      filters: options.filters,
    },
    cache: options.cache ?? CATALOGUE_CACHE,
    tags: ["products"],
    revalidate: options.revalidate,
  });

  const s = dataOrThrow(res.body.data).search;
  return {
    products: s.edges.map((e) => e.node).filter((n) => n.__typename === "Product"),
    pageInfo: s.pageInfo,
    filters: s.productFilters,
    totalCount: s.totalCount,
  };
}

/**
 * Fetches a single product by its URL handle.
 *
 * @example
 * const product = await getProduct("wireless-headphones");
 */
export async function getProduct(
  handle: string,
  options?: { cache?: RequestCache; revalidate?: number }
): Promise<Product | null> {
  requireShopify();

  const res = await shopifyFetch<{
    product: Product | null;
  }>({
    query: getProductByHandleQuery,
    variables: { handle },
    cache: options?.cache ?? CATALOGUE_CACHE,
    tags: ["products", `product-${handle}`],
    revalidate: options?.revalidate,
  });

  return res.body.data?.product || null;
}

/**
 * Fetches product recommendations based on a product ID.
 *
 * @example
 * const recommendations = await getProductRecommendations("gid://shopify/Product/12345");
 */
export async function getProductRecommendations(productId: string): Promise<Product[]> {
  requireShopify();

  const res = await shopifyFetch<{
    productRecommendations: Product[];
  }>({
    query: getProductRecommendationsQuery,
    variables: { productId },
    cache: CATALOGUE_CACHE,
    tags: ["products", `product-rec-${productId}`],
  });

  return res.body.data?.productRecommendations || [];
}

/**
 * Predictive Type-Ahead Search for products, collections, and query suggestions.
 *
 * @example
 * const results = await predictiveSearch("hermes");
 */
export async function predictiveSearch(
  query: string,
  options?: { limit?: number; country?: string; language?: string }
): Promise<PredictiveSearchResult> {
  const emptyResult: PredictiveSearchResult = { queries: [], products: [], collections: [] };
  if (!query || query.trim().length === 0) return emptyResult;

  requireShopify();

  const res = await shopifyFetch<{
    predictiveSearch: {
      queries: Array<{ text: string; styledText?: string }>;
      products: Product[];
      collections: Collection[];
    };
  }>({
    query: predictiveSearchQuery,
    variables: {
      query,
      limit: options?.limit || 5,
      country: options?.country,
      language: options?.language,
    },
    cache: "no-store",
  });

  return (
    res.body.data?.predictiveSearch || {
      queries: [],
      products: [],
      collections: [],
    }
  );
}

// -------------------------------------------------------------
// Collection Operations
// -------------------------------------------------------------

/**
 * Fetches all store collections.
 *
 * @example
 * const collections = await getCollections({ limit: 10 });
 */
export async function getCollections(options?: { limit?: number; cursor?: string }): Promise<Collection[]> {
  requireShopify();

  const res = await shopifyFetch<{
    collections: {
      edges: Array<{ node: Collection }>;
    };
  }>({
    query: getCollectionsQuery,
    variables: {
      first: options?.limit || 20,
      after: options?.cursor,
    },
    cache: CATALOGUE_CACHE,
    tags: ["collections"],
  });

  return res.body.data?.collections.edges.map((e) => e.node) || [];
}

/**
 * Fetches a single collection by handle.
 */
export async function getCollection(handle: string): Promise<Collection | null> {
  requireShopify();

  const res = await shopifyFetch<{
    collection: Collection | null;
  }>({
    query: getCollectionByHandleQuery,
    variables: { handle },
    cache: CATALOGUE_CACHE,
    tags: ["collections", `collection-${handle}`],
  });

  return res.body.data?.collection || null;
}

/**
 * Fetches products belonging to a collection by handle.
 */
export async function getCollectionProducts(options: GetCollectionProductsOptions): Promise<Product[]> {
  return (await getCollectionProductsPage(options))?.products ?? [];
}

/** One page of a collection's products, with the filters Shopify offers for it. Null when the collection does not exist. */
export async function getCollectionProductsPage(options: GetCollectionProductsOptions): Promise<ProductPage | null> {
  requireShopify();

  const res = await shopifyFetch<{ collection: { products: Edges<Product> } | null }>({
    query: getCollectionProductsQuery,
    variables: {
      handle: options.handle,
      first: options.limit || 20,
      after: options.cursor,
      sortKey: options.sortKey || "COLLECTION_DEFAULT",
      reverse: options.reverse || false,
      filters: options.filters,
    },
    cache: options.cache ?? CATALOGUE_CACHE,
    tags: ["collections", `collection-${options.handle}`, "products"],
    revalidate: options.revalidate,
  });

  const conn = dataOrThrow(res.body.data).collection?.products;
  if (!conn) return null;
  return { products: conn.edges.map((e) => e.node), pageInfo: conn.pageInfo, filters: conn.filters ?? [] };
}

// -------------------------------------------------------------
// Cart Operations (Strictly Dynamic / No Cache)
// -------------------------------------------------------------

function checkCartErrors(userErrors?: CartUserError[]) {
  if (userErrors && userErrors.length > 0) {
    const msg = userErrors.map((e) => e.message).join(", ");
    throw new ShopifyError(`Shopify Cart Error: ${msg}`, 400, userErrors);
  }
}

/**
 * Normalizes Shopify checkout URLs to ensure clean checkout redirection
 */
function normalizeCheckoutUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Creates a brand new cart with optional initial items and buyer identity.
 */
export async function createCart(
  lines?: CartItemInput[],
  buyerIdentity?: CartBuyerIdentity
): Promise<Cart | null> {
  if (!isShopifyConfigured) return null;

  const res = await shopifyFetch<{
    cartCreate: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: createCartMutation,
    variables: { lines, buyerIdentity },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartCreate.userErrors);
  const cart = res.body.data?.cartCreate.cart || null;
  if (cart) {
    cart.checkoutUrl = normalizeCheckoutUrl(cart.checkoutUrl);
  }
  return cart;
}

/**
 * Retrieves an active cart by its ID.
 */
export async function getCart(cartId: string): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cart: Cart | null;
  }>({
    query: getCartQuery,
    variables: { cartId },
    cache: "no-store",
  });

  return res.body.data?.cart || null;
}

/**
 * Adds line items to an existing cart (supports variants and subscription selling plans).
 */
export async function addToCart(
  cartId: string,
  lines: CartItemInput[]
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartLinesAdd: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: addToCartMutation,
    variables: { cartId, lines },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartLinesAdd.userErrors);
  return res.body.data?.cartLinesAdd.cart || null;
}

/**
 * Updates item quantities or selling plans in an existing cart.
 */
export async function updateCartLines(
  cartId: string,
  lines: CartLineUpdateInput[]
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartLinesUpdate: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: updateCartLinesMutation,
    variables: { cartId, lines },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartLinesUpdate.userErrors);
  return res.body.data?.cartLinesUpdate.cart || null;
}

/**
 * Removes line items from an existing cart.
 */
export async function removeFromCart(
  cartId: string,
  lineIds: string[]
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartLinesRemove: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: removeFromCartMutation,
    variables: { cartId, lineIds },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartLinesRemove.userErrors);
  return res.body.data?.cartLinesRemove.cart || null;
}

/**
 * Applies promo or discount codes to a cart.
 */
export async function applyDiscountCode(
  cartId: string,
  discountCodes: string[]
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartDiscountCodesUpdate: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: updateCartDiscountCodesMutation,
    variables: { cartId, discountCodes },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartDiscountCodesUpdate.userErrors);
  return res.body.data?.cartDiscountCodesUpdate.cart || null;
}

/**
 * Adds gift card codes to a cart.
 */
export async function addGiftCard(
  cartId: string,
  giftCardCodes: string[]
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartGiftCardCodesAdd: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: addCartGiftCardCodesMutation,
    variables: { cartId, giftCardCodes },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartGiftCardCodesAdd.userErrors);
  return res.body.data?.cartGiftCardCodesAdd.cart || null;
}

/**
 * Removes applied gift cards from a cart. Shopify removes by applied-card id,
 * not by code: take the ids from `cart.appliedGiftCards[].id`.
 */
export async function removeGiftCard(
  cartId: string,
  appliedGiftCardIds: string[]
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartGiftCardCodesRemove: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: removeCartGiftCardCodesMutation,
    variables: { cartId, appliedGiftCardIds },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartGiftCardCodesRemove.userErrors);
  return res.body.data?.cartGiftCardCodesRemove.cart || null;
}

/**
 * Updates buyer identity (email, phone, country, customerAccessToken) on a cart.
 */
export async function updateCartBuyerIdentity(
  cartId: string,
  buyerIdentity: CartBuyerIdentity
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartBuyerIdentityUpdate: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: updateCartBuyerIdentityMutation,
    variables: { cartId, buyerIdentity },
    cache: "no-store",
  });

  checkCartErrors(res.body.data?.cartBuyerIdentityUpdate.userErrors);
  return res.body.data?.cartBuyerIdentityUpdate.cart || null;
}
