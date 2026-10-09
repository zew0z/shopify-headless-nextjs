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

test("an npm repo gets the scripts but no dependencies, so package.json and package-lock.json stay in sync", () => {
  const target = received({ "package-lock.json": '{ "lockfileVersion": 3 }\n' });
  const plan = planKitInstall({ kitRoot, target, appRoot: "" });
  applyKitInstall(plan, target, notes);
  const pkg = JSON.parse(read(target, "package.json"));
  assert.deepEqual(Object.keys(pkg.scripts), ["dev", "build", "shop-setup", "test:scripts", "test:e2e"]);
  assert.deepEqual(pkg.dependencies, { next: "16.2.0" });
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(read(target, "package-lock.json"), '{ "lockfileVersion": 3 }\n');
  assert.equal(existsSync(path.join(target, "pnpm-workspace.yaml")), false);
  assert.match(plan.packageJson.installCommand, /^npm install --save-dev /);
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

test("installing writes the error pages and a CLAUDE.md pointing at AGENTS.md, and a second install adds nothing", () => {
  const target = received();
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  assert.match(read(target, "app/global-error.tsx"), /<html/);
  assert.match(read(target, "app/error.tsx"), /Something went wrong/);
  assert.equal(read(target, "CLAUDE.md"), "@AGENTS.md\n");
  assert.match(read(target, "AGENTS.md"), /# Store setup/);
  assert.match(read(target, ".gitignore"), /^frontend-audit\.json$/m);
  const second = planKitInstall({ kitRoot, target, appRoot: "" });
  assert.deepEqual(second.extras, []);
  assert.equal(applyKitInstall(second, target, notes).changed, 0);
});

test("an existing CLAUDE.md keeps its words and gets the store setup block when there is no AGENTS.md", () => {
  const target = received({ "CLAUDE.md": "# Mine\n" });
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  assert.match(read(target, "CLAUDE.md"), /^# Mine\n\n# Store setup/);
  assert.equal(existsSync(path.join(target, "AGENTS.md")), false);
});

test("an existing error page is never overwritten", () => {
  const target = received({ "app/error.tsx": "mine", "app/global-error.tsx": "mine too" });
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, notes);
  assert.equal(read(target, "app/error.tsx"), "mine");
  assert.equal(read(target, "app/global-error.tsx"), "mine too");
});

test("both installed layouts include the pinned runtime dependency and are idempotent",()=>{
  for(const appRoot of ["","src/"]){
    const target=received(appRoot?{"src/app/page.tsx":""}:{});applyKitInstall(planKitInstall({kitRoot,target,appRoot}),target,notes);
    assert.equal(JSON.parse(read(target,"package.json")).dependencies["@shopify/hydrogen"],"2026.10.0-preview.4");
    assert.ok(existsSync(path.join(target,`${appRoot}app/api/shopify/analytics/config/route.ts`)));assert.ok(existsSync(path.join(target,`${appRoot}lib/shopify/analytics-browser.ts`)));
    assert.equal(applyKitInstall(planKitInstall({kitRoot,target,appRoot}),target,notes).changed,0);
  }
});
