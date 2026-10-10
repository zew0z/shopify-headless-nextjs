import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { findSdkDir } from "./sdk-dir.mjs";

const { NextResponse } = createRequire(import.meta.url)("next/server");
const appDir = path.dirname(path.dirname(findSdkDir(process.cwd())));
const compiled = ts.transpileModule(readFileSync(path.join(appDir, "app/api/search/route.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function endpoint(predictiveSearch) {
  const mod = { exports: {} };
  new Function("module", "exports", "require", compiled)(mod, mod.exports, (id) => {
    if (id === "next/server") return { NextResponse };
    if (id === "@/lib/shopify" || id === "../../../lib/shopify") return { predictiveSearch };
    throw new Error(`Unexpected route dependency: ${id}`);
  });
  return mod.exports.GET;
}

test("Next search route reports an outage without publishing or logging backend detail", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const result = await endpoint(async () => { throw new Error("PRIVATE-SEARCH-DETAIL-SENTINEL"); })(new Request("https://fixture.test/api/search?q=fixture"));
    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { error: "Search is unavailable. Try again shortly.", code: "backend" });
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal(logged.length, 0);
  } finally { console.error = original; }
});
