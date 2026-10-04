/**
 * Shopify never rejects an expired API version: it silently serves the oldest
 * supported one and says so in the X-Shopify-API-Version response header.
 * Comparing requested against served is the only reliable way to notice.
 */
export function versionStatus(requested, served) {
  if (!served) return { ok: false, note: `no X-Shopify-API-Version header, cannot confirm ${requested} was used` };
  if (served === requested) return { ok: true, note: `Shopify served ${served}` };
  return { ok: false, note: `asked for ${requested} but Shopify served ${served}; ${requested} is expired or unreleased, so this ran on a version nobody tested against` };
}

/** Facts the API can read but not change. A mismatch is a human decision, not a fix-it-in-code. */
export function shopMismatches(shop, config) {
  const problems = [];
  if (shop.currencyCode !== config.currency) {
    problems.push(`store currency is ${shop.currencyCode} but the config says ${config.currency}. Currency cannot change after the first order: stop and ask the owner.`);
  }
  if (shop.taxesIncluded !== config.pricesIncludeTax) {
    problems.push(`store says taxesIncluded=${shop.taxesIncluded} but the config says pricesIncludeTax=${config.pricesIncludeTax}. The API cannot change this; it is the tax-inclusive step (Settings > Taxes and duties).`);
  }
  return problems;
}
