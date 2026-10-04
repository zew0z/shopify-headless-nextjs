/**
 * A source module turns ONE client input (a vendor feed, a sheet, a scrape) into
 * the catalogue shape documented in ../format.mjs. Copy this file to a name that
 * does not start with `_`, e.g. `acme-feed.mjs`, and fill it in.
 *
 * Rules:
 *  - Pure and offline: read files from data/feeds/, never call the network.
 *  - Return { collections, products }. Do not validate here; the build does.
 *  - Keep the vendor's exact wording for display; normalise only for filtering.
 *  - Unit-test it next to this file as <name>.test.mjs against REAL rows from the feed.
 *
 * Read docs/catalogue-import.md before writing one.
 */
import { readFileSync } from "node:fs";

export default async function load() {
  const rows = JSON.parse(readFileSync("data/feeds/example.json", "utf8"));
  return {
    collections: [],
    products: rows.map((row) => ({
      handle: row.slug,
      title: row.name,
      variants: [{ sku: row.sku, price: String(row.price) }],
    })),
  };
}
