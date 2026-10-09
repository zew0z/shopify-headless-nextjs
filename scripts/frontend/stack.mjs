import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const MIN_NEXT = 16;
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

/** First whole number in a version range: "^16.1.0" -> 16, "16.x" -> 16, "latest" -> null. */
function majorOf(range) {
  const m = /(\d+)/.exec(String(range));
  return m ? Number(m[1]) : null;
}

/**
 * What a received frontend is built with, and whether the kit can be installed
 * into it as it is. Supported paths are Next.js 16+ App Router and Astro 7 SSR.
 */
export function detectStack(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const base = { framework: "unknown", nextMajor: null, router: null, appRoot: null, supported: false };
  if (!pkg) return { ...base, reason: "No package.json: this is not a JavaScript app the kit can be installed into." };

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.astro && !deps.next) {
    const astroMajor = majorOf(deps.astro) ?? majorOf(readJson(path.join(dir, "node_modules/astro/package.json"))?.version ?? "");
    const configFile = ["ts", "mjs", "js"].map((ext) => path.join(dir, `astro.config.${ext}`)).find(existsSync);
    const config = configFile ? readFileSync(configFile, "utf8") : "";
    const stack = { ...base, framework: "astro", astroMajor, router: "pages", appRoot: "src/" };
    if (astroMajor !== 7) return { ...stack, reason: "The Astro adapter supports verified Astro 7 projects. Install Astro 7 before connecting this frontend." };
    if (!existsSync(path.join(dir, "src/pages"))) return { ...stack, reason: "No src/pages folder found for Astro's routes." };
    const hasAdapter = Object.keys(deps).some((name) => /^@astrojs\/(node|cloudflare|netlify|vercel)$/.test(name));
    if (!hasAdapter || !/\badapter\s*:/.test(config) || !/\boutput\s*:\s*["']server["']/.test(config)) {
      return { ...stack, reason: "Astro Shopify cart routes need output: server and a configured SSR adapter. Keep existing security settings and configure an adapter before kit-install." };
    }
    return { ...stack, supported: true, reason: "Astro 7, server output with an SSR adapter, code under src/. Follow docs/frontend-wiring-astro.md." };
  }
  if (!deps.next) {
    const framework = deps.astro ? "astro" : deps["@remix-run/react"] || deps["react-router"] ? "remix" : deps.gatsby ? "gatsby" : deps.vite ? "vite" : "unknown";
    return {
      ...base,
      framework,
      reason: `Built with ${framework === "unknown" ? "no framework the kit recognises" : framework}, not Next.js. The kit needs Next.js ${MIN_NEXT}+ with the App Router: ask the owner whether to move the frontend to Next.js.`,
    };
  }

  let nextMajor = majorOf(deps.next);
  if (nextMajor === null) nextMajor = majorOf(readJson(path.join(dir, "node_modules/next/package.json"))?.version ?? "");

  const appRoot = existsSync(path.join(dir, "src/app")) ? "src/" : existsSync(path.join(dir, "app")) ? "" : null;
  const hasPages = existsSync(path.join(dir, "src/pages")) || existsSync(path.join(dir, "pages"));
  const router = appRoot !== null ? "app" : hasPages ? "pages" : null;
  const stack = { ...base, framework: "next", nextMajor, router, appRoot };

  if (nextMajor === null)
    return { ...stack, reason: `The package.json asks for next "${deps.next}" and no installed copy says which, so the kit cannot tell the Next.js version. Run the package install first.` };
  if (nextMajor < MIN_NEXT)
    return { ...stack, reason: `Next.js ${nextMajor}. The kit uses Next.js ${MIN_NEXT} caching, so upgrade the frontend to ${MIN_NEXT} first.` };
  if (router === "pages")
    return { ...stack, reason: "Uses the Pages Router. The kit only supports the App Router (app/ or src/app/) so far." };
  if (router === null) return { ...stack, reason: "No app/ or src/app/ folder found, so there are no pages to connect." };
  return { ...stack, supported: true, reason: `Next.js ${nextMajor}, App Router, code under ${appRoot || "the repo root"}.` };
}
