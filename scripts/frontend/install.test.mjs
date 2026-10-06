import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { planKitInstall } from "./kit.mjs";
import { applyKitInstall } from "./install.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

const kitRoot = process.cwd();
const PKG = `{
    "name": "received",
    "scripts": {
        "dev": "next dev",
        "build": "next build"
    },
    "dependencies": {
        "next": "16.2.0"
    }
}
`;
const received = (extra = {}) => makeFixture({ "package.json": PKG, "app/page.tsx": "", ".gitignore": "node_modules\n", ...extra });
const notes = { audit: "Next.js 16, App Router", install: "kit installed" };
const read = (dir, f) => readFileSync(path.join(dir, f), "utf8");

test("installing writes the SDK, the routes and the tooling", () => {
  const target = received();
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  for (const f of ["lib/shopify/index.ts", "app/api/cart/route.ts", "scripts/setup/cli.mjs", "e2e/pages.spec.mjs"]) {
    assert.ok(existsSync(path.join(target, f)), `${f} not written`);
  }
});

test("package.json keeps its scripts, its order and its 4-space indent", () => {
  const target = received();
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  const text = read(target, "package.json");
  const pkg = JSON.parse(text);
  assert.deepEqual(Object.keys(pkg.scripts), ["dev", "build", "shop-setup", "test:scripts", "test:e2e"]);
  assert.ok(pkg.devDependencies["@playwright/test"]);
  assert.ok(pkg.devDependencies.typescript);
  assert.match(text, /^ {4}"name"/m);
  assert.ok(text.endsWith("}\n"));
});

test(".gitignore and AGENTS.md gain the kit's lines", () => {
  const target = received();
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  assert.match(read(target, ".gitignore"), /^node_modules\n[\s\S]*^\.env\*$[\s\S]*^\/playwright-report\/$/m);
  assert.match(read(target, "AGENTS.md"), /# Store setup/);
});

test("an existing AGENTS.md is appended to, not replaced", () => {
  const target = received({ "AGENTS.md": "# House rules\nUse pnpm.\n" });
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  assert.match(read(target, "AGENTS.md"), /^# House rules\nUse pnpm\.\n\n# Store setup/);
});

test("the setup state starts with the audit and the install done, and an existing state is left alone", () => {
  const target = received();
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  const state = JSON.parse(read(target, "store-setup.state.json"));
  assert.deepEqual(Object.keys(state.done), ["frontend-audit", "kit-install"]);
  assert.equal(state.done["frontend-audit"].note, notes.audit);

  const kept = received({ "store-setup.state.json": { done: { intake: { at: "x" } } } });
  applyKitInstall(planKitInstall({ kitRoot, target: kept, appRoot: "" }), kept, notes);
  assert.deepEqual(Object.keys(JSON.parse(read(kept, "store-setup.state.json")).done), ["intake"]);
});

test("installing twice changes nothing the second time", () => {
  const target = received();
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  const pkgBefore = read(target, "package.json");
  const result = applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  assert.equal(result.changed, 0);
  assert.equal(read(target, "package.json"), pkgBefore);
});

test("a plan with conflicts writes nothing at all", () => {
  const target = received({ "app/api/cart/route.ts": "export async function POST() {}" });
  const plan = planKitInstall({ kitRoot, target, appRoot: "" });
  assert.throws(() => applyKitInstall(plan, target, notes), /conflict/);
  assert.equal(existsSync(path.join(target, "lib/shopify/index.ts")), false);
  assert.equal(read(target, "package.json"), PKG);
});
