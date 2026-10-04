import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./args.mjs";

test("bare flags are true, so --dry-run can never be read as unset", () => {
  assert.deepEqual(parseArgs(["shipping", "--dry-run"]), { command: "shipping", args: [], flags: { "dry-run": true } });
});

test("key=value flags keep their value", () => {
  assert.equal(parseArgs(["shipping", "--location=gid://shopify/Location/1"]).flags.location, "gid://shopify/Location/1");
});

test("positionals after the command are kept in order", () => {
  assert.deepEqual(parseArgs(["done", "intake", "answered", "by", "owner"]).args, ["intake", "answered", "by", "owner"]);
});

test("no input gives no command", () => {
  assert.deepEqual(parseArgs([]), { command: undefined, args: [], flags: {} });
});
