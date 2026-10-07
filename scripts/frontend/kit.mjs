import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { findSdkDir } from "../shopify/sdk-dir.mjs";
import { ERROR_PAGE, GLOBAL_ERROR_PAGE } from "./templates.mjs";

const ROUTES = ["cart", "revalidate", "health", "search"];
const COPIED_AS_IS = [
  "playwright.config.mjs",
  "store-setup.config.example.json",
  ".claude/skills/shopify-store-setup/SKILL.md",
  ".claude/skills/shopify-connect-frontend/SKILL.md",
  "docs/catalogue-import.md",
  "docs/shopify-api-gotchas.md",
  "docs/frontend-wiring.md",
];
const SCRIPTS = ["shop-setup", "test:scripts", "test:e2e"];
const DEV_TOOLS = ["@playwright/test", "typescript"];
const GITIGNORE = [".env*", "/data/catalog.json", "/test-results/", "/playwright-report/", "frontend-audit.json"];

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

/**
 * What the kit puts into a received repo: the SDK and its API routes under the
 * repo's app root, plus the setup scripts, tests, skills and docs. Not the kit's
 * own demo pages, components, plans or README.
 */
export function kitFiles(kitRoot, appRoot) {
  const sdkDir = findSdkDir(kitRoot);
  const kitApp = path.relative(kitRoot, path.dirname(path.dirname(sdkDir)));
  const kitPrefix = kitApp ? `${kitApp}/` : "";
  const sdk = readdirSync(sdkDir)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ from: `${kitPrefix}lib/shopify/${f}`, to: `${appRoot}lib/shopify/${f}` }));
  const routes = ROUTES.map((r) => ({
    from: `${kitPrefix}app/api/${r}/route.ts`,
    to: `${appRoot}app/api/${r}/route.ts`,
    transform: (text) => text.replaceAll('"@/lib/shopify', '"../../../lib/shopify'),
  }));
  const tooling = [...filesUnder(kitRoot, "scripts"), ...filesUnder(kitRoot, "e2e"), ...COPIED_AS_IS]
    .filter((f) => existsSync(path.join(kitRoot, f)))
    .map((f) => ({ from: f, to: f }));
  return [...sdk, ...routes, ...tooling];
}

/** What installing the kit would change in the target repo. Reads only; writes nothing. */
export function planKitInstall({ kitRoot, target, appRoot }) {
  const write = [];
  const same = [];
  const conflicts = [];
  for (const f of kitFiles(kitRoot, appRoot)) {
    const raw = read(path.join(kitRoot, f.from));
    const text = f.transform ? f.transform(raw) : raw;
    const dest = path.join(target, f.to);
    if (!existsSync(dest)) write.push({ to: f.to, text });
    else if (read(dest) === text) same.push(f.to);
    else conflicts.push({ to: f.to, why: "already exists with different content" });
  }

  const kitPkg = readJson(path.join(kitRoot, "package.json"));
  const pkg = readJson(path.join(target, "package.json"));
  const add = { scripts: {}, devDependencies: {} };
  const pkgConflicts = [];
  for (const key of SCRIPTS) {
    const want = kitPkg.scripts[key];
    const have = pkg.scripts?.[key];
    if (have === undefined) add.scripts[key] = want;
    else if (have !== want) pkgConflicts.push({ key: `scripts.${key}`, have, want });
  }
  const installed = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of DEV_TOOLS) if (!installed[name]) add.devDependencies[name] = kitPkg.devDependencies[name];

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

  return { write, same, conflicts, packageJson: { add, conflicts: pkgConflicts }, gitignore, agentsNote, extras, keptErrorPage: hasPage("error") };
}

export const hasConflicts = (plan) => plan.conflicts.length > 0 || plan.packageJson.conflicts.length > 0;
