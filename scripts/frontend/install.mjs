import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emptyState, markDone, saveState } from "../setup/state.mjs";
import { STORE_SETUP_BLOCK, hasConflicts } from "./kit.mjs";

/** Adds keys to package.json and keeps its key order, indentation and final newline. A section with nothing to add is left as it is. */
function mergePackageJson(file, add) {
  const text = readFileSync(file, "utf8");
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? 2;
  const pkg = JSON.parse(text);
  for (const key of ["scripts", "dependencies", "devDependencies"]) {
    if (Object.keys(add[key] ?? {}).length) pkg[key] = { ...pkg[key], ...add[key] };
  }
  writeFileSync(file, `${JSON.stringify(pkg, null, indent)}${text.endsWith("\n") ? "\n" : ""}`);
}

/**
 * Installs the kit into the target repo from a plan made by planKitInstall.
 * Refuses a plan with conflicts before touching anything. Returns how many
 * files and settings it changed (0 when the kit is already installed).
 */
export function applyKitInstall(plan, target, notes) {
  if (hasConflicts(plan)) throw new Error("the plan has conflicts; resolve them and plan again before installing");
  let changed = 0;

  for (const { to, text } of plan.write) {
    const dest = path.join(target, to);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    changed++;
  }

  const { add } = plan.packageJson;
  if (Object.keys(add.scripts).length || Object.keys(add.dependencies ?? {}).length || Object.keys(add.devDependencies).length) {
    mergePackageJson(path.join(target, "package.json"), add);
    changed++;
  }

  if (plan.gitignore.length) {
    const file = path.join(target, ".gitignore");
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const gap = before && !before.endsWith("\n") ? "\n" : "";
    appendFileSync(file, `${gap}${before ? "\n" : ""}# Shopify kit\n${plan.gitignore.join("\n")}\n`);
    changed++;
  }

  if (plan.agentsNote) {
    const file = ["AGENTS.md", "CLAUDE.md"].map((f) => path.join(target, f)).find(existsSync) ?? path.join(target, "AGENTS.md");
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    appendFileSync(file, `${before && !before.endsWith("\n") ? "\n" : ""}${before ? "\n" : ""}${STORE_SETUP_BLOCK}`);
    changed++;
  }

  // After the agents note, which writes into CLAUDE.md only when AGENTS.md does not exist yet.
  for (const { to, text } of plan.extras) {
    const dest = path.join(target, to);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    changed++;
  }

  const stateFile = path.join(target, "store-setup.state.json");
  if (!existsSync(stateFile)) {
    saveState(stateFile, markDone(markDone(emptyState(), "frontend-audit", notes.audit), "kit-install", notes.install));
    changed++;
  }
  return { changed };
}
