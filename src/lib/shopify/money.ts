/**
 * Formats a Shopify price in the currency Shopify returned with it. Safe to
 * import from client components: it has no server-only dependencies.
 *
 * Pass the page's language (its <html lang>). The fixed default keeps the
 * server and the browser formatting alike, so hydration never mismatches.
 */

import type { Money } from "./types";

export function formatMoney(money: Money, locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: money.currencyCode }).format(Number(money.amount));
}
