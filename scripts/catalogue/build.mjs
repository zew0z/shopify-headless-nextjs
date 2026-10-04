import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateCatalog } from "./format.mjs";

export const SOURCES_DIR = path.join(process.cwd(), "scripts", "catalogue", "sources");
export const CATALOG_FILE = path.join(process.cwd(), "data", "catalog.json");

export function mergeSources(results) {
  const seen = new Set();
  const collections = [];
  for (const result of results) {
    for (const collection of result.collections ?? []) {
      if (seen.has(collection.handle)) continue;
      seen.add(collection.handle);
      collections.push(collection);
    }
  }
  return { collections, products: results.flatMap((r) => r.products ?? []) };
}

/** Runs every source module, merges, validates, and writes only if valid. */
export async function buildCatalogue({ config, sourcesDir = SOURCES_DIR, outFile = CATALOG_FILE }) {
  const files = existsSync(sourcesDir)
    ? readdirSync(sourcesDir).filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && !f.endsWith(".test.mjs")).sort()
    : [];
  if (!files.length) return { ok: false, problems: [`no source modules in ${sourcesDir}. Copy _template.mjs and write one for this client.`], catalog: null };

  const results = [];
  for (const file of files) {
    const load = (await import(pathToFileURL(path.join(sourcesDir, file)).href)).default;
    results.push(await load());
  }
  const catalog = mergeSources(results);
  const problems = validateCatalog(catalog, { tracksInventory: config.tracksInventory });
  if (problems.length) return { ok: false, problems, catalog };

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`);
  return { ok: true, problems: [], catalog };
}
