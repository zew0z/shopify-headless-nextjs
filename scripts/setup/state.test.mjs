import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyState, markDone, loadState, saveState } from "./state.mjs";

test("markDone is pure and records time and note", () => {
  const s0 = emptyState();
  const s1 = markDone(s0, "intake", "answered", new Date("2026-10-04T10:00:00Z"));
  assert.deepEqual(s0, { done: {} });
  assert.deepEqual(s1.done.intake, { at: "2026-10-04T10:00:00.000Z", note: "answered" });
});

test("loadState returns empty state for a missing file and round-trips", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "setup-")), "state.json");
  assert.deepEqual(loadState(file), { done: {} });
  saveState(file, markDone(emptyState(), "a", undefined, new Date(0)));
  assert.deepEqual(loadState(file).done.a, { at: "1970-01-01T00:00:00.000Z" });
});
