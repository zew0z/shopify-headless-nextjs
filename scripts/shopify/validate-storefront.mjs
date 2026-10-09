/**
 * Checks every Storefront query and mutation in src/lib/shopify against a
 * Shopify API version, without needing a store. shopify.dev serves the real
 * schema for each supported version on a public proxy. Shopify reports schema
 * errors (removed fields, bad arguments) before it looks at variables, so each
 * document is sent with deliberately uncoercible variables: it is validated and
 * never executed.
 *
 * Run it before changing the SDK's API version, and after:
 *   pnpm shop-setup validate-queries --version=2026-07
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { findSdkDir } from "./sdk-dir.mjs";

export const SDK_DIR = findSdkDir(process.cwd()) ?? path.join(process.cwd(), "src", "lib", "shopify");
export const PROXY = (version) => `https://shopify.dev/storefront-graphql-direct-proxy/${version}`;

/** Evaluates one SDK .ts file in isolation. Only relative imports between the SDK's own files are allowed. */
function evaluate(file, imports) {
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const commonjs = { exports: {} };
  new Function("module", "exports", "require", outputText)(commonjs, commonjs.exports, (id) => {
    if (id in imports) return imports[id];
    throw new Error(`${path.basename(file)} imports "${id}", which the validator does not know how to load`);
  });
  return commonjs.exports;
}

export function loadSdkDocuments(dir = SDK_DIR) {
  const astro = [path.join(dir, "astro/queries.ts"), path.join(process.cwd(), "adapters/astro/queries.ts")].find(existsSync);
  if (!existsSync(path.join(dir, "queries.ts")) && astro) {
    return Object.entries(evaluate(astro, {})).filter(([, query]) => typeof query === "string" && /^\s*(query|mutation)\b/.test(query)).map(([name, query]) => ({ name, query }));
  }
  const queries = evaluate(path.join(dir, "queries.ts"), {});
  const mutations = evaluate(path.join(dir, "mutations.ts"), { "./queries": queries });
  return Object.entries({ ...queries, ...mutations })
    .filter(([, value]) => typeof value === "string" && /^\s*(query|mutation)\b/.test(value))
    .map(([name, query]) => ({ name, query }));
}

export function loadAstroDocuments(dir) {
  const root = dir ?? [path.join(process.cwd(), "adapters/astro"), path.join(SDK_DIR, "astro")].find((p) => existsSync(path.join(p, "queries.ts")));
  if (!root) throw new Error("Astro query documents are not installed.");
  return Object.entries(evaluate(path.join(root, "queries.ts"), {})).filter(([, query]) => typeof query === "string" && /^\s*(query|mutation)\b/.test(query)).map(([name, query]) => ({ name, query }));
}

/** Every declared variable gets a value no type accepts, so Shopify validates the document and then stops. */
export function badVariables(query) {
  const names = [...query.matchAll(/\$(\w+)\s*:/g)].map((m) => m[1]);
  return Object.fromEntries(names.map((name) => [name, { __invalid: true }]));
}

export function classifyResponse(json) {
  if (json?.error) return { ok: false, problems: [String(json.error)] };
  const real = (json?.errors ?? []).filter((e) => !/was provided invalid value/.test(e.message));
  return real.length ? { ok: false, problems: real.map((e) => e.message) } : { ok: true, problems: [] };
}

export async function validateDocuments({ version, documents, fetchFn = fetch }) {
  const results = [];
  for (const { name, query } of documents) {
    const variables = badVariables(query);
    if (/^\s*mutation\b/.test(query) && !Object.keys(variables).length) {
      results.push({ name, ok: false, problems: ["a mutation with no variables would execute on the proxy; not checked"] });
      continue;
    }
    const response = await fetchFn(PROXY(version), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    results.push({ name, ...classifyResponse(await response.json()) });
  }
  return results;
}
