import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = (...args) => spawnSync(process.execPath, ["scripts/setup/cli.mjs", ...args], { encoding: "utf8" });

for (const word of ["--help", "help"]) {
  test(`shop-setup ${word} prints the usage and exits 0`, () => {
    const res = run(word);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^usage: pnpm shop-setup /);
  });
}

test("shop-setup with no command prints the usage and exits 0", () => {
  assert.equal(run().status, 0);
});

test("shop-setup with an unknown command prints the usage and exits 1", () => {
  const res = run("nonsense");
  assert.equal(res.status, 1);
  assert.match(res.stdout, /^usage: /);
});
