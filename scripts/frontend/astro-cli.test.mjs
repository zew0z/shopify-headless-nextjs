import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { makeFixture } from "../test-support/fixture.mjs";
import { planKitInstall } from "./kit.mjs";
import { applyKitInstall } from "./install.mjs";

const kitRoot = process.cwd();
function installedAstro() {
  const target = makeFixture({
    "package.json": { type: "module", dependencies: { astro: "7.3.2", "@astrojs/node": "11.1.5" }, devDependencies: { typescript: "6.0.3" } },
    "astro.config.mjs": 'export default { output: "server", adapter: node({ mode: "standalone" }) };',
    "src/pages/index.astro": "<h1>Fixture</h1>",
  });
  applyKitInstall(planKitInstall({ kitRoot, target }), target, { audit: "fixture", install: "test" });
  // Use the kit's installed tooling dependencies; the receiver has only its Astro SDK.
  symlinkSync(path.join(kitRoot, "node_modules"), path.join(target, "node_modules"), "dir");
  assert.equal(existsSync(path.join(target, "src/lib/shopify/analytics-config.ts")), false);
  assert.equal(existsSync(path.join(target, "src/lib/shopify/analytics-policy.ts")), false);
  return target;
}
const run = (cwd, ...args) => spawnSync(process.execPath, ["scripts/shopify-kit/setup/cli.mjs", ...args], { cwd, encoding: "utf8", timeout: 15000 });

test("installed Astro CLI starts and reaches frontend checks without Next analytics modules", () => {
  const target = installedAstro();
  for (const command of ["--help", "status", "next"]) {
    const result = run(target, command);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.length > 0);
  }
  const result = run(target, "frontend-check", ".");
  assert.match(result.stdout, /Astro has a supported SSR configuration/);
  assert.match(result.stdout, /The Astro Shopify adapter is installed and connected/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|analytics-config\.ts|analytics-policy\.ts/);
  assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
});

test("installed Astro analytics commands fail clearly without importing Next modules or writing state", () => {
  const target = installedAstro();
  const state = readFileSync(path.join(target, "store-setup.state.json"), "utf8");
  for (const args of [["analytics-configure", "--enable"], ["analytics-check", "--site=https://unreachable.invalid"]]) {
    const result = run(target, ...args);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /not installed for Astro/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|analytics-config\.ts|analytics-policy\.ts/);
  }
  assert.equal(existsSync(path.join(target, ".env.local")), false);
  assert.equal(readFileSync(path.join(target, "store-setup.state.json"), "utf8"), state);
});
