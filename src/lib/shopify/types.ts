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

export interface ProductOptionValue {
  id: string;
  name: string;
  /** Set when the shop gave this value a colour or a picture (a swatch). */
  swatch: { color: string | null; image: { previewImage: ShopifyImage | null } | null } | null;
}

export interface ProductOption {
  id: string;
  name: string;
  values: string[];
  optionValues: ProductOptionValue[];
}

/** An extra product field set in the Shopify admin (a metafield). */
export interface Metafield {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface MetafieldIdentifier {
  namespace: string;
  key: string;
}

export interface SellingPlan {
  id: string;
  name: string;
  description: string | null;
  recurringDeliveries: boolean;
  priceAdjustments: Array<{
    orderCount: number | null;
    adjustmentValue:
      | { __typename: "SellingPlanPercentagePriceAdjustment"; adjustmentPercentage: number }
      | { __typename: "SellingPlanFixedAmountPriceAdjustment"; adjustmentAmount: Money }
      | { __typename: "SellingPlanFixedPriceAdjustment"; price: Money };
  }>;
}

export interface SellingPlanGroup {
  name: string;
  options: Array<{ name: string; values: string[] }>;
  sellingPlans: { nodes: SellingPlan[] };
}

export interface SellingPlanAllocation {
  sellingPlan: {
    id: string;
    name: string;
    description?: string | null;
  };
  priceAdjustments: Array<{
    price: Money;
    compareAtPrice?: Money | null;
  }>;
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
  sellingPlanAllocations?: Connection<SellingPlanAllocation>;
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
  /** Product page only (getProduct): subscriptions and extra fields. */
  requiresSellingPlan?: boolean;
  sellingPlanGroups?: { nodes: SellingPlanGroup[] };
  /** In the order getProduct was asked for them; null where the product has none. */
  metafields?: Array<Metafield | null>;
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
// Filters, Pages & Search
// -------------------------------------------------------------

export interface ProductFilterInput {
  available?: boolean;
  price?: { min?: number; max?: number };
  productType?: string;
  productVendor?: string;
  tag?: string;
  variantOption?: { name: string; value: string };
  productMetafield?: { namespace: string; key: string; value: string };
}

export interface FilterValue {
  id: string;
  label: string;
  count: number;
  /** JSON string: pass JSON.parse(input) back as one ProductFilterInput. */
  input: string;
  swatch?: { color: string | null; image: { previewImage: ShopifyImage | null } | null } | null;
}

export interface Filter {
  id: string;
  label: string;
  type: "LIST" | "PRICE_RANGE" | "BOOLEAN";
  values: FilterValue[];
}

export interface ProductPage {
  products: Product[];
  pageInfo: PageInfo;
  /** Filters Shopify offers for this list (empty for getProductsPage). */
  filters: Filter[];
  /** Only for searchProducts. */
  totalCount?: number;
}

export type SearchSortKey = "RELEVANCE" | "PRICE";

export interface SearchProductsOptions {
  query: string;
  limit?: number;
  cursor?: string;
  sortKey?: SearchSortKey;
  reverse?: boolean;
  filters?: ProductFilterInput[];
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
  filters?: ProductFilterInput[];
  cache?: RequestCache;
  revalidate?: number;
}

// -------------------------------------------------------------
// Cart, Gift Cards & Checkout (2025 Standard)
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
  sellingPlanAllocation?: SellingPlanAllocation | null;
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

export interface AppliedGiftCard {
  /** Needed to remove the card: Shopify no longer removes by code. */
  id: string;
  lastCharacters: string;
  amountUsed: Money;
  balance: Money;
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
  appliedGiftCards?: AppliedGiftCard[];
  buyerIdentity?: CartBuyerIdentity;
}

export interface CartItemInput {
  merchandiseId: string;
  quantity: number;
  sellingPlanId?: string;
}

export interface CartLineUpdateInput {
  id: string;
  quantity: number;
  sellingPlanId?: string;
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

// -------------------------------------------------------------
// Store Metadata & Diagnostics
// -------------------------------------------------------------

export interface ShopInfo {
  name: string;
  description: string;
  primaryDomain: {
    url: string;
    host: string;
  };
  paymentSettings: {
    currencyCode: string;
    acceptedCardBrands: string[];
  };
}

export interface ConnectionHealthCheck {
  isConfigured: boolean;
  canConnect: boolean;
  domain: string;
  apiVersion: string;
  shopName?: string;
  currency?: string;
  latencyMs?: number;
  errors?: string[];
}

// -------------------------------------------------------------
// Shop, menus, policies and pages
// -------------------------------------------------------------

export interface ShopDetails {
  name: string;
  description: string | null;
  primaryDomain: { url: string; host: string };
  brand: { slogan: string | null; shortDescription: string | null; logo: { image: ShopifyImage | null } | null } | null;
}

export interface MenuItem {
  id: string;
  title: string;
  url: string | null;
  type: string;
  resourceId: string | null;
  items: MenuItem[];
}

export interface Menu {
  id: string;
  title: string;
  items: MenuItem[];
}

export interface ShopPolicy {
  id: string;
  title: string;
  handle: string;
  body: string;
  url: string;
}

export interface ContentPage {
  id: string;
  handle: string;
  title: string;
  body: string;
  bodySummary: string;
  seo: { title: string | null; description: string | null } | null;
}

/** A menu link as this site renders it: a path on the site, or an outside address. */
export interface MenuLink {
  title: string;
  href: string;
  external: boolean;
  items: MenuLink[];
}
