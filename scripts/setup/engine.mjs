const AGENT_OWNERS = new Set(["api", "browser", "code"]);

/** What can move now. Humans get ONE step at a time; twelve at once gets three done. */
export function nextActions(steps, state) {
  const done = state.done ?? {};
  const ready = steps.filter((s) => !done[s.id] && s.needs.every((n) => done[n]));
  return {
    agent: ready.filter((s) => AGENT_OWNERS.has(s.owner)),
    human: ready.filter((s) => s.owner === "human").slice(0, 1),
  };
}

export function validateSteps(steps) {
  const errors = [];
  const ids = new Set();
  for (const s of steps) {
    if (ids.has(s.id)) errors.push(`duplicate step id: ${s.id}`);
    ids.add(s.id);
  }
  for (const s of steps) {
    for (const n of s.needs) if (!ids.has(n)) errors.push(`step ${s.id} needs unknown step ${n}`);
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail) => {
    if (visited.has(id) || !byId.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    visiting.add(id);
    for (const n of byId.get(id).needs) visit(n, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const s of steps) visit(s.id, []);
  return errors;
}
