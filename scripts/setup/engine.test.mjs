import test from "node:test";
import assert from "node:assert/strict";
import { nextActions, validateSteps } from "./engine.mjs";

const steps = [
  { id: "a", title: "A", owner: "human", needs: [] },
  { id: "b", title: "B", owner: "human", needs: [] },
  { id: "c", title: "C", owner: "api", needs: ["a"] },
  { id: "d", title: "D", owner: "browser", needs: ["a"] },
];

test("surfaces only the first ready human step", () => {
  const r = nextActions(steps, { done: {} });
  assert.deepEqual(r.human.map((s) => s.id), ["a"]);
  assert.deepEqual(r.agent, []);
});

test("agent steps unlock once their needs are done, humans stay one at a time", () => {
  const r = nextActions(steps, { done: { a: { at: "t" } } });
  assert.deepEqual(r.agent.map((s) => s.id), ["c", "d"]);
  assert.deepEqual(r.human.map((s) => s.id), ["b"]);
});

test("done steps are not offered again", () => {
  const r = nextActions(steps, { done: { a: { at: "t" }, b: { at: "t" }, c: { at: "t" } } });
  assert.deepEqual(r.agent.map((s) => s.id), ["d"]);
  assert.deepEqual(r.human, []);
});

test("validateSteps flags unknown needs, duplicates and cycles", () => {
  assert.deepEqual(validateSteps(steps), []);
  assert.match(validateSteps([{ id: "x", title: "", owner: "api", needs: ["nope"] }])[0], /unknown/);
  assert.match(validateSteps([steps[0], steps[0]])[0], /duplicate/);
  const cyc = [
    { id: "x", title: "", owner: "api", needs: ["y"] },
    { id: "y", title: "", owner: "api", needs: ["x"] },
  ];
  assert.match(validateSteps(cyc).join("\n"), /cycle/);
});

test("code steps (the agent edits the frontend) are agent work, not human work", () => {
  const r = nextActions([{ id: "c", title: "C", owner: "code", needs: [] }], { done: {} });
  assert.deepEqual(r.agent.map((s) => s.id), ["c"]);
  assert.deepEqual(r.human, []);
});
