import { readdirSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "public", "coverage"]);
// The kit's own code, once installed, is not part of the received frontend.
const KIT_DIRS = new Set(["scripts", "e2e", "lib/shopify", "src/lib/shopify"]);
const KIT_FILES = /^(store-setup\..*\.json|frontend-audit\.json|playwright\.config\.mjs)$/;
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"]);
const SKIP_FILES = /^(package(-lock)?\.json|tsconfig.*\.json|.*\.d\.ts)$/;

/** Every source file of a received frontend, as sorted repo-relative paths with forward slashes. */
export function listSourceFiles(dir, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name) || KIT_DIRS.has(child)) continue;
      out.push(...listSourceFiles(dir, child));
    } else if (EXTENSIONS.has(path.extname(entry.name)) && !SKIP_FILES.test(entry.name) && !(rel === "" && KIT_FILES.test(entry.name))) {
      out.push(child);
    }
  }
  return out.sort();
}
