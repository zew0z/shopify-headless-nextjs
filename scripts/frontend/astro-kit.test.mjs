import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { makeFixture } from "../test-support/fixture.mjs";
import { detectStack } from "./stack.mjs";
import { planKitInstall, hasConflicts } from "./kit.mjs";
import { applyKitInstall } from "./install.mjs";
import { checkWiring } from "./check.mjs";
import { listSourceFiles } from "./walk.mjs";

const fixture = (more = {}) => makeFixture({
  "package.json": { name: "astro-fixture", type: "module", dependencies: { astro: "7.3.2", "@astrojs/node": "11.1.5" }, devDependencies: { typescript: "6.0.3" }, scripts: { check: "astro check", build: "astro build" } },
  "package-lock.json": { lockfileVersion: 3 },
  "astro.config.ts": 'export default { output: "server", adapter: node({ mode: "middleware" }), security: { checkOrigin: true } };',
  "src/pages/index.astro": "---\nconst shop = { name: null };\n---\n<h1>{shop.name}</h1>",
  ...more,
});

test("Astro support requires verified version, server output and an SSR adapter", () => {
  assert.equal(detectStack(fixture()).supported, true);
  for (const more of [{ "astro.config.ts": "export default {}" }, { "astro.config.ts": 'export default {output:"static",adapter:node()}' }, { "package.json": { dependencies: { astro: "6.0.0", "@astrojs/node": "11" } } }]) assert.equal(detectStack(fixture(more)).supported, false);
});

test("Astro plan installs actual adapter without Next, React, Hydrogen, deployment or protected skills", () => {
  const plan = planKitInstall({ kitRoot: process.cwd(), target: fixture(), appRoot: "src/" });
  assert.equal(hasConflicts(plan), false);
  assert.equal(plan.framework, "astro");
  const paths = plan.write.map((w) => w.to);
  assert(paths.includes("src/lib/shopify/astro/provider.ts"));
  assert(paths.includes("src/pages/api/cart.ts"));
  assert(paths.includes("docs/frontend-wiring-astro.md"));
  assert(!paths.some((p) => /src\/app|\.tsx$|\.claude\/|\.github\/|Dockerfile/.test(p)));
  assert.deepEqual(plan.packageJson.add.dependencies, {});
  assert.deepEqual(plan.packageJson.add.devDependencies, {});
  assert.equal(plan.agentsNote, false);
});

test("Astro npm package and lock dependencies stay untouched, and installation is idempotent", () => {
  const target = fixture();
  const before = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
  const lock = readFileSync(path.join(target, "package-lock.json"), "utf8");
  const plan = planKitInstall({ kitRoot: process.cwd(), target, appRoot: "src/" });
  applyKitInstall(plan, target, { audit: "generic fixture", install: "local" });
  const after = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
  assert.deepEqual(after.dependencies, before.dependencies);
  assert.deepEqual(after.devDependencies, before.devDependencies);
  assert.equal(readFileSync(path.join(target, "package-lock.json"), "utf8"), lock);
  assert.equal(existsSync(path.join(target, "AGENTS.md")), false);
  const next = planKitInstall({ kitRoot: process.cwd(), target, appRoot: "src/" });
  assert.equal(hasConflicts(next), false);
  assert.equal(applyKitInstall(next, target, {}).changed, 0);
});

test("existing Astro files block writes and template cart routes are preserved", () => {
  const target = fixture({ "src/lib/shopify/index.ts": "existing code", "src/modules/commerce/lib/types.ts": "existing contract" });
  const plan = planKitInstall({ kitRoot: process.cwd(), target });
  assert.equal(hasConflicts(plan), true);
  assert(!plan.write.some((w) => w.to === "src/pages/api/cart.ts"));
  assert.throws(() => applyKitInstall(plan, target, {}), /conflicts/);
  assert.equal(existsSync(path.join(target, "src/lib/shopify/astro/provider.ts")), false);
});

test("Astro source audit finds .astro code and never treats installation alone as completed wiring", () => {
  const target = fixture();
  const plan = planKitInstall({ kitRoot: process.cwd(), target });
  applyKitInstall(plan, target, { audit: "fixture", install: "fixture" });
  assert(listSourceFiles(target).includes("src/pages/index.astro"));
  assert(checkWiring(target).some((r) => /adapter is installed/.test(r.what) && r.ok));
  const unconnected = fixture({ "src/lib/shopify/astro/index.ts": "installed" });
  assert(checkWiring(unconnected).some((r) => /adapter is installed/.test(r.what) && !r.ok));
});

test("Astro checks reject server imports in browser scripts and shared cart caches", () => {
  const target = fixture({ "src/pages/cart.astro": '---\nAstro.cache.set({ maxAge: 300 });\n---\n<script>import { createAstroCommerce } from "@/lib/shopify/astro";</script>' });
  const checks = checkWiring(target);
  assert(checks.some((r) => /browser scripts/.test(r.what) && !r.ok));
  assert(checks.some((r) => /Cart and checkout responses/.test(r.what) && !r.ok));
});
