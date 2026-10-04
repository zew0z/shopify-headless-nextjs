/**
 * store-setup.config.json holds every business decision, asked once.
 * Profiles fill market facts (currency, tax treatment). Decisions that cost real
 * money to get wrong (stock, shipping rates, free-shipping rule, compare-at,
 * reviews) never default: the human must answer them.
 */
export const PROFILES = {
  gr: { currency: "EUR", pricesIncludeTax: true, shippingCountries: ["GR"], invoicing: "app", checkoutSubdomain: "checkout" },
};

const isBool = (v) => typeof v === "boolean";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function validateConfig(raw) {
  const errors = [];
  const profile = PROFILES[raw.profile];
  if (!profile) errors.push(`profile must be one of: ${Object.keys(PROFILES).join(", ")}`);

  const merged = { ...raw };
  const assumed = [];
  for (const [key, value] of Object.entries(profile ?? {})) {
    if (!(key in raw)) {
      merged[key] = value;
      assumed.push(key);
    }
  }

  if (!/^[A-Z]{3}$/.test(merged.currency ?? "")) errors.push("currency must be a 3-letter code like EUR");
  for (const key of ["pricesIncludeTax", "tracksInventory", "compareAtIsReal", "wantsReviews"]) {
    if (!isBool(merged[key])) errors.push(`${key} must be true or false`);
  }
  if (!("freeShippingThreshold" in merged)) errors.push("freeShippingThreshold must be answered (a number, or null for none)");
  else if (merged.freeShippingThreshold !== null && !(isNum(merged.freeShippingThreshold) && merged.freeShippingThreshold > 0)) {
    errors.push("freeShippingThreshold must be a positive number or null");
  }
  if (!Array.isArray(merged.shippingCountries) || !merged.shippingCountries.length || !merged.shippingCountries.every((c) => /^[A-Z]{2}$/.test(c))) {
    errors.push("shippingCountries must be a non-empty list of 2-letter codes");
  }
  if (!["app", "none"].includes(merged.invoicing)) errors.push('invoicing must be "app" or "none"');
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(merged.siteDomain ?? "")) errors.push("siteDomain must be a bare hostname like example.gr (no https://, no path)");
  if (!/^[a-z0-9-]+$/.test(merged.checkoutSubdomain ?? "")) errors.push("checkoutSubdomain must be a single label like checkout");

  if (!Array.isArray(merged.shippingRates) || !merged.shippingRates.length) errors.push("shippingRates must have at least one rate");
  else {
    merged.shippingRates.forEach((rate, i) => {
      if (!rate.name || typeof rate.name !== "string") errors.push(`shippingRates[${i}].name is required`);
      if (!isNum(rate.price) || rate.price < 0) errors.push(`shippingRates[${i}].price must be a number >= 0`);
      const { minWeightKg: min, maxWeightKg: max } = rate;
      if (min !== undefined && !(isNum(min) && min >= 0)) errors.push(`shippingRates[${i}] weight min must be >= 0`);
      if (max !== undefined && !(isNum(max) && max > 0)) errors.push(`shippingRates[${i}] weight max must be > 0`);
      if (min !== undefined && max !== undefined && min >= max) errors.push(`shippingRates[${i}] weight min must be below max`);
    });
  }

  return { ok: errors.length === 0, errors, config: errors.length ? null : merged, assumed };
}
