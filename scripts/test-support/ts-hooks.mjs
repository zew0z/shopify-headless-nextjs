/**
 * Module hooks that let node:test import the Next.js SDK in src/ as it is:
 * extensionless relative imports resolve to .ts, and .ts is compiled with the
 * project's own TypeScript (type-only imports are dropped, which Node's
 * built-in type stripping does not do).
 */
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function resolve(specifier, context, next) {
  const fromTs = context.parentURL?.endsWith(".ts");
  if (fromTs && specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    // Packages without an exports map, such as next/headers, need the .js spelled out in ESM.
    if (err.code === "ERR_MODULE_NOT_FOUND" && fromTs) return next(`${specifier}.js`, context);
    throw err;
  }
}

export async function load(url, context, next) {
  if (!url.endsWith(".ts")) return next(url, context);
  const source = await readFile(new URL(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: url,
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
