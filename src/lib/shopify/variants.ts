/**
 * Picking a variant from the options a shopper chose. Safe in client components:
 * imports only types.
 */
import type { Product, ProductVariant } from "./types";

type WithVariants = Pick<Product, "variants">;
const list = (product: WithVariants) => product.variants.edges.map((e) => e.node);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function matches(variant: ProductVariant, picked: Record<string, string>): boolean {
  return Object.entries(picked).every(([name, value]) =>
    variant.selectedOptions.some((o) => same(o.name, name) && o.value === value)
  );
}

/** The variant whose options match every pick, or null. */
export function findVariant(product: WithVariants, picked: Record<string, string>): ProductVariant | null {
  return list(product).find((v) => matches(v, picked)) ?? null;
}

/** The variant to show before the shopper picks: the first for sale, else the first. */
export function defaultVariant(product: WithVariants): ProductVariant | null {
  const all = list(product);
  return all.find((v) => v.availableForSale) ?? all[0] ?? null;
}

/** Whether choosing this value, keeping the other picks, lands on a variant for sale. */
export function isOptionValueAvailable(product: WithVariants, picked: Record<string, string>, name: string, value: string): boolean {
  const others = Object.fromEntries(Object.entries(picked).filter(([n]) => !same(n, name)));
  return list(product).some((v) => v.availableForSale && matches(v, { ...others, [name]: value }));
}
