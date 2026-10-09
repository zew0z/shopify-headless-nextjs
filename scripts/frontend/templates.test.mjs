import test from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { planKitInstall } from "./kit.mjs";
import { applyKitInstall } from "./install.mjs";
import { ERROR_PAGE, GLOBAL_ERROR_PAGE, infoPage, policyPage } from "./templates.mjs";
import { makeFixture } from "../test-support/fixture.mjs";

// Next 16.3 hands boundaries `retry`, 16.2 `unstable_retry`, older 16.x only `reset`.
// The stack check accepts any Next 16, so the pages take `retry` or `reset`.
for (const [name, page] of [["error", ERROR_PAGE], ["global-error", GLOBAL_ERROR_PAGE]]) {
  test(`the ${name} page works with retry (16.3+) or reset (older 16.x)`, () => {
    assert.match(page, /^"use client";/);
    assert.match(page, /retry\?: \(\) => void/);
    assert.match(page, /reset\?: \(\) => void/);
    assert.match(page, /\(retry \?\? reset\)\?\.\(\)/);
    assert.doesNotMatch(page, /onClick=\{\(\) => retry\(\)\}/, "retry alone breaks on Next before 16.3");
    assert.match(page, /process\.env\.NODE_ENV !== "production"/);
  });
}

test("the global error page brings its own html and body", () => {
  assert.match(GLOBAL_ERROR_PAGE, /<html[\s\S]*<body>/);
});

test("the policy and info page starters read Shopify and call notFound for a missing handle", () => {
  for (const [page, read] of [[policyPage("@/lib/shopify"), "getPolicy(handle)"], [infoPage("@/lib/shopify"), "getPage(handle)"]]) {
    assert.ok(page.includes('from "@/lib/shopify"'));
    assert.ok(page.includes(read));
    assert.ok(page.includes("notFound()"));
    // Next 16 hands pages and generateMetadata their params as a Promise.
    assert.ok(page.includes("params: Promise<{ handle: string }>"));
    assert.ok(page.includes("export async function generateMetadata"));
  }
  assert.ok(policyPage("../../../lib/shopify").includes('from "../../../lib/shopify"'));
});

test("the page starters type-check against the SDK kit-install puts next to them", () => {
  const kitRoot = process.cwd();
  const target = makeFixture({
    "package.json": { scripts: {}, dependencies: { next: "16.3.4", react: "19.2.8", "react-dom": "19.2.8" } },
    "app/page.tsx": "export default function Page() { return null; }",
  });
  applyKitInstall(planKitInstall({ kitRoot, target, appRoot: "" }), target, { audit: "fixture", install: "test" });
  symlinkSync(path.join(kitRoot, "node_modules"), path.join(target, "node_modules"), "dir");
  const pages = ["app/policies/[handle]/page.tsx", "app/pages/[handle]/page.tsx"];
  const tsc = path.join(kitRoot, "node_modules/typescript/bin/tsc");
  const flags = ["--noEmit", "--strict", "--skipLibCheck", "--jsx", "react-jsx", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler"];
  const run = spawnSync(process.execPath, [tsc, ...flags, ...pages], { cwd: target, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
