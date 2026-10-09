import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hasConflicts, kitFiles, planKitInstall, sdkImport } from "./kit.mjs";
import { infoPage, policyPage } from "./templates.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

const kitRoot = process.cwd();
// The NOTIXV deploy files are covered by their own tests below; these ignore them.
const notDeploy = (e) => !["Dockerfile", ".dockerignore"].includes(e.to) && !e.to.startsWith(".github/");
// pnpm repos get the kit's pnpm-workspace.yaml; an npm repo the kit was installed into has none to give.
const WORKSPACE = existsSync(path.join(kitRoot, "pnpm-workspace.yaml")) ? ["pnpm-workspace.yaml"] : [];
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
  for (const r of ["cart", "revalidate", "health", "search", "contact"]) {
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
  const extras = plan.extras.filter(notDeploy).map((e) => e.to).sort();
  assert.deepEqual(extras, ["CLAUDE.md", "app/global-error.tsx", "app/pages/[handle]/page.tsx", "app/policies/[handle]/page.tsx", ...WORKSPACE]);
  assert.match(plan.extras.find((e) => e.to === "CLAUDE.md").text, /@AGENTS\.md/);
  assert.match(plan.extras.find((e) => e.to === "app/global-error.tsx").text, /<html/);
  assert.ok(plan.gitignore.includes("frontend-audit.json"));
  assert.deepEqual(plan.conflicts, [], "their own error page is not a conflict");
  assert.equal(plan.keptErrorPage, true);
});

test("the error pages go under the app root, and an existing CLAUDE.md is left alone", () => {
  const plan = planKitInstall({ kitRoot, target: received({ "src/app/page.tsx": "", "CLAUDE.md": "# Mine\n" }), appRoot: "src/" });
  assert.deepEqual(plan.extras.filter(notDeploy).map((e) => e.to).sort(), [
    ...WORKSPACE,
    "src/app/error.tsx",
    "src/app/global-error.tsx",
    "src/app/pages/[handle]/page.tsx",
    "src/app/policies/[handle]/page.tsx",
  ]);
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

test("kit-install adds the NOTIXV deploy files when the repo has none, for its package manager", () => {
  const target = makeFixture({ "package.json": { name: "shop" }, "pnpm-lock.yaml": "", "next.config.ts": "export default {};\n" });
  const plan = planKitInstall({ kitRoot: process.cwd(), target, appRoot: "" });
  const docker = plan.extras.find((e) => e.to === "Dockerfile");
  assert.match(docker.text, /pnpm install --frozen-lockfile/);
  assert.match(docker.text, /COPY --from=build \/app\/\.next\/standalone/);
  assert.match(docker.text, /USER 1000/);
  assert.match(docker.text, /^ARG NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN$/m);
  assert.match(docker.text, /^ARG NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN$/m);
  const workflow = plan.extras.find((e) => e.to === ".github/workflows/deploy-image.yaml");
  assert.match(workflow.text, /IMAGE: \$\{\{ github\.event\.repository\.name \}\}/);
  assert.match(workflow.text, /NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=\$\{\{ vars\.SHOPIFY_STORE_DOMAIN \}\}/);
  assert.match(workflow.text, /NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=\$\{\{ vars\.SHOPIFY_STOREFRONT_ACCESS_TOKEN \}\}/);
  assert.match(plan.extras.find((e) => e.to === ".dockerignore").text, /^node_modules$/m);
  assert.match(plan.deployNote, /output: "standalone"/);
});

test("the deploy workflow lets a SITE_URL repository variable override the landings address", () => {
  const target = makeFixture({ "package.json": { name: "shop" }, "pnpm-lock.yaml": "" });
  const workflow = planKitInstall({ kitRoot: process.cwd(), target, appRoot: "" }).extras.find((e) => e.to === ".github/workflows/deploy-image.yaml");
  assert.ok(workflow.text.includes("NEXT_PUBLIC_SITE_URL=${{ vars.SITE_URL || steps.tag.outputs.SITE_URL }}"));
});

test("the image build makes sure public/ exists before it builds", () => {
  for (const lock of ["pnpm-lock.yaml", "package-lock.json"]) {
    const target = makeFixture({ "package.json": { name: "shop" }, [lock]: lock === "package-lock.json" ? "{}" : "" });
    const text = planKitInstall({ kitRoot: process.cwd(), target, appRoot: "" }).extras.find((e) => e.to === "Dockerfile").text;
    assert.ok(text.includes("RUN mkdir -p public"), lock);
    assert.ok(text.indexOf("mkdir -p public") < text.indexOf("test:scripts"), lock);
  }
});

test("npm repos get npm ci; existing deploy files and a standalone config are left alone", () => {
  const npm = makeFixture({ "package.json": { name: "shop" }, "package-lock.json": "{}" });
  assert.match(planKitInstall({ kitRoot: process.cwd(), target: npm, appRoot: "" }).extras.find((e) => e.to === "Dockerfile").text, /npm ci/);
  const own = makeFixture({ "package.json": { name: "shop" }, Dockerfile: "FROM x\n", ".github/workflows/deploy-image.yaml": "x", "next.config.ts": 'export default { output: "standalone" };\n' });
  const plan = planKitInstall({ kitRoot: process.cwd(), target: own, appRoot: "" });
  assert.equal(plan.extras.some((e) => e.to === "Dockerfile" || e.to.startsWith(".github/")), false);
  assert.equal(plan.deployNote, null);
});

test("the image build runs lint only when the repo has a lint script", () => {
  const pnpm = makeFixture({ "package.json": { name: "shop" }, "pnpm-lock.yaml": "" });
  assert.match(planKitInstall({ kitRoot, target: pnpm, appRoot: "" }).extras.find((e) => e.to === "Dockerfile").text, /pnpm run --if-present lint/);
  const npm = makeFixture({ "package.json": { name: "shop" }, "package-lock.json": "{}" });
  assert.match(planKitInstall({ kitRoot, target: npm, appRoot: "" }).extras.find((e) => e.to === "Dockerfile").text, /npm run --if-present lint/);
});

// The kit's own text of one of its routes, as it ships with @/lib/shopify imports.
const kitRoute = (r) => readFileSync(path.join(kitRoot, kitFiles(kitRoot, "").find((f) => f.to === `app/api/${r}/route.ts`).from), "utf8");

test("routes keep @/lib/shopify in a repo with the @/* alias, so an identical route is not a conflict", () => {
  for (const [appRoot, aliasTarget] of [["", "./*"], ["src/", "./src/*"]]) {
    const target = received({
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": [aliasTarget] } } }),
      [`${appRoot}app/page.tsx`]: "",
      [`${appRoot}app/api/health/route.ts`]: kitRoute("health"),
    });
    const plan = planKitInstall({ kitRoot, target, appRoot });
    assert.ok(plan.same.includes(`${appRoot}app/api/health/route.ts`), appRoot);
    assert.deepEqual(plan.conflicts, [], appRoot);
    assert.ok(plan.write.find((w) => w.to === `${appRoot}app/api/cart/route.ts`).text.includes('from "@/lib/shopify"'), appRoot);
    assert.ok(plan.write.find((w) => w.to === `${appRoot}app/api/[version]/graphql.json/route.ts`).text.includes('"@/lib/shopify/storefront-proxy"'), appRoot);
  }
});

test("in an alias repo, a route an older kit installed with relative imports is the same route, not a conflict", () => {
  const relative = kitRoute("health").replaceAll('"@/lib/shopify', '"../../../lib/shopify');
  const target = received({ "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }), "app/api/health/route.ts": relative });
  const plan = planKitInstall({ kitRoot, target, appRoot: "" });
  assert.ok(plan.same.includes("app/api/health/route.ts"));
  assert.deepEqual(plan.conflicts, []);
  // Without the alias an @/ import would not resolve, so it stays a conflict there.
  const noAlias = received({ "app/api/health/route.ts": kitRoute("health") });
  assert.deepEqual(planKitInstall({ kitRoot, target: noAlias, appRoot: "" }).conflicts.map((c) => c.to), ["app/api/health/route.ts"]);
});

test("an @/* alias that points somewhere else, or a baseUrl, decides the import too", () => {
  const elsewhere = received({ "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }) });
  assert.equal(sdkImport(elsewhere, "", "app/api/cart/route.ts"), "../../../lib/shopify");
  const based = received({ "tsconfig.json": `{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["./*"] } } }` });
  assert.equal(sdkImport(based, "src/", "src/app/api/cart/route.ts"), "@/lib/shopify");
});

test("sdkImport is relative without the alias, the same paths kit-install always wrote", () => {
  const target = received({});
  assert.equal(sdkImport(target, "", "app/policies/[handle]/page.tsx"), "../../../lib/shopify");
  assert.equal(sdkImport(target, "src/", "src/app/policies/[handle]/page.tsx"), "../../../lib/shopify");
  assert.equal(sdkImport(target, "", "app/api/[version]/graphql.json/route.ts"), "../../../../lib/shopify");
  assert.equal(sdkImport(target, "", "app/api/shopify/analytics/config/route.ts"), "../../../../../lib/shopify");
});

test("a conflict inside lib/shopify marks an older SDK; a route conflict alone does not", () => {
  assert.equal(planKitInstall({ kitRoot, target: received({ "lib/shopify/index.ts": "export const old = 1;" }), appRoot: "" }).oldSdk, true);
  assert.equal(planKitInstall({ kitRoot, target: received({ "src/app/page.tsx": "", "src/lib/shopify/client.ts": "old" }), appRoot: "src/" }).oldSdk, true);
  assert.equal(planKitInstall({ kitRoot, target: received({ "app/api/cart/route.ts": "export async function POST() {}" }), appRoot: "" }).oldSdk, false);
});

test("npm repo: package.json dependencies are left alone; the npm commands that add them are printed instead", () => {
  const target = received({ "package-lock.json": "{}" });
  const plan = planKitInstall({ kitRoot, target, appRoot: "" });
  const kitPkg = JSON.parse(readFileSync(path.join(kitRoot, "package.json"), "utf8"));
  assert.equal(plan.packageManager, "npm");
  assert.deepEqual(plan.packageJson.add.devDependencies, {});
  assert.deepEqual(plan.packageJson.add.dependencies, {});
  assert.ok(Object.keys(plan.packageJson.add.scripts).length > 0, "scripts are still added");
  assert.match(plan.packageJson.installCommand, /^npm install --save-dev @playwright\/test@\S+ typescript@\S+ && npm install --save-exact @shopify\/hydrogen@\S+$/);
  assert.ok(plan.packageJson.installCommand.includes(`@shopify/hydrogen@${kitPkg.dependencies["@shopify/hydrogen"]}`));
  assert.ok(!plan.extras.some((e) => e.to === "pnpm-workspace.yaml"));
});

test("npm repo with every package already there: plain npm install", () => {
  const kitPkg = JSON.parse(readFileSync(path.join(kitRoot, "package.json"), "utf8"));
  const pkg = {
    name: "received",
    dependencies: { next: "16", "@shopify/hydrogen": kitPkg.dependencies["@shopify/hydrogen"] },
    devDependencies: { "@playwright/test": "^1", typescript: "^5" },
  };
  const plan = planKitInstall({ kitRoot, target: received({ "package.json": pkg, "package-lock.json": "{}" }), appRoot: "" });
  assert.equal(plan.packageJson.installCommand, "npm install");
});

test("pnpm repo: dependencies go into package.json; a repo without pnpm-workspace.yaml gets the kit's, one with it keeps its own", { skip: !WORKSPACE.length && "this repo has no pnpm-workspace.yaml" }, () => {
  const plan = planKitInstall({ kitRoot, target: received({ "pnpm-lock.yaml": "" }), appRoot: "" });
  assert.equal(plan.packageManager, "pnpm");
  assert.equal(plan.packageJson.installCommand, "pnpm install");
  assert.ok(plan.packageJson.add.devDependencies["@playwright/test"]);
  assert.equal(plan.extras.find((e) => e.to === "pnpm-workspace.yaml").text, readFileSync(path.join(kitRoot, "pnpm-workspace.yaml"), "utf8"));
  const own = planKitInstall({ kitRoot, target: received({ "pnpm-lock.yaml": "", "pnpm-workspace.yaml": "packages: []\n" }), appRoot: "" });
  assert.ok(!own.extras.some((e) => e.to === "pnpm-workspace.yaml"));
});

test("kit-install adds the policy and info page starters only where the frontend has none", () => {
  const plan = planKitInstall({ kitRoot, target: received({ "app/pages/about/page.tsx": "x" }), appRoot: "" });
  assert.equal(plan.extras.find((e) => e.to === "app/policies/[handle]/page.tsx").text, policyPage("../../../lib/shopify"));
  assert.ok(!plan.extras.some((e) => e.to === "app/pages/[handle]/page.tsx"));
  assert.deepEqual(plan.conflicts, [], "their own pages folder is not a conflict");
});

test("the page starters follow the app root and the @/* alias", () => {
  const target = received({ "src/app/page.tsx": "", "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }) });
  const plan = planKitInstall({ kitRoot, target, appRoot: "src/" });
  assert.equal(plan.extras.find((e) => e.to === "src/app/policies/[handle]/page.tsx").text, policyPage("@/lib/shopify"));
  assert.equal(plan.extras.find((e) => e.to === "src/app/pages/[handle]/page.tsx").text, infoPage("@/lib/shopify"));
});

test("no standalone note when the repo has its own Dockerfile", () => {
  const own = makeFixture({ "package.json": { name: "shop" }, Dockerfile: "FROM x\n", "next.config.ts": "export default {};\n" });
  assert.equal(planKitInstall({ kitRoot, target: own, appRoot: "" }).deployNote, null);
});
