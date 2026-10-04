import { spawnSync } from "node:child_process";
import { parseArgs } from "./args.mjs";
import { buildCatalogue, readCatalogFile } from "../catalogue/build.mjs";
import { fetchVariantTracking, inventoryMismatches } from "../catalogue/inventory.mjs";
import { pushCatalogue } from "../catalogue/push.mjs";
import { compareToCatalogue, fetchStorefront, summarise } from "../catalogue/verify.mjs";
import { nextActions } from "./engine.mjs";
import { STEPS } from "./steps.mjs";
import { loadState, markDone, saveState } from "./state.mjs";
import { loadConfig } from "./config.mjs";
import { applyShipping } from "./shipping.mjs";
import { SCOPES, adminGraphQL, grantedScopes, missingScopes, servedVersion } from "../shopify/admin-client.mjs";
import { loadSdkDocuments, validateDocuments } from "../shopify/validate-storefront.mjs";
import { shopMismatches, versionStatus } from "../shopify/version.mjs";
import { bad, heading, info, ok, shopifyEnv, warn } from "../shopify/env.mjs";

const STATE_FILE = "store-setup.state.json";
const { command, args, flags } = parseArgs(process.argv.slice(2));

const state = loadState(STATE_FILE);

switch (command) {
  case "status": {
    for (const s of STEPS) {
      const mark = state.done[s.id] ? "done" : s.needs.every((n) => state.done[n]) ? "ready" : "wait ";
      console.log(`  [${mark}] ${s.owner.padEnd(7)} ${s.id.padEnd(17)} ${s.title}`);
    }
    break;
  }
  case "next": {
    const { agent, human } = nextActions(STEPS, state);
    heading("Agent can do now (start these first, in parallel with the human step):");
    if (!agent.length) info("nothing");
    for (const s of agent) info(`${s.id} (${s.owner}): ${s.instructions}`);
    heading("Ask the human for exactly this one thing:");
    if (!human.length) info("nothing, or everything is done");
    for (const s of human) info(`${s.id}: ${s.title}\n         ${s.instructions}`);
    break;
  }
  case "done": {
    const id = args[0];
    if (!STEPS.some((s) => s.id === id)) {
      bad(`unknown step: ${id}`);
      process.exit(1);
    }
    saveState(STATE_FILE, markDone(state, id, args.slice(1).join(" ") || undefined));
    ok(`${id} marked done`);
    break;
  }
  case "preflight": {
    const config = loadConfig();
    ok(`config valid (profile ${config.profile}, ${config.currency})`);
    if (flags["config-only"]) break;
    const granted = await grantedScopes();
    const required = [...new Set([...SCOPES.shipping, ...SCOPES.policies])];
    const missing = missingScopes(granted, required);
    if (missing.length) {
      bad(`missing scopes: ${missing.join(", ")}. Release a new app version, then reinstall.`);
      process.exit(1);
    }
    ok(`admin token has: ${required.join(", ")}`);
    const shop = (await adminGraphQL("{ shop { name currencyCode taxesIncluded } }")).shop;
    ok(`shop ${shop.name}: ${shop.currencyCode}, taxesIncluded ${shop.taxesIncluded}`);
    const version = versionStatus(shopifyEnv().apiVersion, servedVersion());
    (version.ok ? ok : warn)(version.note);
    const mismatches = shopMismatches(shop, config);
    mismatches.forEach((m) => bad(m));
    if (mismatches.length) process.exit(1);
    break;
  }
  case "shipping": {
    await applyShipping({ config: loadConfig(), dryRun: flags["dry-run"] === true, locationId: flags.location });
    break;
  }
  case "catalogue-build": {
    const result = await buildCatalogue({ config: loadConfig() });
    if (!result.ok) {
      result.problems.slice(0, 40).forEach((p) => bad(p));
      process.exit(1);
    }
    ok(`wrote data/catalog.json: ${result.catalog.collections.length} collections, ${result.catalog.products.length} products, ${result.catalog.products.reduce((n, p) => n + p.variants.length, 0)} variants`);
    break;
  }
  case "catalogue": {
    const { ok: found, catalog, problem } = readCatalogFile();
    if (!found) {
      bad(problem);
      process.exit(1);
    }
    await pushCatalogue({
      config: loadConfig(),
      catalog,
      dryRun: flags["dry-run"] === true,
      limit: flags.limit ? Number(flags.limit) : undefined,
      only: flags.only,
      skipImages: flags["skip-images"] === true,
      locationId: flags.location,
    });
    break;
  }
  case "catalogue-verify": {
    const { ok: found, catalog, problem } = readCatalogFile();
    if (!found) {
      bad(problem);
      process.exit(1);
    }
    const seen = await fetchStorefront();
    const summary = summarise(seen.products, seen.collections);
    info(`storefront serves ${summary.products} products, ${summary.variants} variants, ${summary.collections} collections, ${summary.withImage} with an image`);
    const version = versionStatus(shopifyEnv().apiVersion, seen.served);
    (version.ok ? ok : warn)(version.note);
    const problems = compareToCatalogue({ handles: seen.products.map((p) => p.handle), summary }, catalog);
    problems.forEach((p) => bad(p));
    if (problems.length) process.exit(1);
    ok("the storefront serves what was pushed");
    break;
  }
  case "inventory-check": {
    const config = loadConfig();
    const problems = inventoryMismatches(await fetchVariantTracking(), config.tracksInventory);
    problems.forEach((p) => bad(p));
    if (problems.length) process.exit(1);
    ok(`stock tracking matches the config (tracksInventory=${config.tracksInventory})`);
    if (!config.tracksInventory) warn("nothing is tracked: no product will ever show sold out. The owner must know this.");
    break;
  }
  case "validate-queries": {
    const version = typeof flags.version === "string" ? flags.version : shopifyEnv().apiVersion;
    const results = await validateDocuments({ version, documents: loadSdkDocuments() });
    for (const r of results) (r.ok ? ok : bad)(`${r.name}${r.ok ? "" : ": " + r.problems.join("; ")}`);
    const failed = results.filter((r) => !r.ok);
    info(`${results.length - failed.length} of ${results.length} documents valid against ${version}`);
    process.exit(failed.length ? 1 : 0);
  }
  case "e2e": {
    const run = spawnSync("pnpm", ["exec", "playwright", "test"], { stdio: "inherit" });
    if (run.status === 0) info("Skipped tests are not passes. Check the output above for skips before marking this step done.");
    process.exit(run.status ?? 1);
  }
  default:
    console.log("usage: pnpm shop-setup status | next | done <id> [note] | preflight [--config-only] | shipping [--dry-run] [--location=<id>] | catalogue-build | catalogue [--dry-run] [--limit=N] [--only=collections|products] [--skip-images] [--location=<id>] | catalogue-verify | inventory-check | validate-queries [--version=YYYY-MM] | e2e");
    process.exit(command ? 1 : 0);
}
