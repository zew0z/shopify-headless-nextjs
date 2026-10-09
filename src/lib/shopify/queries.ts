/**
 * Shopify Storefront GraphQL Queries & Fragments
 */

/**
 * A GraphQL document may define each fragment once. productFragment and
 * collectionFragment both embed imageFragment, so a document that uses both
 * needs the repeats dropped.
 */
export function dedupeFragments(source: string): string {
  const seen = new Set<string>();
  return source
    .split(/(?=^\s*fragment\s)/m)
    .filter((block) => {
      const name = block.match(/^\s*fragment\s+(\w+)/)?.[1];
      if (!name) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .join("");
}

// -------------------------------------------------------------
// Shared Fragments
// -------------------------------------------------------------

export const shopQuery = /* GraphQL */ `
  query GetShopInfo {
    shop {
      name
      description
      primaryDomain {
        url
        host
      }
      paymentSettings {
        currencyCode
        acceptedCardBrands
      }
    }
  }
`;

/** What Shopify analytics needs about the shop (getShopAnalytics). */
export const shopAnalyticsQuery = /* GraphQL */ `
  query GetShopAnalytics {
    shop {
      id
      primaryDomain {
        host
      }
      paymentSettings {
        currencyCode
      }
    }
    localization {
      language {
        isoCode
      }
    }
  }
`;

export const imageFragment = /* GraphQL */ `
  fragment ImageFragment on Image {
    url
    altText
    width
    height
  }
`;

export const productFragment = /* GraphQL */ `
  fragment ProductFragment on Product {
    id
    handle
    title
    description
    descriptionHtml
    availableForSale
    vendor
    productType
    tags
    featuredImage {
      ...ImageFragment
    }
    images(first: 10) {
      edges {
        node {
          ...ImageFragment
        }
      }
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
        currencyCode
      }
    }
    compareAtPriceRange {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
        currencyCode
      }
    }
    options {
      id
      name
      values
      optionValues {
        id
        name
        swatch {
          color
          image {
            previewImage {
              ...ImageFragment
            }
          }
        }
      }
    }
    variants(first: 50) {
      edges {
        node {
          id
          title
          availableForSale
          sku
          selectedOptions {
            name
            value
          }
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
          image {
            ...ImageFragment
          }
        }
      }
    }
    seo {
      title
      description
    }
  }
  ${imageFragment}
`;

/** What a metafield read selects: the value, and the content entries a reference field points at. */
const metafieldSelection = /* GraphQL */ `
  namespace
  key
  type
  value
  reference {
    __typename
    ... on Metaobject {
      handle
      fields { key value }
    }
  }
  references(first: 25) {
    nodes {
      __typename
      ... on Metaobject {
        handle
        fields { key value }
      }
    }
  }
`;

/**
 * Extras a list read asks for: the fields named in $metafields, and the product's
 * collections when $withCollections. Only valid in a document that declares
 * $metafields: [HasMetafieldsIdentifier!]! and $withCollections: Boolean!.
 */
export const productListExtrasFragment = /* GraphQL */ `
  fragment ProductListExtras on Product {
    metafields(identifiers: $metafields) {
      ${metafieldSelection}
    }
    collections(first: 10) @include(if: $withCollections) {
      nodes {
        handle
        title
      }
    }
  }
`;

export const collectionFragment = /* GraphQL */ `
  fragment CollectionFragment on Collection {
    id
    handle
    title
    description
    descriptionHtml
    updatedAt
    image {
      ...ImageFragment
    }
    seo {
      title
      description
    }
  }
  ${imageFragment}
`;

/**
 * Uses ImageFragment without embedding it, so it is only valid in a document that
 * also has productFragment (which embeds imageFragment).
 */
export const filterFragment = /* GraphQL */ `
  fragment FilterFragment on Filter {
    id
    label
    type
    values {
      id
      label
      count
      input
      swatch {
        color
        image {
          previewImage {
            ...ImageFragment
          }
        }
      }
    }
  }
`;

export const cartFragment = /* GraphQL */ `
  fragment CartFragment on Cart {
    id
    updatedAt
    checkoutUrl
    totalQuantity
    cost {
      subtotalAmount {
        amount
        currencyCode
      }
      totalAmount {
        amount
        currencyCode
      }
      totalTaxAmount {
        amount
        currencyCode
      }
      totalDutyAmount {
        amount
        currencyCode
      }
    }
    lines(first: 100) {
      edges {
        node {
          id
          quantity
          cost {
            totalAmount {
              amount
              currencyCode
            }
            amountPerQuantity {
              amount
              currencyCode
            }
          }
          merchandise {
            ... on ProductVariant {
              id
              title
              sku
              selectedOptions {
                name
                value
              }
              price {
                amount
                currencyCode
              }
              product {
                id
                handle
                title
                vendor
                productType
                featuredImage {
                  ...ImageFragment
                }
              }
            }
          }
          sellingPlanAllocation {
            sellingPlan {
              id
              name
              description
            }
          }
        }
      }
    }
    discountCodes {
      code
      applicable
    }
    appliedGiftCards {
      id
      lastCharacters
      amountUsed {
        amount
        currencyCode
      }
      balance {
        amount
        currencyCode
      }
    }
    buyerIdentity {
      email
      phone
      countryCode
      customer {
        id
        email
        firstName
        lastName
      }
    }
  }
  ${imageFragment}
`;

// -------------------------------------------------------------
// Queries
// -------------------------------------------------------------

export const getProductsQuery = /* GraphQL */ `
  query GetProducts(
    $first: Int = 20
    $after: String
    $query: String
    $sortKey: ProductSortKeys = RELEVANCE
    $reverse: Boolean = false
    $metafields: [HasMetafieldsIdentifier!]! = []
    $withCollections: Boolean! = false
  ) {
    products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ...ProductFragment
          ...ProductListExtras
        }
      }
    }
  }
  ${dedupeFragments(productFragment + productListExtrasFragment)}
`;

export const getProductByHandleQuery = /* GraphQL */ `
  query GetProductByHandle($handle: String!, $metafields: [HasMetafieldsIdentifier!]! = []) {
    product(handle: $handle) {
      ...ProductFragment
      requiresSellingPlan
      sellingPlanGroups(first: 5) {
        nodes {
          name
          options {
            name
            values
          }
          sellingPlans(first: 10) {
            nodes {
              id
              name
              description
              recurringDeliveries
              priceAdjustments {
                orderCount
                adjustmentValue {
                  __typename
                  ... on SellingPlanPercentagePriceAdjustment {
                    adjustmentPercentage
                  }
                  ... on SellingPlanFixedAmountPriceAdjustment {
                    adjustmentAmount {
                      amount
                      currencyCode
                    }
                  }
                  ... on SellingPlanFixedPriceAdjustment {
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
      metafields(identifiers: $metafields) {
        ${metafieldSelection}
      }
    }
  }
  ${productFragment}
`;

export const getProductStockQuery = /* GraphQL */ `
  query GetProductStock($handle: String!) {
    product(handle: $handle) {
      variants(first: 250) {
        nodes {
          id
          quantityAvailable
        }
      }
    }
  }
`;

export const getProductRecommendationsQuery = /* GraphQL */ `
  query GetProductRecommendations($productId: ID!) {
    productRecommendations(productId: $productId) {
      ...ProductFragment
    }
  }
  ${productFragment}
`;

export const getCollectionsQuery = /* GraphQL */ `
  query GetCollections($first: Int = 20, $after: String) {
    collections(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ...CollectionFragment
        }
      }
    }
  }
  ${collectionFragment}
`;

export const getCollectionByHandleQuery = /* GraphQL */ `
  query GetCollectionByHandle($handle: String!) {
    collection(handle: $handle) {
      ...CollectionFragment
    }
  }
  ${collectionFragment}
`;

export const getCollectionProductsQuery = /* GraphQL */ `
  query GetCollectionProducts(
    $handle: String!
    $first: Int = 20
    $after: String
    $sortKey: ProductCollectionSortKeys = COLLECTION_DEFAULT
    $reverse: Boolean = false
    $filters: [ProductFilter!]
    $metafields: [HasMetafieldsIdentifier!]! = []
    $withCollections: Boolean! = false
  ) {
    collection(handle: $handle) {
      products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        filters {
          ...FilterFragment
        }
        edges {
          cursor
          node {
            ...ProductFragment
            ...ProductListExtras
          }
        }
      }
    }
  }
  ${dedupeFragments(productFragment + productListExtrasFragment + filterFragment)}
`;

export const searchProductsQuery = /* GraphQL */ `
  query SearchProducts(
    $query: String!
    $first: Int = 20
    $after: String
    $sortKey: SearchSortKeys = RELEVANCE
    $reverse: Boolean = false
    $filters: [ProductFilter!]
    $metafields: [HasMetafieldsIdentifier!]! = []
    $withCollections: Boolean! = false
  ) {
    search(query: $query, first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, types: [PRODUCT], productFilters: $filters, unavailableProducts: LAST) {
      totalCount
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      productFilters {
        ...FilterFragment
      }
      edges {
        cursor
        node {
          __typename
          ... on Product {
            ...ProductFragment
            ...ProductListExtras
          }
        }
      }
    }
  }
  ${dedupeFragments(productFragment + productListExtrasFragment + filterFragment)}
`;

export const predictiveSearchQuery = /* GraphQL */ `
  query PredictiveSearch(
    $query: String!
    $limit: Int = 5
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    predictiveSearch(
      query: $query
      limit: $limit
      limitScope: EACH
      types: [PRODUCT, COLLECTION, QUERY]
    ) {
      queries {
        text
        styledText
      }
      products {
        ...ProductFragment
      }
      collections {
        ...CollectionFragment
      }
    }
  }
  ${dedupeFragments(productFragment + collectionFragment)}
`;

export const getCartQuery = /* GraphQL */ `
  query GetCart($cartId: ID!) {
    cart(id: $cartId) {
      ...CartFragment
    }
  }
  ${cartFragment}
`;

// -------------------------------------------------------------
// Shop, menus, policies and pages
// -------------------------------------------------------------

export const shopDetailsQuery = /* GraphQL */ `
  query GetShopDetails {
    shop {
      name
      description
      primaryDomain {
        url
        host
      }
      brand {
        slogan
        shortDescription
        logo {
          image {
            ...ImageFragment
          }
        }
      }
    }
  }
  ${imageFragment}
`;

const menuItemFields = /* GraphQL */ `
  id
  title
  url
  type
  resourceId
`;

export const menuQuery = /* GraphQL */ `
  query GetMenu($handle: String!) {
    menu(handle: $handle) {
      id
      title
      items {
        ${menuItemFields}
        items {
          ${menuItemFields}
          items {
            ${menuItemFields}
          }
        }
      }
    }
  }
`;

const policyFields = /* GraphQL */ `
  id
  title
  handle
  body
  url
`;

export const policiesQuery = /* GraphQL */ `
  query GetPolicies {
    shop {
      privacyPolicy { ${policyFields} }
      refundPolicy { ${policyFields} }
      shippingPolicy { ${policyFields} }
      termsOfService { ${policyFields} }
    }
  }
`;

export const pageQuery = /* GraphQL */ `
  query GetPage($handle: String!) {
    page(handle: $handle) {
      id
      handle
      title
      body
      bodySummary
      seo {
        title
        description
      }
    }
  }
`;

/** Content entries of one type (Content > Metaobjects in the admin). Unknown types return no nodes. */
export const metaobjectsQuery = /* GraphQL */ `
  query GetMetaobjects($type: String!, $first: Int!) {
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
                ...ImageFragment
              }
            }
            ... on Product {
              handle
              title
              featuredImage {
                ...ImageFragment
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
  ${imageFragment}
`;
