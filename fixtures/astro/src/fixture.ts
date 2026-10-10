/** Deterministic test backend only. Never installed by kit-install or used as a production fallback. */
import { createAstroCommerce } from "./lib/shopify/astro";
const money = (amount: string) => ({ amount, currencyCode: "CAD" });
const image = { url: "https://cdn.shopify.com/fixture.jpg", altText: "Fixture", width: 800, height: 600 };
const card = { id: "gid://shopify/Product/1", handle: "fixture", title: "Fixture", vendor: "", availableForSale: true, featuredImage: image, priceRange: { minVariantPrice: money("25"), maxVariantPrice: money("25") }, compareAtPriceRange: { minVariantPrice: money("0") } };
const product = { ...card, description: "", descriptionHtml: "", updatedAt: "2026-10-09", seo: { title: null, description: null }, images: { nodes: [image] }, options: [], variants: { nodes: [{ id: "gid://shopify/ProductVariant/2", title: "Default Title", sku: null, availableForSale: true, selectedOptions: [], price: money("25"), compareAtPrice: null, image }] }, collections: { nodes: [] } };
let quantity = 0;
let discounted = false;
const getCart = () => ({ id: "gid://shopify/Cart/fixture?key=fixture-only", checkoutUrl: "https://fixture.myshopify.com/checkouts/fixture", totalQuantity: quantity, cost: { subtotalAmount: money(String(quantity * 25 - (discounted && quantity ? 2.5 : 0))), totalAmount: money(String(quantity * 25 - (discounted && quantity ? 2.5 : 0))), totalTaxAmount: null }, discountCodes: discounted ? [{ code: "SAVE", applicable: true }] : [], discountAllocations: discounted && quantity ? [{ targetType: "LINE_ITEM", discountedAmount: money("2.50") }] : [], lines: { nodes: quantity ? [{ id: "gid://shopify/CartLine/1", quantity, cost: { totalAmount: money(String(quantity * 25 - (discounted && quantity ? 2.5 : 0))), amountPerQuantity: money("25"), compareAtAmountPerQuantity: null }, merchandise: { id: "gid://shopify/ProductVariant/2", title: "Default Title", availableForSale: true, quantityAvailable: 3, selectedOptions: [], image, product: { handle: card.handle, title: card.title, featuredImage: image } } }] : [] } });
const fakeStorefront: typeof fetch = async (_url, init) => {
  const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
  let data;
  if (/query Products\(/.test(query)) data = { products: { nodes: [card], pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null } } };
  else if (/query Product\(/.test(query)) data = { product };
  else if (/query Cart\(/.test(query)) data = { cart: getCart() };
  else if (/mutation/.test(query)) {
    const lines = variables.lines as { quantity: number }[] | undefined;
    if (/mutation CartDiscountCodesUpdate/.test(query)) discounted = (variables.discountCodes as string[]).some((code) => code === "SAVE");
    else if (/mutation CartLinesRemove/.test(query)) quantity = 0;
    else if (/mutation CartLinesUpdate|mutation CartCreate/.test(query)) quantity = lines?.[0]?.quantity ?? 0;
    else quantity += lines?.[0]?.quantity ?? 0;
    const adjusted = quantity > 3;
    quantity = Math.min(quantity, 3);
    data = { result: { cart: getCart(), userErrors: [], warnings: adjusted ? [{ code: "MERCHANDISE_NOT_ENOUGH_STOCK", message: "PRIVATE-WARNING-SENTINEL", target: "PRIVATE-TARGET-SENTINEL" }] : [] } };
  } else throw new Error("Unexpected fixture operation");
  return Response.json({ data });
};
export const commerce = createAstroCommerce({ fetch: fakeStorefront, country: "CA" });
