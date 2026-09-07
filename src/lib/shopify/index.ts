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
} from "./types";
import {
  shopQuery,
  getProductsQuery,
  getProductByHandleQuery,
  getProductRecommendationsQuery,
  getCollectionsQuery,
  getCollectionByHandleQuery,
  getCollectionProductsQuery,
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
import { MOCK_PRODUCTS, MOCK_COLLECTIONS } from "./mock-data";

// Re-export configs, client, and types
export * from "./types";
export * from "./config";
export * from "./client";
export * from "./queries";
export * from "./mutations";

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

/**
 * Fetches a list of products with optional query filtering, sorting, and pagination.
 *
 * @example
 * const products = await getProducts({ limit: 12, sortKey: "PRICE", reverse: true });
 */
export async function getProducts(options?: GetProductsOptions): Promise<Product[]> {
  if (!isShopifyConfigured) {
    if (options?.query) {
      const q = options.query.toLowerCase();
      return MOCK_PRODUCTS.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return MOCK_PRODUCTS.slice(0, options?.limit || 20);
  }

  try {
    const res = await shopifyFetch<{
      products: {
        edges: Array<{ node: Product }>;
      };
    }>({
      query: getProductsQuery,
      variables: {
        first: options?.limit || 20,
        after: options?.cursor,
        query: options?.query,
        sortKey: options?.sortKey || "RELEVANCE",
        reverse: options?.reverse || false,
      },
      cache: options?.cache ?? "no-store",
      tags: ["products"],
      revalidate: options?.revalidate,
    });

    return res.body.data?.products.edges.map((e) => e.node) || [];
  } catch (err) {
    console.warn("[Shopify SDK] getProducts fallback to mock:", err);
    return MOCK_PRODUCTS;
  }
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
  if (!isShopifyConfigured) {
    return MOCK_PRODUCTS.find((p) => p.handle === handle) || null;
  }

  try {
    const res = await shopifyFetch<{
      product: Product | null;
    }>({
      query: getProductByHandleQuery,
      variables: { handle },
      cache: options?.cache ?? "no-store",
      tags: ["products", `product-${handle}`],
      revalidate: options?.revalidate,
    });

    return res.body.data?.product || null;
  } catch (err) {
    console.warn(`[Shopify SDK] getProduct("${handle}") fallback:`, err);
    return MOCK_PRODUCTS.find((p) => p.handle === handle) || null;
  }
}

/**
 * Fetches product recommendations based on a product ID.
 *
 * @example
 * const recommendations = await getProductRecommendations("gid://shopify/Product/12345");
 */
export async function getProductRecommendations(productId: string): Promise<Product[]> {
  if (!isShopifyConfigured) {
    return MOCK_PRODUCTS.slice(0, 4);
  }

  try {
    const res = await shopifyFetch<{
      productRecommendations: Product[];
    }>({
      query: getProductRecommendationsQuery,
      variables: { productId },
      cache: "no-store",
      tags: ["products", `product-rec-${productId}`],
    });

    return res.body.data?.productRecommendations || [];
  } catch (err) {
    console.warn(`[Shopify SDK] getProductRecommendations("${productId}") fallback:`, err);
    return MOCK_PRODUCTS.slice(0, 4);
  }
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

  if (!isShopifyConfigured) {
    const q = query.toLowerCase();
    const matchedProducts = MOCK_PRODUCTS.filter(
      (p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
    const matchedCollections = MOCK_COLLECTIONS.filter((c) =>
      c.title.toLowerCase().includes(q)
    );
    return {
      queries: [{ text: query }],
      products: matchedProducts,
      collections: matchedCollections,
    };
  }

  try {
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
  } catch (err) {
    console.warn(`[Shopify SDK] predictiveSearch("${query}") error:`, err);
    return emptyResult;
  }
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
  if (!isShopifyConfigured) {
    return MOCK_COLLECTIONS.slice(0, options?.limit || 10);
  }

  try {
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
      cache: "no-store",
      tags: ["collections"],
    });

    return res.body.data?.collections.edges.map((e) => e.node) || [];
  } catch (err) {
    console.warn("[Shopify SDK] getCollections fallback:", err);
    return MOCK_COLLECTIONS;
  }
}

/**
 * Fetches a single collection by handle.
 */
export async function getCollection(handle: string): Promise<Collection | null> {
  if (!isShopifyConfigured) {
    return MOCK_COLLECTIONS.find((c) => c.handle === handle) || null;
  }

  try {
    const res = await shopifyFetch<{
      collection: Collection | null;
    }>({
      query: getCollectionByHandleQuery,
      variables: { handle },
      cache: "no-store",
      tags: ["collections", `collection-${handle}`],
    });

    return res.body.data?.collection || null;
  } catch (err) {
    console.warn(`[Shopify SDK] getCollection("${handle}") fallback:`, err);
    return MOCK_COLLECTIONS.find((c) => c.handle === handle) || null;
  }
}

/**
 * Fetches products belonging to a collection by handle.
 */
export async function getCollectionProducts(options: GetCollectionProductsOptions): Promise<Product[]> {
  if (!isShopifyConfigured) {
    return MOCK_PRODUCTS;
  }

  try {
    const res = await shopifyFetch<{
      collection: {
        products: {
          edges: Array<{ node: Product }>;
        };
      } | null;
    }>({
      query: getCollectionProductsQuery,
      variables: {
        handle: options.handle,
        first: options.limit || 20,
        after: options.cursor,
        sortKey: options.sortKey || "COLLECTION_DEFAULT",
        reverse: options.reverse || false,
      },
      cache: options.cache ?? "no-store",
      tags: ["collections", `collection-${options.handle}`, "products"],
      revalidate: options.revalidate,
    });

    return res.body.data?.collection?.products.edges.map((e) => e.node) || [];
  } catch (err) {
    console.warn(`[Shopify SDK] getCollectionProducts("${options.handle}") fallback:`, err);
    return MOCK_PRODUCTS;
  }
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
 * Removes gift card codes from a cart.
 */
export async function removeGiftCard(
  cartId: string,
  giftCardCodes: string[]
): Promise<Cart | null> {
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartGiftCardCodesRemove: {
      cart: Cart;
      userErrors: CartUserError[];
    };
  }>({
    query: removeCartGiftCardCodesMutation,
    variables: { cartId, giftCardCodes },
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
