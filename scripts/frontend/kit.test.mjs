import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasConflicts, kitFiles, planKitInstall } from "./kit.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

const kitRoot = process.cwd();
const received = (extra = {}) =>
  makeFixture({
    "package.json": { name: "received", scripts: { dev: "next dev", build: "next build" }, dependencies: { next: "16.2.0" } },
    "app/page.tsx": "",
    ".gitignore": "node_modules\n.env*\n",
    ...extra,
  });

test("a root-layout repo gets the SDK in lib/shopify and routes that need no @/ alias", () => {
  const plan = planKitInstall({ kitRoot, target: received(), appRoot: "" });
  const to = plan.write.map((w) => w.to);
  assert.ok(to.includes("lib/shopify/index.ts"));
  assert.ok(to.includes("lib/shopify/client.ts"));
  assert.ok(to.includes("lib/shopify/cart-store.ts"));
  assert.ok(to.includes("lib/shopify/cart-provider.tsx"));
  for (const r of ["cart", "revalidate", "health", "search"]) {
    const route = plan.write.find((w) => w.to === `app/api/${r}/route.ts`);
    assert.ok(route, `${r} route missing`);
    assert.doesNotMatch(route.text, /@\//, `${r} route still uses @/`);
    assert.match(route.text, /"\.\.\/\.\.\/\.\.\/lib\/shopify/);
  }
});

test("the Storefront API proxy route is installed with its import pointing four levels up", () => {
  for (const appRoot of ["", "src/"]) {
    const plan = planKitInstall({ kitRoot, target: received(appRoot ? { "src/app/page.tsx": "" } : {}), appRoot });
    const route = plan.write.find((w) => w.to === `${appRoot}app/api/[version]/graphql.json/route.ts`);
    assert.ok(route, "proxy route missing");
    assert.match(route.text, /"\.\.\/\.\.\/\.\.\/\.\.\/lib\/shopify\/storefront-proxy"/);
  }
});

test("a src/ repo gets everything under src/", () => {
  const plan = planKitInstall({ kitRoot, target: received({ "src/app/page.tsx": "" }), appRoot: "src/" });
  const to = plan.write.map((w) => w.to);
  assert.ok(to.includes("src/lib/shopify/index.ts"));
  assert.ok(to.includes("src/app/api/cart/route.ts"));
  assert.ok(!to.includes("lib/shopify/index.ts"));
});

test("the setup scripts, tests, skill and docs come along; the kit's pages, plans and README do not", () => {
  const to = kitFiles(kitRoot, "").map((f) => f.to);
  for (const want of ["scripts/setup/cli.mjs", "scripts/frontend/audit.mjs", "scripts/test-support/ts-hooks.mjs", "e2e/pages.spec.mjs", "playwright.config.mjs", "store-setup.config.example.json", ".claude/skills/shopify-store-setup/SKILL.md", ".claude/skills/shopify-connect-frontend/SKILL.md", "docs/catalogue-import.md", "docs/shopify-api-gotchas.md", "docs/frontend-wiring.md"]) {
    assert.ok(to.includes(want), `${want} missing`);
  }
  assert.ok(!to.some((t) => /^docs\/superpowers|components\/|context\/|app\/page|README|globals\.css/.test(t)), "kit-only file in the kit");
});

test("the kit ships no hardcoded products: every product comes from Shopify", () => {
  const to = kitFiles(kitRoot, "").map((f) => f.to);
  assert.ok(!to.some((t) => /mock/i.test(t)), `kit ships made-up data: ${to.filter((t) => /mock/i.test(t))}`);
});

test("an identical file is left alone; a different one is a conflict and the plan says so", () => {
  const route = kitFiles(kitRoot, "").find((f) => f.to === "app/api/health/route.ts");
  const healthText = route.transform(readFileSync(path.join(kitRoot, route.from), "utf8"));
  const plan = planKitInstall({
    kitRoot,
    target: received({ "app/api/health/route.ts": healthText, "app/api/cart/route.ts": "export async function POST() {}" }),
    appRoot: "",
  });
  assert.ok(plan.same.includes("app/api/health/route.ts"));
  assert.deepEqual(plan.conflicts, [{ to: "app/api/cart/route.ts", why: "already exists with different content" }]);
  assert.equal(hasConflicts(plan), true);
});

test("package.json gets the missing scripts and dev tools; a different script with the same name is a conflict", () => {
  const plan = planKitInstall({
    kitRoot,
    target: received({ "package.json": { scripts: { "test:e2e": "cypress run" }, dependencies: { next: "16" }, devDependencies: { typescript: "^5" } } }),
    appRoot: "",
  });
  assert.deepEqual(Object.keys(plan.packageJson.add.scripts).sort(), ["shop-setup", "test:scripts"]);
  assert.deepEqual(Object.keys(plan.packageJson.add.devDependencies), ["@playwright/test"]);
  assert.deepEqual(plan.packageJson.conflicts, [{ key: "scripts.test:e2e", have: "cypress run", want: "playwright test" }]);
  assert.equal(hasConflicts(plan), true);
});

test(".gitignore only gains the lines it lacks", () => {
  const plan = planKitInstall({ kitRoot, target: received(), appRoot: "" });
  assert.deepEqual(plan.gitignore, ["!.env.example", "/data/catalog.json", "/test-results/", "/playwright-report/", "frontend-audit.json"]);
});

test(".gitignore keeps a committed .env.example visible: the un-ignore line follows .env*", () => {
  const plan = planKitInstall({ kitRoot, target: received({ ".gitignore": "node_modules\n" }), appRoot: "" });
  const at = plan.gitignore.indexOf(".env*");
  assert.ok(at >= 0, ".env* is added");
  assert.equal(plan.gitignore[at + 1], "!.env.example");
});

test(".gitignore does not add !.env.example when the repo already has it", () => {
  const plan = planKitInstall({ kitRoot, target: received({ ".gitignore": "node_modules\n.env*\n!.env.example\n" }), appRoot: "" });
  assert.ok(!plan.gitignore.includes("!.env.example"));
});

test("the agent instructions are added only when neither AGENTS.md nor CLAUDE.md has them", () => {
  assert.equal(planKitInstall({ kitRoot, target: received(), appRoot: "" }).agentsNote, true);
  assert.equal(planKitInstall({ kitRoot, target: received({ "CLAUDE.md": "# Store setup\nalready here" }), appRoot: "" }).agentsNote, false);
});

test("a clean repo has no conflicts", () => {
  assert.equal(hasConflicts(planKitInstall({ kitRoot, target: received(), appRoot: "" })), false);
});

test("the plan adds error pages and a CLAUDE.md pointer only where missing", () => {
  const target = received({ "app/error.tsx": "mine" });
  const plan = planKitInstall({ kitRoot, target, appRoot: "" });
  const extras = plan.extras.map((e) => e.to).sort();
  assert.deepEqual(extras, ["CLAUDE.md", "app/global-error.tsx"]);
  assert.match(plan.extras.find((e) => e.to === "CLAUDE.md").text, /@AGENTS\.md/);
  assert.match(plan.extras.find((e) => e.to === "app/global-error.tsx").text, /<html/);
  assert.ok(plan.gitignore.includes("frontend-audit.json"));
  assert.deepEqual(plan.conflicts, [], "their own error page is not a conflict");
  assert.equal(plan.keptErrorPage, true);
});

test("the error pages go under the app root, and an existing CLAUDE.md is left alone", () => {
  const plan = planKitInstall({ kitRoot, target: received({ "src/app/page.tsx": "", "CLAUDE.md": "# Mine\n" }), appRoot: "src/" });
  assert.deepEqual(plan.extras.map((e) => e.to).sort(), ["src/app/error.tsx", "src/app/global-error.tsx"]);
  assert.equal(plan.keptErrorPage, false);
});

test("both app layouts receive the full analytics runtime and exact production dependency; incompatible versions conflict",()=>{
  for(const appRoot of ["","src/"]){
    const plan=planKitInstall({kitRoot,target:received(),appRoot});
    for(const file of ["analytics-browser.ts","analytics-tracker.ts","analytics-config.ts","analytics-consent-proxy.ts","analytics-policy.ts","analytics-script-loader.ts","analytics.tsx"])assert.ok(plan.write.some(w=>w.to===`${appRoot}lib/shopify/${file}`));
    const route=plan.write.find(w=>w.to===`${appRoot}app/api/shopify/analytics/config/route.ts`);assert.ok(route);assert.match(route.text,/"\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/shopify/);
    assert.equal(plan.packageJson.add.dependencies["@shopify/hydrogen"],"2026.10.0-preview.4");assert.ok(plan.write.some(w=>w.to==="docs/shopify-analytics.md"));
  }
  const plan=planKitInstall({kitRoot,target:received({"package.json":{dependencies:{next:"16","@shopify/hydrogen":"latest"}}}),appRoot:""});assert.ok(plan.packageJson.conflicts.some(c=>c.key==="dependencies.@shopify/hydrogen"));
});
