/** Refs ("type/handle") become the entry ids Shopify stores: a JSON list for list types, one id otherwise. */
export function resolveMetafields(metafields = [], refIds = {}) {
  return metafields.map(({ refs, ...metafield }) => {
    if (!refs) return metafield;
    const ids = refs.map((ref) => {
      if (!refIds[ref]) throw new Error(`${ref} has no id; push the content entries first`);
      return refIds[ref];
    });
    return { ...metafield, value: metafield.type.startsWith("list.") ? JSON.stringify(ids) : ids[0] };
  });
}

/**
 * Pure: one catalogue product -> one `productSet` input. No network, so every
 * field decision is unit-tested. Stock comes from the shop-wide `tracksInventory`
 * setting, never per product, so the catalogue cannot disagree with the config.
 */
export function buildProductInput(product, { collectionIds = {}, locationId, tracksInventory, skipImages = false, refIds = {} }) {
  if (tracksInventory && !locationId) throw new Error("tracksInventory is true but no locationId was given to set stock at");
  const optionNames = (product.options ?? []).map((option) => option.name);
  const collections = (product.collections ?? []).map((handle) => collectionIds[handle]).filter(Boolean);

  return {
    handle: product.handle,
    title: product.title,
    status: product.status ?? "ACTIVE",
    ...(product.descriptionHtml && { descriptionHtml: product.descriptionHtml }),
    ...(product.vendor && { vendor: product.vendor }),
    ...(product.productType && { productType: product.productType }),
    ...(product.tags?.length && { tags: product.tags }),
    ...(collections.length && { collections }),
    ...(optionNames.length && {
      productOptions: product.options.map((option) => ({ name: option.name, values: option.values.map((name) => ({ name })) })),
    }),
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      price: String(variant.price),
      compareAtPrice: variant.compareAtPrice != null ? String(variant.compareAtPrice) : null,
      ...(optionNames.length && { optionValues: optionNames.map((name) => ({ optionName: name, name: variant.options[name] })) }),
      inventoryItem: { tracked: Boolean(tracksInventory) },
      // Untracked stock never shows "sold out"; tracked stock must not oversell.
      inventoryPolicy: tracksInventory ? "DENY" : "CONTINUE",
      ...(tracksInventory && { inventoryQuantities: [{ locationId, name: "available", quantity: variant.quantity }] }),
      taxable: variant.taxable ?? true,
    })),
    ...(!skipImages && product.images?.length && {
      files: product.images.slice(0, 20).map((url) => ({ originalSource: url, contentType: "IMAGE" })),
    }),
    ...(product.metafields?.length && { metafields: resolveMetafields(product.metafields, refIds) }),
  };
}
