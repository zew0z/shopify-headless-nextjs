/** Only confirmed stock-warning codes are exposed; never forward messages or targets. */
export function stockWarnings(warnings: { code?: unknown }[] = []): string[] {
  return [...new Set(warnings.flatMap(({ code }) => code === "MERCHANDISE_NOT_ENOUGH_STOCK" || code === "MERCHANDISE_OUT_OF_STOCK" ? [code] : []))];
}

/** Continue-selling/untracked merchandise can be buyable without a positive known count. */
export function stockLimit(available: boolean, quantity: number | null | undefined): number | null {
  if (available && !(typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0)) return null;
  return typeof quantity === "number" && Number.isFinite(quantity) ? quantity : null;
}

/** Sum returned merchandise allocations exactly; shipping and foreign currency are excluded. */
export function merchandiseDiscount(allocations: { targetType: string; discountedAmount: { amount: string; currencyCode: string } }[] = [], currencyCode: string) {
  const amounts = allocations.filter((a) => a.targetType === "LINE_ITEM" && a.discountedAmount.currencyCode === currencyCode)
    .map((a) => a.discountedAmount.amount).filter((amount) => /^\d+(?:\.\d+)?$/.test(amount));
  const decimals = Math.max(2, ...amounts.map((amount) => amount.split(".")[1]?.length ?? 0));
  const total = amounts.reduce((sum, amount) => {
    const [whole, fraction = ""] = amount.split(".");
    return sum + BigInt(whole! + fraction.padEnd(decimals, "0"));
  }, BigInt(0));
  if (total === BigInt(0)) return null;
  const digits = total.toString().padStart(decimals + 1, "0");
  return { amount: digits.slice(0, -decimals) + "." + digits.slice(-decimals), currencyCode };
}
