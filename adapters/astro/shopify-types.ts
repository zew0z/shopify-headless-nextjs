/** Raw Storefront API shapes this module queries (mapped to commerce types in provider.ts). */
export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface ShopifyPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface ShopifySelectedOption {
  name: string;
  value: string;
}

export interface ShopifyProductCard {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  availableForSale: boolean;
  featuredImage: ShopifyImage | null;
  priceRange: { minVariantPrice: ShopifyMoney; maxVariantPrice: ShopifyMoney };
  compareAtPriceRange: { minVariantPrice: ShopifyMoney };
}

export interface ShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  availableForSale: boolean;
  selectedOptions: ShopifySelectedOption[];
  price: ShopifyMoney;
  compareAtPrice: ShopifyMoney | null;
  image: ShopifyImage | null;
}

export interface ShopifyProduct extends ShopifyProductCard {
  productType?: string;
  specs?: Array<{ key: string; value: string } | null>;
  description: string;
  descriptionHtml: string;
  updatedAt: string;
  seo: { title: string | null; description: string | null };
  images: { nodes: ShopifyImage[] };
  options: { name: string; optionValues: { name: string; swatch: { color: string | null } | null }[] }[];
  variants: { nodes: ShopifyVariant[] };
  collections: { nodes: { handle: string; title: string }[] };
}

export interface ShopifyCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  updatedAt: string;
  image: ShopifyImage | null;
  seo: { title: string | null; description: string | null };
}

export interface ShopifyFilter {
  id: string;
  label: string;
  type: "LIST" | "PRICE_RANGE" | "BOOLEAN";
  values: { id: string; label: string; count: number; input: string; swatch: { color: string | null } | null }[];
}

export interface ShopifyProductConnection {
  pageInfo: ShopifyPageInfo;
  filters?: ShopifyFilter[];
  nodes: ShopifyProductCard[];
}

export interface ShopifyCartLine {
  id: string;
  quantity: number;
  cost: { totalAmount: ShopifyMoney; amountPerQuantity: ShopifyMoney; compareAtAmountPerQuantity: ShopifyMoney | null };
  merchandise: {
    id: string;
    title: string;
    availableForSale: boolean;
    quantityAvailable: number | null;
    selectedOptions: ShopifySelectedOption[];
    image: ShopifyImage | null;
    product: { handle: string; title: string; featuredImage: ShopifyImage | null };
  };
}

export interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: { subtotalAmount: ShopifyMoney; totalAmount: ShopifyMoney; totalTaxAmount: ShopifyMoney | null };
  lines: { nodes: ShopifyCartLine[] };
  discountCodes: { code: string; applicable: boolean }[];
}

export interface ShopifyUserError {
  field: string[] | null;
  message: string;
  code: string | null;
}

export interface ShopInfo {
  name: string;
  primaryDomain: { url: string };
  paymentSettings: { currencyCode: string };
}
