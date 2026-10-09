import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { detectStack } from "./stack.mjs";

const read = (root, file) => readFileSync(path.join(root, file), "utf8");
const filesUnder = (root, rel) => readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? filesUnder(root, `${rel}/${e.name}`) : [`${rel}/${e.name}`]);

/** Astro receives its real adapter, never Next routes, dependencies, deployment settings, or the Next-only skill. */
export function planAstroInstall({ kitRoot, target }) {
  const stack = detectStack(target);
  if (!stack.supported) throw new Error(stack.reason);
  const installedRoot = "src/lib/shopify/astro";
  const sourceRoot = existsSync(path.join(kitRoot, "adapters/astro")) ? "adapters/astro" : installedRoot;
  const payload = filesUnder(kitRoot, sourceRoot).map((from) => ({ from, to: `${installedRoot}/${path.posix.basename(from)}` }));
  const scriptRoot = existsSync(path.join(kitRoot, "scripts/shopify-kit/setup/cli.mjs")) ? "scripts/shopify-kit" : "scripts";
  for (const from of filesUnder(kitRoot, scriptRoot)) {
    const relative = from.slice(scriptRoot.length + 1);
    // Next SDK fixture tests are not valid in an Astro-only app. Astro's own adapter tests are shipped below.
    if (from.endsWith(".test.mjs") && !relative.startsWith("astro/")) continue;
    payload.push({ from, to: `scripts/shopify-kit/${relative}` });
  }
  for (const from of ["store-setup.config.example.json", "docs/frontend-wiring-astro.md", "docs/catalogue-import.md", "docs/shopify-api-gotchas.md"]) {
    if (existsSync(path.join(kitRoot, from))) payload.push({ from, to: from });
  }
  const write = [], same = [], conflicts = [];
  const addFile = (to, text) => {
    if (!existsSync(path.join(target, to))) write.push({ to, text });
    else if (read(target, to) === text) same.push(to);
    else conflicts.push({ to, why: "already exists with different content" });
  };
  for (const { from, to } of payload) addFile(to, read(kitRoot, from));
  addFile("src/lib/shopify/index.ts", 'export * from "./astro/index";\n');
  const pkg = JSON.parse(read(target, "package.json"));
  const add = { scripts: {}, dependencies: {}, devDependencies: {} };
  const pkgConflicts = [];
  const scripts = {
    "shop-setup": "node scripts/shopify-kit/setup/cli.mjs",
    "test:shopify": 'node --test "scripts/shopify-kit/astro/*.test.mjs"',
  };
  for (const [key, want] of Object.entries(scripts)) {
    const have = pkg.scripts?.[key];
    if (have === undefined) add.scripts[key] = want;
    else if (have !== want) pkgConflicts.push({ key: `scripts.${key}`, have, want });
  }
  // ts-hooks compile adapter tests; normal installations already have TypeScript.
  const needsTs = !pkg.dependencies?.typescript && !pkg.devDependencies?.typescript;
  const pm = existsSync(path.join(target, "package-lock.json")) ? "npm" : "pnpm";
  let installCommand = pm === "npm" ? "npm install" : "pnpm install";
  if (needsTs && pm === "npm") installCommand = "npm install --save-dev typescript";
  if (needsTs && pm === "pnpm") add.devDependencies.typescript = "^5";
  const marker = 'import { createAstroCommerce, createCartEndpoint } from "../../lib/shopify/astro";\nexport const prerender = false;\nconst cart = createCartEndpoint(createAstroCommerce());\nexport const GET = cart;\nexport const POST = cart;\n';
  const hasCommerce = existsSync(path.join(target, "src/modules/commerce/lib/types.ts"));
  if (!hasCommerce) addFile("src/pages/api/cart.ts", marker);
  return {
    write, same, conflicts, oldSdk: conflicts.some((c) => c.to.startsWith("src/lib/shopify/")),
    framework: "astro", packageManager: pm, packageJson: { add, conflicts: pkgConflicts, installCommand },
    gitignore: [], agentsNote: false, extras: [], keptErrorPage: true,
    deployNote: "Astro: retain the existing SSR adapter, server, CSP and cookie rules. Read docs/frontend-wiring-astro.md; the protected connection skill remains Next-only. Wire the template provider explicitly before frontend-check can pass.",
  };
}
