/**
 * The commerce contract. Pages and components only know these shapes; a backend
 * module (shopify, woocommerce, …) maps its API onto them and registers itself
 * with `provides: { commerce: () => import("./lib/provider") … }`.
 */
export type Locale = string;
export type SortOption = "featured" | "best-selling" | "newest" | "price-asc" | "price-desc" | "title";

// ---------------------------------------------------------------- catalogue

export interface Money {
  /** Decimal string in major units, e.g. "19.90". */
  amount: string;
  currencyCode: string;
}

export interface CommerceImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  /** Ready-made `srcset` (the backend knows which sizes exist). */
  srcset: string | null;
}

export interface SelectedOption {
  name: string;
  value: string;
}

export interface ProductCardData {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  availableForSale: boolean;
  image: CommerceImage | null;
  price: Money;
  /** Highest variant price; differs from `price` → "from" prices. */
  maxPrice: Money;
  compareAtPrice: Money | null;
}

export interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  availableForSale: boolean;
  selectedOptions: SelectedOption[];
  price: Money;
  compareAtPrice: Money | null;
  image: CommerceImage | null;
}

export interface ProductOption {
  name: string;
  values: { name: string; swatch: string | null }[];
}

export interface Product extends ProductCardData {
  productType?: string;
  specs?: Array<{ key: string; value: string }>;
  description: string;
  /** Merchant-authored HTML from the backend. */
  descriptionHtml: string;
  updatedAt: string | null;
  seo: { title: string | null; description: string | null };
  images: CommerceImage[];
  /** Variant options; empty for products without choices. */
  options: ProductOption[];
  /** At least one entry; a simple product has a single variant. */
  variants: ProductVariant[];
  collections: { handle: string; title: string }[];
}

export interface Collection {
  id: string;
  handle: string;
  title: string;
  description: string;
  updatedAt: string | null;
  image: CommerceImage | null;
  seo: { title: string | null; description: string | null };
}

/**
 * A facet. `values[].input` is opaque to the UI: a JSON string the backend
 * produced and understands when it comes back in `?filter=`.
 */
export interface ProductFilter {
  id: string;
  label: string;
  type: "LIST" | "PRICE_RANGE" | "BOOLEAN";
  values: { id: string; label: string; count: number; input: string; swatch: string | null }[];
}

export interface PageInfo {
  /** Opaque cursors (Shopify cursors, WooCommerce page numbers). */
  nextCursor: string | null;
  previousCursor: string | null;
}

export interface ProductConnection {
  products: ProductCardData[];
  filters: ProductFilter[];
  pageInfo: PageInfo;
}

export type ListingKind = "all" | "collection" | "search";

export interface ListingQuery {
  lang: Locale;
  sort: SortOption;
  after?: string | null;
  before?: string | null;
  /** Filter inputs as returned in `ProductFilter.values[].input`, plus a normalized `{"price":{min,max}}`. */
  filters?: string[];
  pageSize: number;
}

// ---------------------------------------------------------------- cart

export interface CartLine {
  /** Backend line id (Shopify line gid, WooCommerce item key). */
  id: string;
  quantity: number;
  total: Money;
  unitPrice: Money;
  compareAtUnitPrice: Money | null;
  available: boolean;
  /** null = no known limit. */
  maxQuantity: number | null;
  options: SelectedOption[];
  image: CommerceImage | null;
  productHandle: string;
  productTitle: string;
}

export interface Cart {
  totalQuantity: number;
  subtotal: Money;
  /** Discounts already deducted, when the backend reports them. */
  discount: Money | null;
  shipping: Money | null;
  tax: Money | null;
  total: Money;
  lines: CartLine[];
  discountCodes: { code: string; applicable: boolean }[];
}

/** The visitor's session with the backend: a cart id or cart token kept in an httpOnly cookie. */
export interface CommerceSession {
  lang: Locale;
  clientAddress: string;
  token: string | null;
}

export type CommerceErrorCode = "invalid" | "rateLimited" | "unavailable" | "notFound" | "backend" | "coupon";

/** Every cart call returns the (possibly new) session token so the cookie can follow it. */
export interface CartResponse {
  cart: Cart | null;
  token: string | null;
  error?: { code: CommerceErrorCode; message?: string };
}

export interface AddLineInput {
  merchandiseId?: string;
  handle?: string;
  options: SelectedOption[];
  quantity: number;
}

// ---------------------------------------------------------------- checkout

export interface Address {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
  email: string;
}

export interface ShippingPackage {
  packageId: string;
  rates: { id: string; label: string; price: Money; selected: boolean }[];
}

export interface CheckoutState {
  cart: Cart;
  billing: Address;
  shipping: Address;
  needsShipping: boolean;
  packages: ShippingPackage[];
  /** Enabled payment method ids, e.g. ["cod", "bacs"]. */
  paymentMethods: string[];
}

export interface CheckoutStateResponse {
  state: CheckoutState | null;
  token: string | null;
  error?: { code: CommerceErrorCode; message?: string };
}

export interface PlaceOrderInput {
  billing: Address;
  shipping: Address;
  paymentMethod: string;
  note: string;
}

export interface PlacedOrder {
  id: string;
  number: string;
  key: string;
  email: string;
  paymentMethod: string;
  /** Redirect gateways: the page where the shopper pays (card, wallet). null for offline methods. */
  paymentUrl: string | null;
  lang: Locale;
}

export interface OrderSummary {
  id: string;
  number: string;
  /** Backend status, normalized to the ones the order page distinguishes. */
  status: "paid" | "pending" | "failed" | "cancelled" | "other";
  /** The order can still be paid (retry on the gateway's page). */
  needsPayment: boolean;
  lines: { title: string; quantity: number; total: Money }[];
  subtotal: Money;
  shipping: Money | null;
  discount: Money | null;
  tax: Money | null;
  total: Money;
  shippingAddress: Address | null;
  billingAddress: Address | null;
}

/** Checkout on the backend's own hosted page (Shopify). */
export interface HostedCheckout {
  kind: "hosted";
  url(session: CommerceSession): Promise<string | null>;
}

/** Checkout rendered by this site and submitted through the backend's API (WooCommerce Store API). */
export interface NativeCheckout {
  kind: "native";
  getState(session: CommerceSession): Promise<CheckoutStateResponse>;
  updateCustomer(session: CommerceSession, address: { billing: Address; shipping: Address }): Promise<CheckoutStateResponse>;
  selectShippingRate(session: CommerceSession, packageId: string, rateId: string): Promise<CheckoutStateResponse>;
  placeOrder(
    session: CommerceSession,
    input: PlaceOrderInput,
  ): Promise<{ ok: true; order: Omit<PlacedOrder, "lang"> } | { ok: false; code: CommerceErrorCode; message?: string; token: string | null }>;
  getOrder(lang: Locale, reference: { id: string; key: string; email: string }): Promise<OrderSummary | null>;
}

// ---------------------------------------------------------------- provider

export interface CommerceProvider {
  /** Shown in logs and the admin dashboard. */
  name: string;
  isConfigured(): boolean;
  /** Sorts each listing kind supports, first = default. */
  sorts: Record<ListingKind, readonly SortOption[]>;

  listProducts(query: ListingQuery): Promise<ProductConnection>;
  searchProducts(term: string, query: ListingQuery): Promise<ProductConnection>;
  getCollection(handle: string, query: ListingQuery): Promise<{ collection: Collection; connection: ProductConnection } | null>;
  listCollections(lang: Locale): Promise<Collection[]>;
  getProduct(handle: string, lang: Locale): Promise<Product | null>;
  getRecommendations(product: Product, lang: Locale, limit: number): Promise<ProductCardData[]>;
  /** Every product and collection for sitemap.xml. */
  sitemap(): Promise<{ products: { handle: string; updatedAt: string | null }[]; collections: { handle: string; updatedAt: string | null }[] }>;

  getCart(session: CommerceSession): Promise<CartResponse>;
  addLine(session: CommerceSession, input: AddLineInput): Promise<CartResponse>;
  updateLine(session: CommerceSession, lineId: string, quantity: number): Promise<CartResponse>;
  removeLine(session: CommerceSession, lineId: string): Promise<CartResponse>;
  applyDiscount(session: CommerceSession, code: string): Promise<CartResponse>;
  removeDiscount(session: CommerceSession, code: string): Promise<CartResponse>;

  checkout: HostedCheckout | NativeCheckout;
}
