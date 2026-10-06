import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findSdkDir } from "../shopify/sdk-dir.mjs";

register("./ts-hooks.mjs", import.meta.url);

/** Imports the repo's Storefront SDK with whatever Shopify env vars the caller has set. */
export function loadSdk() {
  const dir = findSdkDir(process.cwd());
  if (!dir) throw new Error("no src/lib/shopify or lib/shopify in this repo");
  return import(pathToFileURL(path.join(dir, "index.ts")).href);
}
