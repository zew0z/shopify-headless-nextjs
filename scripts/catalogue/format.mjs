/**
 * The import format (`data/catalog.json`) and its validator.
 *
 * Every source (vendor feed, sheet, scrape) normalises into this one shape and
 * only this shape is pushed. The validator rejects what the Admin API would
 * reject slowly or accept and embarrass you with. Add a rule every time a trap
 * catches you, so the next supplier cannot reintroduce it.
 */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Shopify's documented limits (shopify.dev productSet, 2026-10-04). Introspect if they change.
const MAX_VARIANTS = 2048;
const MAX_OPTIONS = 3;
const MAX_IMAGES = 20;

export function validateCatalog({ collections = [], products = [] }, { tracksInventory = false } = {}) {
  const problems = [];
  const collectionHandles = new Set();
  const productHandles = new Set();
  const skus = new Set();

  for (const collection of collections) {
    if (!HANDLE_PATTERN.test(collection.handle ?? "")) problems.push(`collection handle not url-safe: "${collection.handle}"`);
    if (collectionHandles.has(collection.handle)) problems.push(`duplicate collection handle: ${collection.handle}`);
    collectionHandles.add(collection.handle);
    if (!collection.title) problems.push(`collection ${collection.handle}: empty title`);
    if (collection.image && !/^https:\/\//.test(collection.image)) problems.push(`collection ${collection.handle}: image is not https`);
  }

  for (const product of products) {
    const id = product.handle ?? product.title ?? "<unnamed>";
    if (!HANDLE_PATTERN.test(product.handle ?? "")) problems.push(`product handle not url-safe: "${product.handle}"`);
    if (productHandles.has(product.handle)) problems.push(`duplicate product handle: ${product.handle}`);
    productHandles.add(product.handle);
    if (!product.title) problems.push(`${id}: empty title`);
    if (product.status && !["ACTIVE", "DRAFT", "ARCHIVED"].includes(product.status)) problems.push(`${id}: bad status "${product.status}"`);

    for (const handle of product.collections ?? []) {
      if (!collectionHandles.has(handle)) problems.push(`${id}: references unknown collection "${handle}"`);
    }

    for (const url of product.images ?? []) {
      if (typeof url !== "string") problems.push(`${id}: images contains a ${typeof url}, expected a url string`);
      else if (!/^https:\/\//.test(url)) problems.push(`${id}: image is not https: "${url.slice(0, 60)}"`);
    }
    if ((product.images ?? []).length > MAX_IMAGES) problems.push(`${id}: ${product.images.length} images; only the first ${MAX_IMAGES} are sent per product`);

    for (const metafield of product.metafields ?? []) {
      if (!metafield.namespace || !metafield.key || !metafield.type) problems.push(`${id}: metafield needs namespace, key and type`);
      if (metafield.type?.startsWith("list.") && typeof metafield.value === "string" && !metafield.value.startsWith("[")) {
        problems.push(`${id}: metafield ${metafield.key} is a list type, so value must be a JSON-encoded array string`);
      }
    }

    const outbound = (product.descriptionHtml ?? "").match(/<a\s[^>]*href=["']https?:\/\/[^"']+/gi);
    if (outbound) problems.push(`${id}: descriptionHtml links out (${outbound.length} link(s)); strip the anchors and keep the text`);

    const options = product.options ?? [];
    if (options.length > MAX_OPTIONS) problems.push(`${id}: ${options.length} options; Shopify allows ${MAX_OPTIONS}`);
    const declared = new Map(options.map((option) => [option.name, new Set(option.values)]));
    const variants = product.variants ?? [];
    if (!variants.length) problems.push(`${id}: no variants`);
    if (variants.length > MAX_VARIANTS) problems.push(`${id}: ${variants.length} variants; the limit is ${MAX_VARIANTS}`);

    const seenCombination = new Set();
    for (const variant of variants) {
      const label = `${id}/${variant.sku ?? "<no sku>"}`;
      if (!variant.sku) problems.push(`${id}: variant without a sku`);
      else if (skus.has(variant.sku)) problems.push(`duplicate sku across the catalogue: ${variant.sku}`);
      skus.add(variant.sku);

      if (!(Number(variant.price) > 0)) problems.push(`${label}: price must be a positive number`);
      if (variant.compareAtPrice != null && !(Number(variant.compareAtPrice) > Number(variant.price))) {
        problems.push(`${label}: compareAtPrice must exceed price, or the badge claims a fake discount`);
      }

      if (tracksInventory && !(Number.isInteger(variant.quantity) && variant.quantity >= 0)) {
        problems.push(`${label}: the shop tracks stock, so every variant needs an integer quantity >= 0`);
      }
      if (!tracksInventory && variant.tracked === true) {
        problems.push(`${label}: tracked is true but the shop does not track inventory (tracksInventory is false in the config)`);
      }

      const pairs = Object.entries(variant.options ?? {});
      if (pairs.length !== declared.size) problems.push(`${label}: sets ${pairs.length} option(s), the product declares ${declared.size}`);
      for (const [name, value] of pairs) {
        if (!declared.has(name)) problems.push(`${label}: option "${name}" is not declared on the product`);
        else if (!declared.get(name).has(value)) problems.push(`${label}: option value "${value}" is not in the declared values for "${name}"`);
      }
      const combination = pairs.map(([name, value]) => `${name}=${value}`).sort().join("|");
      if (seenCombination.has(combination)) problems.push(`${id}: two variants share the option combination ${combination || "(none)"}`);
      seenCombination.add(combination);
    }
  }
  return problems;
}
