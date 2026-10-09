import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeSources, buildCatalogue } from "./build.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

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

test("a was-price fails the build when the owner said was-prices are not real, and nothing is written", async () => {
  const source = `export default async () => ({ products: [{ handle: "a", title: "A", variants: [{ sku: "1", price: "5.00", compareAtPrice: "8.00" }] }] });`;
  const { sourcesDir, outFile } = await setup({ "one.mjs": source });
  const refused = await buildCatalogue({ config: { tracksInventory: false, compareAtIsReal: false }, sourcesDir, outFile });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.problems.filter((p) => /compareAtPrice/.test(p)).map((p) => p.split(":")[0]), ["a/1"]);
  assert.equal(existsSync(outFile), false);
  const allowed = await buildCatalogue({ config: { tracksInventory: false, compareAtIsReal: true }, sourcesDir, outFile });
  assert.equal(allowed.ok, true);
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
  assert.deepEqual(readCatalogFile(outFile).catalog, { collections: [], products: [{ handle: "a" }], definitions: { metaobjects: [], metafields: [] }, metaobjects: [] });
  writeFileSync(outFile, "{ not json");
  const broken = readCatalogFile(outFile);
  assert.equal(broken.ok, false);
  assert.match(broken.problem, /not valid JSON/);
});

test("definitions and content entries from every source are merged", () => {
  const merged = mergeSources([
    { products: [], definitions: { metaobjects: [{ type: "material" }] }, metaobjects: [{ type: "material", handle: "oak", fields: { label: "Oak" } }] },
    { products: [], definitions: { metafields: [{ namespace: "custom", key: "seats" }] }, metaobjects: [{ type: "material", handle: "ash", fields: { label: "Ash" } }] },
  ]);
  assert.deepEqual(merged.definitions, { metaobjects: [{ type: "material" }], metafields: [{ namespace: "custom", key: "seats" }] });
  assert.deepEqual(merged.metaobjects.map((m) => m.handle), ["oak", "ash"]);
});

test("reading the catalogue keeps definitions and content entries", () => {
  const root = makeFixture({ "catalog.json": { collections: [], products: [], definitions: { metaobjects: [{ type: "material" }], metafields: [] }, metaobjects: [{ type: "material", handle: "oak", fields: {} }] } });
  const { catalog } = readCatalogFile(`${root}/catalog.json`);
  assert.equal(catalog.definitions.metaobjects[0].type, "material");
  assert.equal(catalog.metaobjects[0].handle, "oak");
});
