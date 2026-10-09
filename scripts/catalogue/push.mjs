/**
 * Writes the catalogue into Shopify through the Admin API. Idempotent: everything
 * is keyed on handle, so a second run updates and never duplicates. Collections
 * and products are published to every sales channel afterwards; skipping that is
 * the classic "Admin has 200 products, the site shows none" bug.
 * UNVERIFIED until run against a development store (Task 9).
 */
import { existsSync, readFileSync } from "node:fs";
import { adminGraphQL, publicationInputs } from "../shopify/admin-client.mjs";
import { bad, heading, info, ok } from "../shopify/env.mjs";
import { buildProductInput } from "./build-input.mjs";
import { pushDefinitions, wantedDefinitions } from "./definitions.mjs";
import { validateCatalog } from "./format.mjs";
import { pushEntries, validateEntries } from "./metaobjects.mjs";
import { IMAGE_MAP_FILE, applyImageMap, rehostImages, rehostTargets } from "./rehost.mjs";

const COLLECTION_BY_HANDLE = `query($handle: String!) { collectionByHandle(handle: $handle) { id } }`;
const COLLECTION_CREATE = `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { field message } } }`;
const COLLECTION_UPDATE = `mutation($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id } userErrors { field message } } }`;
const PUBLISH = `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
const LOCATIONS = `query { locations(first: 10) { nodes { id name isActive } } }`;

// `identifier` is an argument of the mutation, not a field of ProductSetInput.
const PRODUCT_SET = `
  mutation($identifier: ProductSetIdentifiers!, $input: ProductSetInput!) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product { id handle variants(first: 100) { nodes { id sku } } }
      userErrors { field message code }
    }
  }`;

export function describePlan(catalog, { limit } = {}) {
  const lines = catalog.collections.map((c) => `collection ${c.handle} - ${c.title}`);
  const products = limit ? catalog.products.slice(0, limit) : catalog.products;
  for (const p of products) {
    lines.push(`product    ${p.handle.padEnd(40)} ${String(p.variants.length).padStart(3)}v  ${(p.images ?? []).length} img  [${(p.collections ?? []).join(", ")}]`);
  }
  return lines;
}

async function pickLocation(locationId) {
  const active = (await adminGraphQL(LOCATIONS)).locations.nodes.filter((l) => l.isActive);
  const found = locationId ? active.find((l) => l.id === locationId) : active.length === 1 ? active[0] : null;
  if (!found) {
    bad(`pick a stock location with --location=<id>: ${active.map((l) => `${l.name} ${l.id}`).join(", ") || "none active"}`);
    process.exit(1);
  }
  return found.id;
}

export async function pushCatalogue({ config, catalog, dryRun = false, limit, only, skipImages = false, locationId, rehost = [] }) {
  const tracksInventory = config.tracksInventory;
  const wanted = wantedDefinitions(catalog, { wantsReviews: config.wantsReviews });
  const problems = [...validateCatalog(catalog, { tracksInventory, compareAtIsReal: config.compareAtIsReal }), ...wanted.problems, ...validateEntries(catalog.metaobjects, wanted.metaobjects)];
  heading(`Catalogue  ${catalog.collections.length} collections, ${catalog.products.length} products`);
  if (problems.length) {
    problems.slice(0, 40).forEach((p) => bad(p));
    if (problems.length > 40) info(`... and ${problems.length - 40} more`);
    console.error(`\n  ${problems.length} problem(s). Fix the source module, not the store.\n`);
    process.exit(1);
  }
  ok("validates");

  if (dryRun) {
    info(`definitions: ${wanted.metaobjects.length} content types, ${wanted.metafields.length} product fields; ${(catalog.metaobjects ?? []).length} content entries`);
    describePlan(catalog, { limit }).forEach((line) => info(line));
    if (rehost.length) info(`would re-upload ${rehostTargets(catalog, rehost).length} photo(s) from ${rehost.join(", ")}`);
    ok("dry run, nothing was written");
    return;
  }

  if (rehost.length && !skipImages) {
    heading(`Re-uploading photos from ${rehost.join(", ")}`);
    const { failed } = await rehostImages(rehostTargets(catalog, rehost));
    failed.forEach((f) => bad(`${f.url}: ${f.error}`));
    if (failed.length) info(`${failed.length} photo(s) not re-uploaded. Those products keep the supplier url; list them for the owner.`);
  }
  // Earlier runs' uploads count even without --rehost, so a re-run never goes back to a blocked url.
  if (existsSync(IMAGE_MAP_FILE)) catalog = applyImageMap(catalog, JSON.parse(readFileSync(IMAGE_MAP_FILE, "utf8")));

  const location = tracksInventory ? await pickLocation(locationId) : undefined;
  const { nodes, input: publishTo } = await publicationInputs();
  heading(`Publishing to: ${nodes.map((p) => p.name).join(", ")}`);

  heading("Definitions and content entries");
  await pushDefinitions(wanted);
  const refIds = await pushEntries(catalog.metaobjects ?? []);

  const collectionIds = {};
  for (const [index, collection] of catalog.collections.entries()) {
    const existing = (await adminGraphQL(COLLECTION_BY_HANDLE, { handle: collection.handle })).collectionByHandle;
    if (only === "products") {
      if (existing) collectionIds[collection.handle] = existing.id;
      continue;
    }
    const input = {
      handle: collection.handle,
      title: collection.title,
      ...(collection.description && { descriptionHtml: `<p>${collection.description}</p>` }),
      ...(collection.image && !skipImages && { image: { src: collection.image } }),
    };
    const data = existing
      ? await adminGraphQL(COLLECTION_UPDATE, { input: { ...input, id: existing.id } })
      : await adminGraphQL(COLLECTION_CREATE, { input });
    const id = existing ? data.collectionUpdate.collection.id : data.collectionCreate.collection.id;
    collectionIds[collection.handle] = id;
    await adminGraphQL(PUBLISH, { id, input: publishTo });
    console.log(`  ${existing ? "~" : "+"} ${String(index + 1).padStart(3)}/${catalog.collections.length}  ${collection.handle}`);
  }

  if (only === "collections") return;
  const products = limit ? catalog.products.slice(0, limit) : catalog.products;
  heading(`Products${skipImages ? " (images skipped)" : ""}`);
  let pushed = 0;
  for (const product of products) {
    const input = buildProductInput(product, { collectionIds, locationId: location, tracksInventory, skipImages, refIds });
    const data = await adminGraphQL(PRODUCT_SET, { identifier: { handle: product.handle }, input });
    await adminGraphQL(PUBLISH, { id: data.productSet.product.id, input: publishTo });
    pushed += 1;
    console.log(`  + ${String(pushed).padStart(3)}/${products.length}  ${product.handle.slice(0, 44).padEnd(44)} ${String(product.variants.length).padStart(3)}v`);
  }
  ok(`${pushed} products pushed. Next: pnpm shop-setup catalogue-verify`);
}
