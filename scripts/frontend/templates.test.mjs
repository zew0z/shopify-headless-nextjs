import test from "node:test";
import assert from "node:assert/strict";
import { ERROR_PAGE, GLOBAL_ERROR_PAGE } from "./templates.mjs";

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
