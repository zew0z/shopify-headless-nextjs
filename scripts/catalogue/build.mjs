import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateCatalog } from "./format.mjs";
import { wantedDefinitions } from "./definitions.mjs";

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
  const definitions = {
    metaobjects: results.flatMap((r) => r.definitions?.metaobjects ?? []),
    metafields: results.flatMap((r) => r.definitions?.metafields ?? []),
  };
  return { collections, products: results.flatMap((r) => r.products ?? []), definitions, metaobjects: results.flatMap((r) => r.metaobjects ?? []) };
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
  const problems = [
    ...validateCatalog(catalog, { tracksInventory: config.tracksInventory }),
    ...wantedDefinitions(catalog, { wantsReviews: config.wantsReviews }).problems,
  ];
  if (problems.length) return { ok: false, problems, catalog };

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`);
  return { ok: true, problems: [], catalog };
}

/** Reads data/catalog.json without ever throwing a stack trace at the agent. */
export function readCatalogFile(file = CATALOG_FILE) {
  if (!existsSync(file)) return { ok: false, catalog: null, problem: `${path.relative(process.cwd(), file)} not found. Run: pnpm shop-setup catalogue-build` };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return {
      ok: true,
      catalog: {
        collections: raw.collections ?? [],
        products: raw.products ?? [],
        definitions: { metaobjects: raw.definitions?.metaobjects ?? [], metafields: raw.definitions?.metafields ?? [] },
        metaobjects: raw.metaobjects ?? [],
      },
      problem: null,
    };
  } catch {
    return { ok: false, catalog: null, problem: `${path.relative(process.cwd(), file)} is not valid JSON. Re-run: pnpm shop-setup catalogue-build` };
  }
}
