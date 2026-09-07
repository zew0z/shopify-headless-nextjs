/**
 * Shopify Storefront GraphQL Queries & Fragments
 */

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

export const cartFragment = /* GraphQL */ `
  fragment CartFragment on Cart {
    id
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
          }
          merchandise {
            ... on ProductVariant {
              id
              title
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
        }
      }
    }
  }
  ${productFragment}
`;

export const getProductByHandleQuery = /* GraphQL */ `
  query GetProductByHandle($handle: String!) {
    product(handle: $handle) {
      ...ProductFragment
    }
  }
  ${productFragment}
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
  ) {
    collection(handle: $handle) {
      products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
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
          }
        }
      }
    }
  }
  ${productFragment}
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
  ${productFragment}
  ${collectionFragment}
`;

export const getCartQuery = /* GraphQL */ `
  query GetCart($cartId: ID!) {
    cart(id: $cartId) {
      ...CartFragment
    }
  }
  ${cartFragment}
`;
