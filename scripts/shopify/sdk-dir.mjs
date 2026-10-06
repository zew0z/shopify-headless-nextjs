import { existsSync } from "node:fs";
import path from "node:path";

/** The Storefront SDK lives in src/lib/shopify or, in repos without src/, lib/shopify. */
export function findSdkDir(root) {
  for (const rel of ["src/lib/shopify", "lib/shopify"]) {
    const dir = path.join(root, rel);
    if (existsSync(path.join(dir, "index.ts"))) return dir;
  }
  return null;
}
