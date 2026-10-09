import { spawnSync } from "node:child_process";
import { analyticsConfiguration, checkAnalytics } from "../shopify/analytics-setup.mjs";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "./args.mjs";
import { buildCatalogue, readCatalogFile } from "../catalogue/build.mjs";
import { fetchVariantTracking, inventoryMismatches } from "../catalogue/inventory.mjs";
import { pushCatalogue } from "../catalogue/push.mjs";
import { pushDefinitions, wantedDefinitions } from "../catalogue/definitions.mjs";
import { compareToCatalogue, fetchStorefront, summarise } from "../catalogue/verify.mjs";
import { nextActions } from "./engine.mjs";
import { auditFrontend, summariseAudit } from "../frontend/audit.mjs";
import { hasConflicts, planKitInstall } from "../frontend/kit.mjs";
import { applyKitInstall } from "../frontend/install.mjs";
import { checkWiring, smokeSite } from "../frontend/check.mjs";
import { STEPS } from "./steps.mjs";
import { loadState, markDone, saveState } from "./state.mjs";
import { loadConfig } from "./config.mjs";
import { applyShipping } from "./shipping.mjs";
import { adminGraphQL, allScopes, grantedScopes, missingScopes, resolveAdminToken, servedVersion } from "../shopify/admin-client.mjs";
import { REDIRECT_PORT, redirectUri, runOAuth } from "../shopify/oauth.mjs";
import { listWebhooks, registerWebhooks, webhookSecretStatus } from "../shopify/webhooks.mjs";
import { loadSdkDocuments, validateDocuments } from "../shopify/validate-storefront.mjs";
import { shopMismatches, versionStatus } from "../shopify/version.mjs";
import { bad, heading, info, mask, ok, shopifyEnv, readEnv, upsertEnv, warn } from "../shopify/env.mjs";

const USAGE = "usage: pnpm shop-setup status | next | done <id> [note] | preflight [--config-only] | shipping [--dry-run] [--location=<id>] | catalogue-build | catalogue [--dry-run] [--limit=N] [--only=collections|products] [--skip-images] [--rehost=host,...] [--location=<id>] | catalogue-verify | definitions [--dry-run] | inventory-check | token | oauth | webhooks [--list] [--dry-run] [--url=https://...] | validate-queries [--version=YYYY-MM] | e2e | analytics-configure [--enable|--disable] [--shop-id=ID --origins=https://... --country=XX --language=XX --currency=XXX] [--dry-run] | analytics-check [--site=https://...] | frontend-audit <dir> | kit-install <dir> [--dry-run] | frontend-check [dir] [--site <url>]";
const HELP_WORDS = ["--help", "-h", "help"];
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
    const required = allScopes();
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
      rehost: typeof flags.rehost === "string" ? flags.rehost.split(",").map((h) => h.trim()).filter(Boolean) : [],
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
  case "definitions": {
    const config = loadConfig();
    const file = readCatalogFile();
    const catalog = file.ok ? file.catalog : { products: [], definitions: { metaobjects: [], metafields: [] } };
    if (!file.ok) info("no data/catalog.json yet: only the kit's own types");
    const wanted = wantedDefinitions(catalog, { wantsReviews: config.wantsReviews });
    wanted.problems.forEach((p) => bad(p));
    if (wanted.problems.length) process.exit(1);
    heading(`Definitions  ${wanted.metaobjects.length} content types, ${wanted.metafields.length} product fields`);
    if (flags["dry-run"]) {
      wanted.metaobjects.forEach((d) => info(`type  ${d.type}: ${d.fieldDefinitions.map((f) => f.key).join(", ")}`));
      wanted.metafields.forEach((d) => info(`field ${d.namespace}.${d.key} (${d.type})`));
      ok("dry run, nothing was written");
      break;
    }
    await pushDefinitions(wanted);
    ok("definitions in place; the storefront can read every one");
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
  case "token": {
    const env = shopifyEnv();
    if (!env.domain) {
      bad("SHOPIFY_STORE_DOMAIN is missing from .env.local");
      process.exit(1);
    }
    let resolved;
    try {
      resolved = await resolveAdminToken();
    } catch (error) {
      bad(String(error.message ?? error));
      process.exit(1);
    }
    const granted = await grantedScopes();
    ok(`Admin token works: ${mask(resolved.token)} from ${resolved.source}`);
    info(`scopes: ${granted.join(", ")}`);
    if (resolved.source === "client credentials") info("minted for this run only (valid 24 hours), never written to disk");
    break;
  }
  case "oauth": {
    const env = shopifyEnv();
    if (!env.domain || !env.clientId || !env.clientSecret) {
      bad("needs SHOPIFY_STORE_DOMAIN, SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET in .env.local");
      process.exit(1);
    }
    try {
      const result = await runOAuth({
        domain: env.domain,
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        scopes: allScopes(),
        save: upsertEnv,
        onReady: ({ authorizeUrl }) => {
          info(`Listening on ${redirectUri(REDIRECT_PORT)}. Confirm that exact URL is an allowed redirection URL on the app.`);
          info("Give the person this URL to open while logged into the store, then they click Install:");
          console.log(`\n${authorizeUrl}\n`);
        },
      });
      ok(`token saved to .env.local: ${mask(result.token)}`);
      info(`granted: ${result.scope}`);
      if (result.expiresIn) warn(`this token expires in ${result.expiresIn} seconds: it will stop working. Re-run when it does.`);
    } catch (error) {
      bad(String(error.message ?? error));
      process.exit(1);
    }
    break;
  }
  case "webhooks": {
    const env = shopifyEnv();
    if (flags.list) {
      const nodes = await listWebhooks();
      info(`${nodes.length} registered`);
      nodes.forEach((n) => info(`${n.topic.padEnd(24)} ${n.endpoint?.callbackUrl ?? "(not http)"}`));
      break;
    }
    const siteUrl = typeof flags.url === "string" ? flags.url : env.siteUrl;
    try {
      const plan = await registerWebhooks({ siteUrl, dryRun: flags["dry-run"] === true });
      info(`target ${plan.callbackUrl}`);
      plan.remove.forEach((r) => warn(`remove stale ${r.topic} -> ${r.url}`));
      plan.keep.forEach((t) => info(`= ${t} already registered`));
      plan.create.forEach((t) => ok(`${flags["dry-run"] === true ? "would add" : "added"} ${t}`));
    } catch (error) {
      bad(String(error.message ?? error));
      process.exit(1);
    }
    const secret = webhookSecretStatus({ clientSecret: env.clientSecret, webhookSecret: env.webhookSecret });
    (secret.ok ? ok : bad)(secret.note);
    if (!secret.ok) process.exit(1);
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
  case "analytics-configure": {
    const { changes, issues } = analyticsConfiguration(flags, readEnv());
    if (issues.length) { issues.forEach(bad); process.exit(1); }
    for (const [key, value] of Object.entries(changes)) {
      info(`${key}=${value}`);
      if (!flags["dry-run"]) upsertEnv(key, value);
    }
    info(flags["dry-run"] ? "Dry run: nothing written." : "Public analytics settings written. Restart the server; update the host settings separately.");
    break;
  }
  case "analytics-check": {
    const checks = await checkAnalytics({ env: readEnv(), site: typeof flags.site === "string" ? flags.site : undefined });
    for (const check of checks) { (check.ok ? ok : bad)(check.what); if (!check.ok) check.details.forEach(info); }
    process.exit(checks.every(c => c.ok) ? 0 : 1);
  }
  case "frontend-audit": {
    const dir = path.resolve(args[0] ?? ".");
    const audit = auditFrontend(dir);
    const [verdict, ...rest] = summariseAudit(audit);
    (audit.stack.supported ? ok : bad)(verdict);
    for (const line of rest) info(line);
    writeFileSync(path.join(dir, "frontend-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
    info(`Full findings: ${path.join(dir, "frontend-audit.json")}`);
    process.exit(audit.stack.supported ? 0 : 1);
  }
  case "kit-install": {
    if (!args[0]) {
      bad("usage: pnpm shop-setup kit-install <path to the received frontend's repo> [--dry-run]");
      process.exit(1);
    }
    const target = path.resolve(args[0]);
    const audit = auditFrontend(target);
    if (!audit.stack.supported) {
      bad(`Stop: ${audit.stack.reason}`);
      process.exit(1);
    }
    const plan = planKitInstall({ kitRoot: process.cwd(), target, appRoot: audit.stack.appRoot });
    const { scripts, dependencies, devDependencies } = plan.packageJson.add;
    heading(`Kit into ${target}`);
    info(`${plan.write.length} files to add, ${plan.same.length} already there`);
    if (Object.keys(scripts).length) info(`package.json scripts to add: ${Object.keys(scripts).join(", ")}`);
    if (Object.keys(dependencies).length) info(`runtime dependencies to add: ${Object.keys(dependencies).join(", ")}`);
    if (Object.keys(devDependencies).length) info(`dev tools to add: ${Object.keys(devDependencies).join(", ")}`);
    if (plan.gitignore.length) info(`.gitignore lines to add: ${plan.gitignore.join(" ")}`);
    if (plan.agentsNote) info("agent instructions to add: the # Store setup block");
    for (const e of plan.extras) info(`added: ${e.to} (a starting point, edit to taste)`);
    if (plan.keptErrorPage) info("kept their error page");
    if (hasConflicts(plan)) {
      for (const c of plan.conflicts) bad(`${c.to}: ${c.why}`);
      for (const c of plan.packageJson.conflicts) bad(`package.json ${c.key} is "${c.have}", the kit needs "${c.want}"`);
      info("Nothing was written. Resolve each conflict (usually the frontend's own route or script), then run kit-install again.");
      process.exit(1);
    }
    if (flags["dry-run"]) {
      for (const w of plan.write) info(`+ ${w.to}`);
      info("Dry run: nothing was written.");
      break;
    }
    const kitVersion = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim() || "unknown";
    const { changed } = applyKitInstall(plan, target, { audit: audit.stack.reason, install: `kit ${kitVersion}` });
    ok(changed ? `kit ${kitVersion} installed (${changed} changes)` : "kit already installed, nothing changed");
    info(`Next, in ${target}: pnpm install, then pnpm shop-setup next.`);
    info("store-setup.state.json is the setup's progress record: commit it. frontend-audit.json is a scratch file and is ignored by git.");
    break;
  }
  case "frontend-check": {
    // `--site http://...` (a space, not =) leaves the url as a positional argument: take it as the site, not the folder.
    const spaced = process.argv.indexOf("--site");
    const site = typeof flags.site === "string" ? flags.site : flags.site && spaced >= 0 ? process.argv[spaced + 1] : undefined;
    if (flags.site && !site) {
      bad("--site needs the address of the running site, for example --site http://localhost:3000");
      process.exit(1);
    }
    const folder = args.find((a) => a !== site);
    const results = checkWiring(path.resolve(folder ?? "."));
    if (site) results.push(...(await smokeSite(site)));
    for (const r of results) {
      (r.ok ? ok : bad)(r.what);
      for (const w of r.where) info(w);
    }
    const failed = results.filter((r) => !r.ok).length;
    if (failed) info(`${failed} of ${results.length} checks failed.`);
    else info("Wiring looks right. Still needed before marking frontend-check done: pnpm build passes, and the pages show the development store's products.");
    process.exit(failed ? 1 : 0);
  }
  default:
    console.log(USAGE);
    process.exit(command && !HELP_WORDS.includes(command) ? 1 : 0);
}
