import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const emptyState = () => ({ done: {} });

export function markDone(state, id, note, now = new Date()) {
  return { ...state, done: { ...state.done, [id]: { at: now.toISOString(), ...(note ? { note } : {}) } } };
}

export function loadState(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : emptyState();
}

/** No secrets in here, only step ids, timestamps and short notes. Safe to commit. */
export function saveState(file, state) {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}
