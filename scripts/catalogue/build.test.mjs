import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeSources, buildCatalogue } from "./build.mjs";

test("collections are de-duplicated by handle, products are kept as given", () => {
  const merged = mergeSources([
    { collections: [{ handle: "a", title: "A" }], products: [{ handle: "p1" }] },
    { collections: [{ handle: "a", title: "A again" }, { handle: "b", title: "B" }], products: [{ handle: "p2" }] },
  ]);
  assert.deepEqual(merged.collections.map((c) => c.title), ["A", "B"]);
  assert.deepEqual(merged.products.map((p) => p.handle), ["p1", "p2"]);
});

async function setup(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "catalogue-"));
  const sourcesDir = path.join(dir, "sources");
  mkdirSync(sourcesDir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(sourcesDir, name), body);
  return { sourcesDir, outFile: path.join(dir, "catalog.json") };
}

const goodSource = `export default async () => ({ products: [{ handle: "a", title: "A", variants: [{ sku: "1", price: "5.00" }] }] });`;

test("a valid source builds data/catalog.json", async () => {
  const { sourcesDir, outFile } = await setup({ "one.mjs": goodSource });
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(readFileSync(outFile, "utf8")).products.length, 1);
});

test("an invalid catalogue is reported and nothing is written", async () => {
  const { sourcesDir, outFile } = await setup({ "bad.mjs": `export default async () => ({ products: [{ handle: "Bad Handle", title: "x", variants: [] }] });` });
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
  assert.equal(existsSync(outFile), false);
});

test("files starting with _ and test files are ignored", async () => {
  const { sourcesDir, outFile } = await setup({ "_template.mjs": "throw new Error('must not load')", "x.test.mjs": "throw new Error('must not load')", "one.mjs": goodSource });
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, true);
});

test("no sources is an error, not an empty catalogue", async () => {
  const { sourcesDir, outFile } = await setup({});
  const result = await buildCatalogue({ config: { tracksInventory: false }, sourcesDir, outFile });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /no source modules/);
});

import { readCatalogFile } from "./build.mjs";

test("readCatalogFile explains a missing file instead of throwing", async () => {
  const { outFile } = await setup({});
  const result = readCatalogFile(outFile);
  assert.equal(result.ok, false);
  assert.match(result.problem, /not found/);
  assert.match(result.problem, /catalogue-build/);
});

test("readCatalogFile returns arrays even when a key is absent, and explains broken JSON", async () => {
  const { outFile } = await setup({});
  writeFileSync(outFile, JSON.stringify({ products: [{ handle: "a" }] }));
  assert.deepEqual(readCatalogFile(outFile).catalog, { collections: [], products: [{ handle: "a" }] });
  writeFileSync(outFile, "{ not json");
  const broken = readCatalogFile(outFile);
  assert.equal(broken.ok, false);
  assert.match(broken.problem, /not valid JSON/);
});
