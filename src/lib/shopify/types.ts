/**
 * Comprehensive Shopify Storefront API TypeScript Definitions
 */

// -------------------------------------------------------------
// Common & Primitives
// -------------------------------------------------------------

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface ShopifyImage {
  url: string;
  altText: string | null;
  width?: number;
  height?: number;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
}

export interface Connection<T> {
  pageInfo?: PageInfo;
  edges: Array<{
    cursor?: string;
    node: T;
  }>;
}

// -------------------------------------------------------------
// Product & Variants
// -------------------------------------------------------------

export interface SelectedOption {
  name: string;
  value: string;
}

export interface ProductOption {
  id: string;
  name: string;
  values: string[];
}

export interface ProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  selectedOptions: SelectedOption[];
  price: Money;
  compareAtPrice?: Money | null;
  image?: ShopifyImage | null;
  sku?: string | null;
  quantityAvailable?: number | null;
}

export interface PriceRange {
  minVariantPrice: Money;
  maxVariantPrice?: Money | null;
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml?: string;
  availableForSale: boolean;
  vendor: string;
  tags: string[];
  productType?: string;
  featuredImage: ShopifyImage | null;
  images: Connection<ShopifyImage>;
  priceRange: PriceRange;
  compareAtPriceRange?: PriceRange | null;
  options: ProductOption[];
  variants: Connection<ProductVariant>;
  seo?: {
    title: string | null;
    description: string | null;
  };
}

export type ProductSortKey =
  | "TITLE"
  | "PRICE"
  | "BEST_SELLING"
  | "CREATED_AT"
  | "ID"
  | "MANUAL"
  | "RELEVANCE";

export interface GetProductsOptions {
  query?: string;
  sortKey?: ProductSortKey;
  reverse?: boolean;
  limit?: number;
  cursor?: string;
  country?: string;
  language?: string;
  cache?: RequestCache;
  revalidate?: number;
}

// -------------------------------------------------------------
// Predictive Search
// -------------------------------------------------------------

export interface SearchQuerySuggestion {
  text: string;
  styledText?: string;
}

export interface PredictiveSearchResult {
  queries: SearchQuerySuggestion[];
  products: Product[];
  collections: Collection[];
}

// -------------------------------------------------------------
// Collections
// -------------------------------------------------------------

export interface Collection {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml?: string;
  updatedAt?: string;
  image?: ShopifyImage | null;
  seo?: {
    title: string | null;
    description: string | null;
  };
}

export type CollectionSortKey =
  | "TITLE"
  | "PRICE"
  | "BEST_SELLING"
  | "CREATED"
  | "MANUAL"
  | "COLLECTION_DEFAULT";

export interface GetCollectionProductsOptions {
  handle: string;
  sortKey?: CollectionSortKey;
  reverse?: boolean;
  limit?: number;
  cursor?: string;
  cache?: RequestCache;
  revalidate?: number;
}

// -------------------------------------------------------------
// Cart & Checkout (2025 Standard)
// -------------------------------------------------------------

export interface CartLineMerchandise {
  id: string;
  title: string;
  selectedOptions: SelectedOption[];
  price: Money;
  product: {
    id: string;
    handle: string;
    title: string;
    featuredImage: ShopifyImage | null;
  };
}

export interface CartLineCost {
  totalAmount: Money;
  subtotalAmount?: Money;
}

export interface CartLine {
  id: string;
  quantity: number;
  cost: CartLineCost;
  merchandise: CartLineMerchandise;
}

export interface CartCost {
  subtotalAmount: Money;
  totalAmount: Money;
  totalTaxAmount?: Money | null;
  totalDutyAmount?: Money | null;
}

export interface CartDiscountCode {
  code: string;
  applicable: boolean;
}

export interface CartBuyerIdentity {
  email?: string | null;
  phone?: string | null;
  countryCode?: string | null;
  customerAccessToken?: string | null;
}

export interface Cart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: CartCost;
  lines: Connection<CartLine>;
  discountCodes?: CartDiscountCode[];
  buyerIdentity?: CartBuyerIdentity;
}

export interface CartItemInput {
  merchandiseId: string;
  quantity: number;
}

export interface CartLineUpdateInput {
  id: string;
  quantity: number;
}

export interface CartUserError {
  field: string[];
  message: string;
  code?: string;
}

// -------------------------------------------------------------
// Client / Network Types
// -------------------------------------------------------------

export interface ShopifyGraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
  extensions?: {
    code?: string;
    [key: string]: unknown;
  };
}

export interface ShopifyResponse<T> {
  data?: T;
  errors?: ShopifyGraphQLError[];
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}
