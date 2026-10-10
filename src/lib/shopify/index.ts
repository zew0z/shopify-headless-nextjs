/**
 * Shopify Storefront SDK - Universal Backend Module
 *
 * Plug-and-play functions for products, collections, predictive search, cart, and checkout.
 */

import { shopifyFetch, ShopifyError, requireShopify, dataOrThrow } from "./client";
import { shopifyConfig, isShopifyConfigured, validateShopifyConfig } from "./config";
import { merchandiseDiscount, stockWarnings } from "./cart-utils";
import { validateCheckoutUrl } from "./checkout";
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
  ShopAnalytics,
  ConnectionHealthCheck,
  PageInfo,
  Filter,
  ProductPage,
  SearchProductsOptions,
  Metafield,
  MetafieldIdentifier,
} from "./types";
import { toLinkedEntries, type RawLinked } from "./metaobjects";
import {
  shopQuery,
  shopAnalyticsQuery,
  getProductsQuery,
  getProductByHandleQuery,
  getProductStockQuery,
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
export * from "./variants";
export * from "./content";
export * from "./menu";
export * from "./metaobjects";
export * from "./seo";

/**
 * Catalogue reads are shared by every visitor, so they live in the Next.js data
 * cache and are purged by tag from /api/revalidate when Shopify sends a webhook.
 */
const CATALOGUE_CACHE: RequestCache = "force-cache";
const SEARCH_REVALIDATE_SECONDS = 300;

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
 * What <ShopifyAnalytics> needs about the shop. Analytics must never take a page
 * down, so this never throws: it returns null, with one console error saying why,
 * when there is no public Storefront token (the visitor's browser needs it to ask
 * Shopify for consent) or Shopify did not answer. Cached for a day.
 */
export async function getShopAnalytics(): Promise<ShopAnalytics | null> {
  if (!isShopifyConfigured) return null;
  if (!shopifyConfig.publicAccessToken) {
    console.error("[Shopify analytics] Off: set NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN (the public token). Shopify's privacy script needs it in the browser.");
    return null;
  }
  try {
    const res = await shopifyFetch<{
      shop: { id: string; primaryDomain: { host: string }; paymentSettings: { currencyCode: string } };
      localization: { language: { isoCode: string } };
    }>({ query: shopAnalyticsQuery, cache: "force-cache", revalidate: 86400, tags: ["shop"] });
    const { shop, localization } = dataOrThrow(res.body.data);
    return {
      shopId: shop.id,
      currency: shop.paymentSettings.currencyCode,
      acceptedLanguage: localization.language.isoCode,
      checkoutDomain: shop.primaryDomain.host,
      storefrontAccessToken: shopifyConfig.publicAccessToken,
    };
  } catch (err) {
    console.error("[Shopify analytics] Off for this page: could not read the shop from Shopify.", err);
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

type RawMetafield = Metafield & { reference?: RawLinked | null; references?: { nodes: RawLinked[] } | null };
type RawProduct = Omit<Product, "metafields"> & { metafields?: Array<RawMetafield | null> };

/** Metafields as getProduct returns them: reference fields carry the content entries they point at. A product sent without metafields is returned as it came. */
function withEntries({ metafields, ...product }: RawProduct): Product {
  if (!metafields) return product;
  return {
    ...product,
    metafields: metafields.map((m) => {
      if (!m) return null;
      const { reference, references, ...rest } = m;
      return { ...rest, entries: toLinkedEntries(reference, references) };
    }),
  };
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

  const res = await shopifyFetch<{ products: Edges<RawProduct> }>({
    query: getProductsQuery,
    variables: {
      first: options?.limit || 20,
      after: options?.cursor,
      query: options?.query,
      sortKey: options?.sortKey || "RELEVANCE",
      reverse: options?.reverse || false,
      metafields: options?.metafields ?? [],
      withCollections: options?.withCollections ?? false,
    },
    cache: options?.cache ?? CATALOGUE_CACHE,
    tags: ["products"],
    revalidate: options?.revalidate,
  });

  const conn = dataOrThrow(res.body.data).products;
  return { products: conn.edges.map((e) => withEntries(e.node)), pageInfo: conn.pageInfo, filters: [] };
}

/**
 * A full search results page: products only, with the total and Shopify's filters.
 *
 * Every query text is its own cache entry, so unlike the other catalogue reads the default is
 * force-cache with `revalidate: 300` (five minutes): a webhook purges the "products" tag, and
 * the time limit stops rarely-seen queries from staying stale. Pass `revalidate` for another time,
 * or `cache: "no-store"` for a fresh answer every time.
 */
export async function searchProducts(options: SearchProductsOptions): Promise<ProductPage> {
  requireShopify();
  const cache = options.cache ?? CATALOGUE_CACHE;

  const res = await shopifyFetch<{
    search: { totalCount: number; pageInfo: PageInfo; productFilters: Filter[]; edges: Array<{ node: RawProduct & { __typename: string } }> };
  }>({
    query: searchProductsQuery,
    variables: {
      query: options.query,
      first: options.limit || 20,
      after: options.cursor,
      sortKey: options.sortKey || "RELEVANCE",
      reverse: options.reverse || false,
      filters: options.filters,
      metafields: options.metafields ?? [],
      withCollections: options.withCollections ?? false,
    },
    cache,
    tags: ["products"],
    // Next warns when a revalidate time comes with no-store, so the default only applies to cached reads.
    revalidate: options.revalidate ?? (cache === "force-cache" ? SEARCH_REVALIDATE_SECONDS : undefined),
  });

  const s = dataOrThrow(res.body.data).search;
  return {
    products: s.edges.map((e) => e.node).filter((n) => n.__typename === "Product").map(withEntries),
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
  options?: { cache?: RequestCache; revalidate?: number; metafields?: MetafieldIdentifier[] }
): Promise<Product | null> {
  requireShopify();

  const res = await shopifyFetch<{ product: RawProduct | null }>({
    query: getProductByHandleQuery,
    variables: { handle, metafields: options?.metafields ?? [] },
    cache: options?.cache ?? CATALOGUE_CACHE,
    tags: ["products", `product-${handle}`],
    revalidate: options?.revalidate,
  });

  const product = res.body.data?.product;
  return product ? withEntries(product) : null;
}

/**
 * How many of each variant are left. Separate from getProduct because Shopify
 * only answers when the Storefront token has the unauthenticated_read_product_inventory
 * scope; without it this throws and says so, and the product page still works.
 */
export async function getProductStock(handle: string): Promise<Record<string, number | null>> {
  requireShopify();
  try {
    const res = await shopifyFetch<{
      product: { variants: { nodes: Array<{ id: string; quantityAvailable: number | null }> } } | null;
    }>({
      query: getProductStockQuery,
      variables: { handle },
      cache: CATALOGUE_CACHE,
      tags: ["products", `product-${handle}`],
    });
    const nodes = dataOrThrow(res.body.data).product?.variants.nodes ?? [];
    return Object.fromEntries(nodes.map((v) => [v.id, v.quantityAvailable]));
  } catch (err) {
    if (err instanceof Error && /access denied/i.test(err.message)) {
      throw new ShopifyError(
        "Shopify will not share stock counts: give the Storefront token the unauthenticated_read_product_inventory scope, or hide the stock line.",
        403
      );
    }
    throw err;
  }
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

  return dataOrThrow(dataOrThrow(res.body.data).predictiveSearch);
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

  const res = await shopifyFetch<{ collection: { products: Edges<RawProduct> } | null }>({
    query: getCollectionProductsQuery,
    variables: {
      handle: options.handle,
      first: options.limit || 20,
      after: options.cursor,
      sortKey: options.sortKey || "COLLECTION_DEFAULT",
      reverse: options.reverse || false,
      filters: options.filters,
      metafields: options.metafields ?? [],
      withCollections: options.withCollections ?? false,
    },
    cache: options.cache ?? CATALOGUE_CACHE,
    tags: ["collections", `collection-${options.handle}`, "products"],
    revalidate: options.revalidate,
  });

  const conn = dataOrThrow(res.body.data).collection?.products;
  if (!conn) return null;
  return { products: conn.edges.map((e) => withEntries(e.node)), pageInfo: conn.pageInfo, filters: conn.filters ?? [] };
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

/** User errors take precedence. Warnings describe a confirmed write and keep the cart. */
function confirmedCart(payload?: { cart: Cart | null; userErrors: CartUserError[]; warnings?: { code: string }[] }): Cart | null {
  if (!payload) return null;
  checkCartErrors(payload.userErrors);
  if (!payload.cart) return null;
  return { ...payload.cart, warnings: stockWarnings(payload.warnings),
    discount: merchandiseDiscount(payload.cart.discountAllocations, payload.cart.cost.subtotalAmount.currencyCode) };
}

/** Reads Shopify's current checkout at handoff; ordinary browser cart payloads omit it. */
export async function getCheckoutUrl(cartId: string): Promise<string | null> {
  const cart = await getCart(cartId);
  return cart && cart.totalQuantity > 0 && cart.checkoutUrl
    ? validateCheckoutUrl(cart.checkoutUrl, shopifyConfig.domain, process.env.SHOPIFY_CHECKOUT_HOSTS)
    : null;
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
      warnings?: { code: string }[];
    };
  }>({
    query: createCartMutation,
    variables: { lines, buyerIdentity },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartCreate);
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

  const cart = res.body.data?.cart;
  return cart ? { ...cart, warnings: [], discount: merchandiseDiscount(cart.discountAllocations, cart.cost.subtotalAmount.currencyCode) } : null;
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
      warnings?: { code: string }[];
    };
  }>({
    query: addToCartMutation,
    variables: { cartId, lines },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartLinesAdd);
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
      warnings?: { code: string }[];
    };
  }>({
    query: updateCartLinesMutation,
    variables: { cartId, lines },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartLinesUpdate);
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
      warnings?: { code: string }[];
    };
  }>({
    query: removeFromCartMutation,
    variables: { cartId, lineIds },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartLinesRemove);
}

/**
 * Applies promo or discount codes to a cart.
 */
export async function applyDiscountCode(
  cartId: string,
  discountCodes: string[]
): Promise<Cart | null> {
  if (!Array.isArray(discountCodes) || discountCodes.length > 250 || discountCodes.some((code) => typeof code !== "string" || !code.trim() || code.trim().length > 255)) {
    throw new Error("A nonblank discount code is required; use an empty list to clear codes.");
  }
  discountCodes = discountCodes.map((code) => code.trim());
  if (!isShopifyConfigured || !cartId) return null;

  const res = await shopifyFetch<{
    cartDiscountCodesUpdate: {
      cart: Cart;
      userErrors: CartUserError[];
      warnings?: { code: string }[];
    };
  }>({
    query: updateCartDiscountCodesMutation,
    variables: { cartId, discountCodes },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartDiscountCodesUpdate);
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
      warnings?: { code: string }[];
    };
  }>({
    query: addCartGiftCardCodesMutation,
    variables: { cartId, giftCardCodes },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartGiftCardCodesAdd);
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
      warnings?: { code: string }[];
    };
  }>({
    query: removeCartGiftCardCodesMutation,
    variables: { cartId, appliedGiftCardIds },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartGiftCardCodesRemove);
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
      warnings?: { code: string }[];
    };
  }>({
    query: updateCartBuyerIdentityMutation,
    variables: { cartId, buyerIdentity },
    cache: "no-store",
  });

  return confirmedCart(res.body.data?.cartBuyerIdentityUpdate);
}
