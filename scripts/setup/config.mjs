import { existsSync, readFileSync } from "node:fs";
import { validateConfig } from "./intake.mjs";
import { bad, info, warn } from "../shopify/env.mjs";

export const CONFIG_FILE = "store-setup.config.json";

/** Exits with a readable message instead of a stack trace: these are human errors. */
export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    bad(`${CONFIG_FILE} not found. The intake step has not been done.`);
    process.exit(1);
  }
  const result = validateConfig(JSON.parse(readFileSync(CONFIG_FILE, "utf8")));
  if (!result.ok) {
    bad(`${CONFIG_FILE} is invalid:`);
    result.errors.forEach((e) => info(e));
    process.exit(1);
  }
  if (result.assumed.length) warn(`assumed from the ${result.config.profile} profile: ${result.assumed.join(", ")}. Tell the human.`);
  return result.config;
}
