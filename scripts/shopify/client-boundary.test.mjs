import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findSdkDir } from "./sdk-dir.mjs";

// These files run in the browser, so they must not pull in anything that reads server-only settings.
const BROWSER_SAFE = [
  "cart-store.ts", "cart-provider.tsx", "variants.ts", "menu.ts", "money.ts",
  "analytics-events.ts", "privacy.ts", "analytics-tracker.ts", "analytics.tsx",
];
// "./client", "../client.ts", "@/lib/shopify" (which is index) and "@/lib/shopify/config".
const SERVER_ONLY = /^\.{1,2}\/(?:.*\/)?(?:client|config|index)(?:\.[jt]sx?)?$|(?:^|\/)lib\/shopify(?:\/(?:client|config|index)(?:\.[jt]sx?)?)?$/;

// Every import and re-export with a path, except `import type` / `export type` (types vanish at build).
const FROM = /\b(import|export)(\s+type\b)?([^;'"]*?)\bfrom\s*["']([^"']+)["']|\bimport\s*(?:\(\s*)?["']([^"']+)["']/g;

function serverImports(source) {
  const bad = [];
  for (const m of source.matchAll(FROM)) {
    if (m[2]) continue;
    const spec = m[4] ?? m[5];
    // `import { type A, type B } from` leaves no runtime import.
    const names = (m[3] ?? "").replace(/[{}]/g, "").split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length && names.every((n) => n.startsWith("type "))) continue;
    if (SERVER_ONLY.test(spec)) bad.push(spec);
  }
  return bad;
}

test("the browser-safe SDK files import nothing from client, config or index", () => {
  const dir = findSdkDir(process.cwd());
  assert.ok(dir, "no src/lib/shopify or lib/shopify in this repo");
  for (const file of BROWSER_SAFE) {
    assert.deepEqual(serverImports(readFileSync(path.join(dir, file), "utf8")), [], `${file} imports server-only code`);
  }
});

test("the check itself catches value imports and lets type imports through", () => {
  assert.deepEqual(serverImports('import { shopifyFetch } from "./client";'), ["./client"]);
  assert.deepEqual(serverImports('import { shopifyConfig } from "./config";'), ["./config"]);
  assert.deepEqual(serverImports('export * from "./index";'), ["./index"]);
  assert.deepEqual(serverImports('import "./client";'), ["./client"]);
  assert.deepEqual(serverImports('import { x } from "@/lib/shopify";'), ["@/lib/shopify"]);
  assert.deepEqual(serverImports('import type { Cart } from "./index";\nimport { type A, type B } from "./config";'), []);
  assert.deepEqual(serverImports('import { money } from "./money";\nimport type { Menu } from "./types";'), []);
});
