/** Storefront GraphQL documents. Every operation declares the @inContext variables. */
const CTX = "$country: CountryCode, $language: LanguageCode";
const IN_CONTEXT = "@inContext(country: $country, language: $language)";

const IMAGE = /* GraphQL */ `
  fragment Image on Image {
    url
    altText
    width
    height
  }
`;

const MONEY = /* GraphQL */ `
  fragment Money on MoneyV2 {
    amount
    currencyCode
  }
`;

const PRODUCT_BASE = /* GraphQL */ `
  fragment ProductBase on Product {
    id
    handle
    title
    vendor
    availableForSale
    featuredImage { ...Image }
    priceRange {
      minVariantPrice { ...Money }
      maxVariantPrice { ...Money }
    }
    compareAtPriceRange {
      minVariantPrice { ...Money }
    }
  }
  ${IMAGE}
  ${MONEY}
`;

const PRODUCT_CARD = /* GraphQL */ `
  fragment ProductCard on Product {
    ...ProductBase
    variants(first: 2) {
      nodes { id availableForSale }
    }
  }
  ${PRODUCT_BASE}
`;

const PRODUCT_CONNECTION = /* GraphQL */ `
  pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
  nodes { ...ProductCard }
`;

const FILTERS = /* GraphQL */ `
  filters {
    id
    label
    type
    values { id label count input swatch { color } }
  }
`;

const PAGINATION_VARIABLES = "$first: Int, $last: Int, $after: String, $before: String";
const PAGINATION_ARGS = "first: $first, last: $last, after: $after, before: $before";

export const SHOP_QUERY = /* GraphQL */ `
  query Shop(${CTX}) ${IN_CONTEXT} {
    shop {
      name
      primaryDomain { url }
      paymentSettings { currencyCode }
    }
  }
`;

export const PRODUCTS_QUERY = /* GraphQL */ `
  query Products(${CTX}, ${PAGINATION_VARIABLES}, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) ${IN_CONTEXT} {
    products(${PAGINATION_ARGS}, query: $query, sortKey: $sortKey, reverse: $reverse) {
      ${PRODUCT_CONNECTION}
    }
  }
  ${PRODUCT_CARD}
`;

export const SEARCH_QUERY = /* GraphQL */ `
  query Search(
    ${CTX}, ${PAGINATION_VARIABLES}, $query: String!, $sortKey: SearchSortKeys, $reverse: Boolean, $filters: [ProductFilter!]
  ) ${IN_CONTEXT} {
    search(${PAGINATION_ARGS}, query: $query, types: [PRODUCT], sortKey: $sortKey, reverse: $reverse, productFilters: $filters, unavailableProducts: LAST) {
      filters: productFilters { id label type values { id label count input swatch { color } } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      nodes { ... on Product { ...ProductCard } }
    }
  }
  ${PRODUCT_CARD}
`;

const COLLECTION_FIELDS = /* GraphQL */ `
  id
  handle
  title
  description
  updatedAt
  image { ...Image }
  seo { title description }
`;

export const COLLECTION_QUERY = /* GraphQL */ `
  query Collection(
    ${CTX}, ${PAGINATION_VARIABLES}, $handle: String!, $sortKey: ProductCollectionSortKeys, $reverse: Boolean, $filters: [ProductFilter!]
  ) ${IN_CONTEXT} {
    collection(handle: $handle) {
      ${COLLECTION_FIELDS}
      products(${PAGINATION_ARGS}, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
        ${FILTERS}
        ${PRODUCT_CONNECTION}
      }
    }
  }
  ${PRODUCT_CARD}
`;

export const COLLECTIONS_QUERY = /* GraphQL */ `
  query Collections(${CTX}, $first: Int!, $after: String) ${IN_CONTEXT} {
    collections(first: $first, after: $after, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes { ${COLLECTION_FIELDS} }
    }
  }
  ${IMAGE}
`;

export const PRODUCT_QUERY = /* GraphQL */ `
  query Product(${CTX}, $handle: String!, $specMetafields: [HasMetafieldsIdentifier!]! = []) ${IN_CONTEXT} {
    product(handle: $handle) {
      ...ProductBase
      description
      descriptionHtml
      productType
      tags
      updatedAt
      seo { title description }
      images(first: 20) { nodes { ...Image } }
      options(first: 10) {
        name
        optionValues { name swatch { color } }
      }
      variants(first: 250) {
        nodes {
          id
          title
          sku
          availableForSale
          selectedOptions { name value }
          price { ...Money }
          compareAtPrice { ...Money }
          image { ...Image }
        }
      }
      collections(first: 10) { nodes { handle title } }
      specs: metafields(identifiers: $specMetafields) { key value }
    }
  }
  ${PRODUCT_BASE}
`;

export const RECOMMENDATIONS_QUERY = /* GraphQL */ `
  query Recommendations(${CTX}, $productId: ID!) ${IN_CONTEXT} {
    productRecommendations(productId: $productId) { ...ProductCard }
  }
  ${PRODUCT_CARD}
`;

export const SITEMAP_PRODUCTS_QUERY = /* GraphQL */ `
  query SitemapProducts(${CTX}, $after: String) ${IN_CONTEXT} {
    products(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { handle updatedAt }
    }
  }
`;

const CART = /* GraphQL */ `
  fragment Cart on Cart {
    id
    checkoutUrl
    totalQuantity
    cost {
      subtotalAmount { ...Money }
      totalAmount { ...Money }
      totalTaxAmount { ...Money }
    }
    discountCodes { code applicable }
    discountAllocations { targetType discountedAmount { ...Money } }
    lines(first: 100) {
      nodes {
        id
        quantity
        cost {
          totalAmount { ...Money }
          amountPerQuantity { ...Money }
          compareAtAmountPerQuantity { ...Money }
        }
        merchandise {
          ... on ProductVariant {
            id
            title
            availableForSale
            quantityAvailable
            selectedOptions { name value }
            image { ...Image }
            product { handle title featuredImage { ...Image } }
          }
        }
      }
    }
  }
  ${IMAGE}
  ${MONEY}
`;

const CART_PAYLOAD = "cart { ...Cart } userErrors { field message code } warnings { code }";

export const CART_QUERY = /* GraphQL */ `
  query Cart(${CTX}, $cartId: ID!) ${IN_CONTEXT} {
    cart(id: $cartId) { ...Cart }
  }
  ${CART}
`;

export const CART_CREATE = /* GraphQL */ `
  mutation CartCreate(${CTX}, $lines: [CartLineInput!]) ${IN_CONTEXT} {
    result: cartCreate(input: { lines: $lines, buyerIdentity: { countryCode: $country } }) { ${CART_PAYLOAD} }
  }
  ${CART}
`;

export const CART_LINES_ADD = /* GraphQL */ `
  mutation CartLinesAdd(${CTX}, $cartId: ID!, $lines: [CartLineInput!]!) ${IN_CONTEXT} {
    result: cartLinesAdd(cartId: $cartId, lines: $lines) { ${CART_PAYLOAD} }
  }
  ${CART}
`;

export const CART_LINES_UPDATE = /* GraphQL */ `
  mutation CartLinesUpdate(${CTX}, $cartId: ID!, $lines: [CartLineUpdateInput!]!) ${IN_CONTEXT} {
    result: cartLinesUpdate(cartId: $cartId, lines: $lines) { ${CART_PAYLOAD} }
  }
  ${CART}
`;

export const CART_LINES_REMOVE = /* GraphQL */ `
  mutation CartLinesRemove(${CTX}, $cartId: ID!, $lineIds: [ID!]!) ${IN_CONTEXT} {
    result: cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { ${CART_PAYLOAD} }
  }
  ${CART}
`;

export const CART_DISCOUNT_CODES = /* GraphQL */ `
  mutation CartDiscountCodesUpdate(${CTX}, $cartId: ID!, $discountCodes: [String!]!) ${IN_CONTEXT} {
    result: cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) { ${CART_PAYLOAD} }
  }
  ${CART}
`;

export const VARIANT_BY_OPTIONS_QUERY = /* GraphQL */ `
  query VariantByOptions(${CTX}, $handle: String!, $selectedOptions: [SelectedOptionInput!]!) ${IN_CONTEXT} {
    product(handle: $handle) {
      variantBySelectedOptions(selectedOptions: $selectedOptions, ignoreUnknownOptions: true, caseInsensitiveMatch: true) { id }
    }
  }
`;

export const METAOBJECTS_QUERY = /* GraphQL */ `
  query GetMetaobjects($type: String!, $first: Int!, $country: CountryCode, $language: LanguageCode) @inContext(country: $country, language: $language) {
    metaobjects(type: $type, first: $first, sortKey: "updated_at", reverse: true) {
      nodes {
        handle
        updatedAt
        fields {
          key
          value
          reference {
            __typename
            ... on MediaImage {
              image {
                ...Image
              }
            }
            ... on Product {
              handle
              title
              featuredImage {
                ...Image
              }
            }
            ... on Collection {
              handle
              title
            }
          }
          references(first: 25) {
            nodes {
              __typename
              ... on Metaobject {
                handle
                fields {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  }
  ${IMAGE}
`;
