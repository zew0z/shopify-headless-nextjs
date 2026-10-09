import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { findSdkDir } from "../shopify/sdk-dir.mjs";
import { readAliases } from "./sources.mjs";
import { DEPLOY_WORKFLOW, DOCKERIGNORE, ERROR_PAGE, GLOBAL_ERROR_PAGE, dockerfile, infoPage, policyPage } from "./templates.mjs";

// Paths under app/api/. "[version]/graphql.json" is the Storefront API proxy Shopify's privacy script needs.
const ROUTES = ["cart", "revalidate", "health", "search", "contact", "[version]/graphql.json", "shopify/analytics/config"];
const COPIED_AS_IS = [
  "playwright.config.mjs",
  "store-setup.config.example.json",
  ".claude/skills/shopify-store-setup/SKILL.md",
  ".claude/skills/shopify-connect-frontend/SKILL.md",
  "docs/catalogue-import.md",
  "docs/shopify-api-gotchas.md",
  "docs/frontend-wiring.md",
  "docs/shopify-analytics.md",
];
const SCRIPTS = ["shop-setup", "test:scripts", "test:e2e"];
const RUNTIME_TOOLS = ["@shopify/hydrogen"];
const DEV_TOOLS = ["@playwright/test", "typescript"];
// `!.env.example` follows `.env*` so a committed example file is not hidden by it.
const GITIGNORE = [".env*", "!.env.example", "/data/catalog.json", "/test-results/", "/playwright-report/", "frontend-audit.json"];

export const STORE_SETUP_BLOCK = `# Store setup

This frontend sells through Shopify. To connect it or take the shop live, follow \`.claude/skills/shopify-connect-frontend/SKILL.md\` until the frontend is wired, then \`.claude/skills/shopify-store-setup/SKILL.md\`. Start with \`pnpm shop-setup next\`.
`;

const read = (file) => readFileSync(file, "utf8");
const readJson = (file) => (existsSync(file) ? JSON.parse(read(file)) : {});

function filesUnder(root, rel) {
  if (!existsSync(path.join(root, rel))) return [];
  return readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(root, `${rel}/${e.name}`) : [`${rel}/${e.name}`]
  );
}

// readAliases joins baseUrl with each target: "./*" comes back as "*", "./src/*" as "src/*".
const folderOf = (p) => path.posix.normalize(p.replace(/\*$/, "") || ".").replace(/\/$/, "") || ".";

/** "@/lib/shopify" when the repo's "@/*" alias points at the app root, else a relative path from fromFile's folder. */
export function sdkImport(target, appRoot, fromFile) {
  const alias = (target ? readAliases(target) : []).find((a) => a.pattern === "@/*");
  if (alias?.targets.some((t) => folderOf(t) === folderOf(appRoot || "."))) return "@/lib/shopify";
  const rel = path.posix.relative(path.posix.dirname(fromFile), `${appRoot}lib/shopify`);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/**
 * What the kit puts into a received repo: the SDK and its API routes under the
 * repo's app root, plus the setup scripts, tests, skills and docs. Not the kit's
 * own demo pages, components, plans or README. With the target, routes keep
 * `@/lib/shopify` where the repo's alias allows it.
 */
export function kitFiles(kitRoot, appRoot, target) {
  const sdkDir = findSdkDir(kitRoot);
  const kitApp = path.relative(kitRoot, path.dirname(path.dirname(sdkDir)));
  const kitPrefix = kitApp ? `${kitApp}/` : "";
  const sdk = readdirSync(sdkDir)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ from: `${kitPrefix}lib/shopify/${f}`, to: `${appRoot}lib/shopify/${f}` }));
  const routes = ROUTES.map((r) => {
    const to = `${appRoot}app/api/${r}/route.ts`;
    const spec = sdkImport(target, appRoot, to);
    const relative = sdkImport(undefined, appRoot, to);
    return {
      from: `${kitPrefix}app/api/${r}/route.ts`,
      to,
      transform: (text) => text.replaceAll('"@/lib/shopify', `"${spec}`),
      // Older installs wrote relative imports even where the alias works: that route is the same one.
      sameAs: spec === relative ? [] : [(text) => text.replaceAll('"@/lib/shopify', `"${relative}`)],
    };
  });
  const tooling = [...filesUnder(kitRoot, "scripts"), ...filesUnder(kitRoot, "e2e"), ...COPIED_AS_IS]
    .filter((f) => existsSync(path.join(kitRoot, f)))
    .map((f) => ({ from: f, to: f }));
  return [...sdk, ...routes, ...tooling];
}

/** What installing the kit would change in the target repo. Reads only; writes nothing. */
export function planKitInstall({ kitRoot, target, appRoot }) {
  const pm = existsSync(path.join(target, "package-lock.json")) && !existsSync(path.join(target, "pnpm-lock.yaml")) ? "npm" : "pnpm";
  const write = [];
  const same = [];
  const conflicts = [];
  for (const f of kitFiles(kitRoot, appRoot, target)) {
    const raw = read(path.join(kitRoot, f.from));
    const text = f.transform ? f.transform(raw) : raw;
    const dest = path.join(target, f.to);
    if (!existsSync(dest)) write.push({ to: f.to, text });
    else if ([text, ...(f.sameAs ?? []).map((t) => t(raw))].includes(read(dest))) same.push(f.to);
    else conflicts.push({ to: f.to, why: "already exists with different content" });
  }

  const kitPkg = readJson(path.join(kitRoot, "package.json"));
  const pkg = readJson(path.join(target, "package.json"));
  const add = { scripts: {}, dependencies: {}, devDependencies: {} };
  const pkgConflicts = [];
  for (const key of SCRIPTS) {
    const want = kitPkg.scripts[key];
    const have = pkg.scripts?.[key];
    if (have === undefined) add.scripts[key] = want;
    else if (have !== want) pkgConflicts.push({ key: `scripts.${key}`, have, want });
  }
  for (const name of RUNTIME_TOOLS) {
    const want = kitPkg.dependencies[name];
    const have = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    if (have === undefined) add.dependencies[name] = want;
    else if (have !== want || !pkg.dependencies?.[name]) pkgConflicts.push({ key: `dependencies.${name}`, have, want });
  }
  const installed = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of DEV_TOOLS) if (!installed[name]) add.devDependencies[name] = kitPkg.devDependencies[name];

  // npm cannot read a package.json edited behind its back: `npm ci` stops when package-lock.json lacks a package.
  // So an npm repo gets the npm commands instead, which add the packages and update the lockfile together.
  let installCommand = "pnpm install";
  if (pm === "npm") {
    const wanted = (deps) => Object.entries(deps).map(([name, range]) => `${name}@${range}`).join(" ");
    const commands = [];
    if (Object.keys(add.devDependencies).length) commands.push(`npm install --save-dev ${wanted(add.devDependencies)}`);
    // The kit pins its runtime packages to an exact version; --save-exact keeps it pinned.
    if (Object.keys(add.dependencies).length) commands.push(`npm install --save-exact ${wanted(add.dependencies)}`);
    installCommand = commands.join(" && ") || "npm install";
    add.dependencies = {};
    add.devDependencies = {};
  }

  const ignoreFile = path.join(target, ".gitignore");
  const ignored = new Set((existsSync(ignoreFile) ? read(ignoreFile) : "").split("\n").map((l) => l.trim()));
  const gitignore = GITIGNORE.filter((line) => !ignored.has(line));

  const agentsNote = !["AGENTS.md", "CLAUDE.md"].some((f) => existsSync(path.join(target, f)) && read(path.join(target, f)).includes("# Store setup"));

  // Left for the next agent: plain error pages where the frontend has none, and a CLAUDE.md that points at AGENTS.md.
  // Their own error page stays as it is and is never a conflict.
  const hasPage = (name) => ["tsx", "ts", "jsx", "js"].some((ext) => existsSync(path.join(target, `${appRoot}app/${name}.${ext}`)));
  const extras = [];
  if (!hasPage("error")) extras.push({ to: `${appRoot}app/error.tsx`, text: ERROR_PAGE });
  if (!hasPage("global-error")) extras.push({ to: `${appRoot}app/global-error.tsx`, text: GLOBAL_ERROR_PAGE });
  if (!existsSync(path.join(target, "CLAUDE.md"))) extras.push({ to: "CLAUDE.md", text: "@AGENTS.md\n" });
  // Policy and info pages that read the owner's text from Shopify, where the frontend has no such route.
  for (const [folder, template] of [["policies", policyPage], ["pages", infoPage]]) {
    if (existsSync(path.join(target, `${appRoot}app/${folder}`))) continue;
    const to = `${appRoot}app/${folder}/[handle]/page.tsx`;
    extras.push({ to, text: template(sdkImport(target, appRoot, to)) });
  }
  // Without the kit's build settings, pnpm install stops on the build scripts it was not told about (and pnpm
  // re-runs it before every script), so a pnpm repo that has none gets the kit's.
  const workspace = path.join(kitRoot, "pnpm-workspace.yaml");
  if (pm === "pnpm" && existsSync(workspace) && !existsSync(path.join(target, "pnpm-workspace.yaml"))) {
    extras.push({ to: "pnpm-workspace.yaml", text: read(workspace) });
  }

  // NOTIXV deploy (Docker image -> Artifact Registry -> Flux), only where the repo has its own nothing.
  if (!existsSync(path.join(target, "Dockerfile"))) extras.push({ to: "Dockerfile", text: dockerfile(pm) });
  if (!existsSync(path.join(target, ".dockerignore"))) extras.push({ to: ".dockerignore", text: DOCKERIGNORE });
  if (!existsSync(path.join(target, ".github/workflows/deploy-image.yaml"))) extras.push({ to: ".github/workflows/deploy-image.yaml", text: DEPLOY_WORKFLOW });
  const nextConfig = ["ts", "mjs", "js"].map((ext) => path.join(target, `next.config.${ext}`)).find((f) => existsSync(f));
  const deployNote = existsSync(path.join(target, "Dockerfile")) || (nextConfig && /output:\s*["']standalone["']/.test(read(nextConfig))) ? null : 'Set output: "standalone" in next.config: the Dockerfile copies .next/standalone.';

  return {
    write,
    same,
    conflicts,
    // A conflict inside lib/shopify is an older kit or the frontend's own client, to move aside before installing.
    oldSdk: conflicts.some((c) => c.to.startsWith(`${appRoot}lib/shopify/`)),
    packageManager: pm,
    packageJson: { add, conflicts: pkgConflicts, installCommand },
    gitignore,
    agentsNote,
    extras,
    deployNote,
    keptErrorPage: hasPage("error"),
  };
}

export const hasConflicts = (plan) => plan.conflicts.length > 0 || plan.packageJson.conflicts.length > 0;
