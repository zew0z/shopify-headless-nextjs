import { adminGraphQL } from "../shopify/admin-client.mjs";

export function inventoryMismatches(variants, tracksInventory) {
  const wrong = variants.filter((v) => Boolean(v.tracked) !== Boolean(tracksInventory));
  if (!wrong.length) return [];
  const names = wrong.slice(0, 10).map((v) => v.sku).join(", ");
  return [`${wrong.length} of ${variants.length} variants disagree with tracksInventory=${tracksInventory}: ${names}${wrong.length > 10 ? ", ..." : ""}`];
}

const VARIANTS = `query($after: String) { productVariants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { sku inventoryItem { tracked } } } }`;

export async function fetchVariantTracking() {
  const out = [];
  let after = null;
  for (;;) {
    const { productVariants } = await adminGraphQL(VARIANTS, { after });
    out.push(...productVariants.nodes.map((v) => ({ sku: v.sku, tracked: v.inventoryItem.tracked })));
    if (!productVariants.pageInfo.hasNextPage) return out;
    after = productVariants.pageInfo.endCursor;
  }
}
