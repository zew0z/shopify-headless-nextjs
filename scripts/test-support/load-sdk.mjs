import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);

/** Imports src/lib/shopify with whatever Shopify env vars the caller has set. */
export function loadSdk() {
  return import("../../src/lib/shopify/index.ts");
}
