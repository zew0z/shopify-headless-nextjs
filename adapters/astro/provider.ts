/** Shopify Storefront API → commerce contract. */
import type { SortOption } from "./commerce-types";
import type {
  AddLineInput,
  Cart,
  CartResponse,
  Collection,
  CommerceImage,
  CommerceProvider,
  CommerceSession,
  ListingKind,
  ListingQuery,
  Product,
  ProductCardData,
  ProductConnection,
} from "./commerce-types";
import { createStorefront, type StorefrontOptions } from "./client";
import {
  CART_CREATE,
  CART_DISCOUNT_CODES,
  CART_LINES_ADD,
  CART_LINES_REMOVE,
  CART_LINES_UPDATE,
  CART_QUERY,
  COLLECTION_QUERY,
  COLLECTIONS_QUERY,
  PRODUCT_QUERY,
  PRODUCTS_QUERY,
  RECOMMENDATIONS_QUERY,
  SEARCH_QUERY,
  SHOP_QUERY,
  SITEMAP_PRODUCTS_QUERY,
  VARIANT_BY_OPTIONS_QUERY,
} from "./queries";
import type {
  ShopifyCart,
  ShopifyCollection,
  ShopifyImage,
  ShopifyProduct,
  ShopifyProductCard,
  ShopifyProductConnection,
  ShopifyUserError,
  ShopInfo,
} from "./shopify-types";

// ---------------------------------------------------------------- mapping

const WIDTHS = [240, 360, 480, 640, 800, 1080, 1440, 1920];

/** Resized URL from Shopify's image CDN (it negotiates WebP/AVIF itself). */
function sized(url: string, width: number) {
  const next = new URL(url);
  next.searchParams.set("width", String(width));
  return next.toString();
}

function image(source: ShopifyImage | null): CommerceImage | null {
  if (!source) return null;
  const max = source.width ?? Infinity;
  const widths = WIDTHS.filter((w) => w <= max);
  return {
    url: sized(source.url, Math.min(800, source.width ?? 800)),
    altText: source.altText,
    width: source.width,
    height: source.height,
    srcset: (widths.length ? widths : [Math.min(WIDTHS[0]!, max)]).map((w) => `${sized(source.url, w)} ${w}w`).join(", "),
  };
}

function card(node: ShopifyProductCard): ProductCardData {
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    vendor: node.vendor,
    availableForSale: node.availableForSale,
    image: image(node.featuredImage),
    price: node.priceRange.minVariantPrice,
    maxPrice: node.priceRange.maxVariantPrice,
    compareAtPrice: Number(node.compareAtPriceRange.minVariantPrice.amount) > Number(node.priceRange.minVariantPrice.amount) ? node.compareAtPriceRange.minVariantPrice : null,
  };
}

// "Default Title" is Shopify's placeholder option for products without variants.
const realOption = (option: { name: string; value: string }) => option.value !== "Default Title";

function product(node: ShopifyProduct): Product {
  return {
    ...card(node),
    productType: node.productType,
    specs: (node.specs ?? []).filter((spec): spec is { key: string; value: string } => Boolean(spec?.value)),
    description: node.description,
    descriptionHtml: node.descriptionHtml,
    updatedAt: node.updatedAt,
    seo: node.seo,
    images: node.images.nodes.map((i) => image(i)!),
    options: node.options
      .filter((o) => !(o.optionValues.length === 1 && o.optionValues[0]!.name === "Default Title"))
      .map((o) => ({ name: o.name, values: o.optionValues.map((v) => ({ name: v.name, swatch: v.swatch?.color ?? null })) })),
    variants: node.variants.nodes.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      availableForSale: v.availableForSale,
      selectedOptions: v.selectedOptions.filter(realOption),
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      image: image(v.image),
    })),
    collections: node.collections.nodes,
  };
}

function collection(node: ShopifyCollection): Collection {
  return { ...node, image: image(node.image) };
}

function connection(node: ShopifyProductConnection): ProductConnection {
  return {
    products: node.nodes.map(card),
    filters: (node.filters ?? []).map((f) => ({ ...f, values: f.values.map((v) => ({ ...v, swatch: v.swatch?.color ?? null })) })),
    pageInfo: {
      nextCursor: node.pageInfo.hasNextPage ? node.pageInfo.endCursor : null,
      previousCursor: node.pageInfo.hasPreviousPage ? node.pageInfo.startCursor : null,
    },
  };
}

function cart(node: ShopifyCart): Cart {
  return {
    totalQuantity: node.totalQuantity,
    subtotal: node.cost.subtotalAmount,
    discount: null,
    shipping: null,
    tax: node.cost.totalTaxAmount,
    total: node.cost.totalAmount,
    discountCodes: node.discountCodes,
    lines: node.lines.nodes.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      total: line.cost.totalAmount,
      unitPrice: line.cost.amountPerQuantity,
      compareAtUnitPrice: line.cost.compareAtAmountPerQuantity,
      available: line.merchandise.availableForSale,
      maxQuantity: line.merchandise.quantityAvailable,
      options: line.merchandise.selectedOptions.filter(realOption),
      image: image(line.merchandise.image ?? line.merchandise.product.featuredImage),
      productHandle: line.merchandise.product.handle,
      productTitle: line.merchandise.product.title,
    })),
  };
}

// ---------------------------------------------------------------- catalogue

const SORTS: Record<ListingKind, readonly SortOption[]> = {
  all: ["best-selling", "newest", "price-asc", "price-desc", "title"],
  collection: ["featured", "best-selling", "newest", "price-asc", "price-desc", "title"],
  search: ["featured", "price-asc", "price-desc"],
};

const SORT_KEYS: Record<ListingKind, Partial<Record<SortOption, [string, boolean]>>> = {
  all: { "best-selling": ["BEST_SELLING", false], newest: ["CREATED_AT", true], "price-asc": ["PRICE", false], "price-desc": ["PRICE", true], title: ["TITLE", false] },
  collection: {
    featured: ["COLLECTION_DEFAULT", false],
    "best-selling": ["BEST_SELLING", false],
    newest: ["CREATED", true],
    "price-asc": ["PRICE", false],
    "price-desc": ["PRICE", true],
    title: ["TITLE", false],
  },
  search: { featured: ["RELEVANCE", false], "price-asc": ["PRICE", false], "price-desc": ["PRICE", true] },
};

function listingVariables(kind: ListingKind, query: ListingQuery) {
  const [sortKey, reverse] = SORT_KEYS[kind][query.sort] ?? [null, false];
  const page = query.before ? { last: query.pageSize, before: query.before } : { first: query.pageSize, after: query.after || null };
  const filters = (query.filters ?? []).flatMap((input) => {
    try {
      const value = JSON.parse(input) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
    } catch {
      return [];
    }
  });
  return { ...page, sortKey, reverse, filters };
}

/** One provider per configuration; request-specific language, IP and cart stay explicit. */
export function createShopifyCommerce(options: StorefrontOptions): CommerceProvider & { getShopInfo(lang: string): Promise<ShopInfo> } {
const storefront = createStorefront(options);
// ---------------------------------------------------------------- cart

type MutationPayload = { result: { cart: ShopifyCart | null; userErrors: ShopifyUserError[] } };

function cartResponse(payload: MutationPayload, errorCode: "unavailable" | "coupon" = "unavailable", existingToken: string | null = null): CartResponse {
  const { cart: node, userErrors } = payload.result;
  return {
    cart: node ? cart(node) : null,
    token: node?.id ?? (userErrors.length ? existingToken : null),
    // Shopify can return the cart together with an error (e.g. quantity capped at stock).
    ...(userErrors.length && { error: { code: errorCode, message: userErrors[0]!.message } }),
  };
}

async function fetchCart(session: CommerceSession): Promise<ShopifyCart | null> {
  if (!session.token) return null;
  const data = await storefront<{ cart: ShopifyCart | null }>({ query: CART_QUERY, lang: session.lang, buyerIp: session.clientAddress, variables: { cartId: session.token } });
  return data.cart;
}

const mutate = (session: CommerceSession, query: string, variables: Record<string, unknown>) =>
  storefront<MutationPayload>({ query, lang: session.lang, buyerIp: session.clientAddress, variables: { cartId: session.token, ...variables } });

async function resolveVariant(session: CommerceSession, input: AddLineInput) {
  if (input.options.length) {
    if (!input.handle) return null;
    const { product: found } = await storefront<{ product: { variantBySelectedOptions: { id: string } | null } | null }>({
      query: VARIANT_BY_OPTIONS_QUERY,
      lang: session.lang,
      variables: { handle: input.handle, selectedOptions: input.options },
    });
    // Posted choices are authoritative, including native forms with a stale hidden id.
    return found?.variantBySelectedOptions?.id ?? null;
  }
  return input.merchandiseId?.startsWith("gid://shopify/ProductVariant/") ? input.merchandiseId : null;
}

async function setDiscountCodes(session: CommerceSession, change: (codes: string[]) => string[]): Promise<CartResponse> {
  const current = await fetchCart(session);
  if (!current) return { cart: null, token: null, error: { code: "notFound" } };
  const codes = change(current.discountCodes.map((d) => d.code));
  return cartResponse(await mutate(session, CART_DISCOUNT_CODES, { discountCodes: codes }), "coupon", session.token);
}

// ---------------------------------------------------------------- provider

const shopifyProvider: CommerceProvider = {
  name: "Shopify",
  isConfigured: () => storefront.isConfigured(),
  sorts: SORTS,
  filterKinds: ["collection", "search"],

  async listProducts(query) {
    if (query.filters?.length) throw new Error("Shopify facets require a collection or search listing.");
    const { filters: _unused, ...variables } = listingVariables("all", query);
    void _unused;
    const data = await storefront<{ products: ShopifyProductConnection }>({ query: PRODUCTS_QUERY, lang: query.lang, variables });
    return connection({ ...data.products, filters: [] });
  },

  async searchProducts(term, query) {
    const data = await storefront<{ search: ShopifyProductConnection }>({
      query: SEARCH_QUERY,
      lang: query.lang,
      variables: { ...listingVariables("search", query), query: term },
    });
    return connection(data.search);
  },

  async getCollection(handle, query) {
    const data = await storefront<{ collection: (ShopifyCollection & { products: ShopifyProductConnection }) | null }>({
      query: COLLECTION_QUERY,
      lang: query.lang,
      variables: { ...listingVariables("collection", query), handle },
    });
    if (!data.collection) return null;
    const { products, ...rest } = data.collection;
    return { collection: collection(rest), connection: connection(products) };
  },

  async listCollections(lang) {
    const result: Collection[] = [];
    let after: string | null = null;
    for (let page = 0; page < 100; page++) {
      const data: { collections: { nodes: ShopifyCollection[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await storefront({ query: COLLECTIONS_QUERY, lang, variables: { first: 250, after } });
      result.push(...data.collections.nodes.map(collection));
      if (!data.collections.pageInfo.hasNextPage) return result;
      const next = data.collections.pageInfo.endCursor;
      if (!next || next === after) throw new Error("Shopify returned an invalid collections cursor.");
      after = next;
    }
    throw new Error("Collection pagination limit reached; the sitemap is not complete.");
  },

  async getProduct(handle, lang) {
    const data = await storefront<{ product: ShopifyProduct | null }>({ query: PRODUCT_QUERY, lang, variables: { handle, specMetafields: options.specMetafields ?? [] } });
    // Optional namespaces/keys are supplied by the owner, never guessed from the site.
    return data.product ? product(data.product) : null;
  },

  async getRecommendations(item, lang, limit) {
    const data = await storefront<{ productRecommendations: ShopifyProductCard[] | null }>({ query: RECOMMENDATIONS_QUERY, lang, variables: { productId: item.id } });
    return (data.productRecommendations ?? []).slice(0, limit).map(card);
  },

  async sitemap() {
    const lang = options.defaultLanguage ?? "en";
    const collections = await shopifyProvider.listCollections(lang);
    const products: { handle: string; updatedAt: string | null }[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { handle: string; updatedAt: string }[] } } = await storefront({
        query: SITEMAP_PRODUCTS_QUERY,
        lang,
        variables: { after },
      });
      products.push(...data.products.nodes);
      if (!data.products.pageInfo.hasNextPage) return { products, collections: collections.map((c) => ({ handle: c.handle, updatedAt: c.updatedAt })) };
      const next = data.products.pageInfo.endCursor;
      if (!next || next === after) throw new Error("Shopify returned an invalid products cursor.");
      after = next;
    }
    throw new Error("Product sitemap pagination limit reached; the sitemap is not complete.");
  },

  async getCart(session) {
    const node = await fetchCart(session);
    return { cart: node ? cart(node) : null, token: node?.id ?? null };
  },

  async addLine(session, input) {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000) return { cart: null, token: session.token, error: { code: "invalid" } };
    const merchandiseId = await resolveVariant(session, input);
    if (!merchandiseId) return { cart: null, token: session.token, error: { code: "unavailable" } };
    const lines = [{ merchandiseId, quantity: input.quantity }];
    // Only a successful read proving the cart absent may create a replacement.
    // A failed mutation can have reached Shopify: never retry it as a fresh cart.
    const current = await fetchCart(session);
    const payload = current
      ? await mutate(session, CART_LINES_ADD, { lines })
      : await storefront<MutationPayload>({ query: CART_CREATE, lang: session.lang, buyerIp: session.clientAddress, variables: { lines } });
    return cartResponse(payload, "unavailable", current ? session.token : null);
  },

  async updateLine(session, lineId, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000) return { cart: null, token: session.token, error: { code: "invalid" } };
    return cartResponse(await mutate(session, CART_LINES_UPDATE, { lines: [{ id: lineId, quantity }] }), "unavailable", session.token);
  },

  async removeLine(session, lineId) {
    return cartResponse(await mutate(session, CART_LINES_REMOVE, { lineIds: [lineId] }), "unavailable", session.token);
  },

  applyDiscount: (session, code) => setDiscountCodes(session, (codes) => [...new Set([...codes, code])]),
  removeDiscount: (session, code) => setDiscountCodes(session, (codes) => codes.filter((c) => c.toLowerCase() !== code.toLowerCase())),

  checkout: {
    kind: "hosted",
    async url(session) {
      const node = await fetchCart(session);
      return node && node.totalQuantity > 0 ? storefront.checkoutUrl(node.checkoutUrl) : null;
    },
  },
};

return Object.assign(shopifyProvider, {
  getShopInfo: async (lang: string) => (await storefront<{ shop: ShopInfo }>({ query: SHOP_QUERY, lang })).shop,
});
}
