import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "./args.mjs";
import { nextActions } from "./engine.mjs";
import { STEPS } from "./steps.mjs";
import { loadState, markDone, saveState } from "./state.mjs";
import { validateConfig } from "./intake.mjs";
import { applyShipping } from "./shipping.mjs";
import { SCOPES, adminGraphQL, grantedScopes, missingScopes, servedVersion } from "../shopify/admin-client.mjs";
import { shopMismatches, versionStatus } from "../shopify/version.mjs";
import { bad, heading, info, ok, shopifyEnv, warn } from "../shopify/env.mjs";

const STATE_FILE = "store-setup.state.json";
const CONFIG_FILE = "store-setup.config.json";
const { command, args, flags } = parseArgs(process.argv.slice(2));

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    bad(`${CONFIG_FILE} not found. The intake step has not been done.`);
    process.exit(1);
  }
  const result = validateConfig(JSON.parse(readFileSync(CONFIG_FILE, "utf8")));
  if (!result.ok) {
    bad(`${CONFIG_FILE} is invalid:`);
    result.errors.forEach((e) => info(e));
    process.exit(1);
  }
  if (result.assumed.length) warn(`assumed from the ${result.config.profile} profile: ${result.assumed.join(", ")}. Tell the human.`);
  return result.config;
}

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
  case "e2e": {
    const run = spawnSync("pnpm", ["exec", "playwright", "test"], { stdio: "inherit" });
    if (run.status === 0) info("Skipped tests are not passes. Check the output above for skips before marking this step done.");
    process.exit(run.status ?? 1);
  }
  default:
    console.log("usage: pnpm shop-setup status | next | done <id> [note] | preflight [--config-only] | shipping [--dry-run] [--location=<id>] | e2e");
    process.exit(command ? 1 : 0);
}
