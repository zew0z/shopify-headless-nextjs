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
 * into it as it is. The kit needs Next.js 16+ with the App Router.
 */
export function detectStack(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const base = { framework: "unknown", nextMajor: null, router: null, appRoot: null, supported: false };
  if (!pkg) return { ...base, reason: "No package.json: this is not a JavaScript app the kit can be installed into." };

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
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
