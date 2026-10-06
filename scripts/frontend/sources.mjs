import { readFileSync } from "node:fs";
import path from "node:path";

const PRICE_KEY = /(?:^|[\s{,])["']?(?:price|amount|cost)["']?\s*:/;
const NAME_KEY = /(?:^|[\s{,])["']?(?:title|name)["']?\s*:/;
const looksLikeProduct = (text) => PRICE_KEY.test(text) && NAME_KEY.test(text);
const lineAt = (text, index) => text.slice(0, index).split("\n").length;
const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");

/**
 * Array literals in JS/TS source with their direct child objects. Skips strings,
 * template literals and comments so brackets inside them do not count.
 */
function arrayLiterals(text) {
  const stack = [];
  const arrays = new Map();
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) === -1 ? text.length : text.indexOf("*/", i + 2) + 1;
    else if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === "[" || c === "{") stack.push({ c, pos: i });
    else if (c === "]" || c === "}") {
      const open = c === "]" ? "[" : "{";
      while (stack.length && stack.at(-1).c !== open) stack.pop();
      const start = stack.pop()?.pos;
      if (start === undefined) continue;
      if (c === "]") {
        const entry = arrays.get(start) ?? { start, objects: [] };
        arrays.set(start, { ...entry, end: i });
      } else if (stack.at(-1)?.c === "[") {
        const parent = stack.at(-1).pos;
        const entry = arrays.get(parent) ?? { start: parent, objects: [] };
        entry.objects.push(text.slice(start, i + 1));
        arrays.set(parent, entry);
      }
    }
  }
  return [...arrays.values()].filter((a) => a.end !== undefined);
}

function productArraysInSource(text) {
  const candidates = arrayLiterals(text)
    .filter((a) => a.objects.length >= 2 && a.objects.every(looksLikeProduct))
    .sort((a, b) => a.start - b.start);
  const outer = candidates.filter((a) => !candidates.some((b) => b !== a && b.start < a.start && a.end < b.end));
  return outer.map((a) => ({ line: lineAt(text, a.start), count: a.objects.length }));
}

function productArraysInJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const isProducts = (v) => Array.isArray(v) && v.length >= 2 && v.every((o) => o && typeof o === "object" && looksLikeProduct(JSON.stringify(o)));
  if (isProducts(data)) return [{ line: 1, count: data.length }];
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data)
    .filter(([, v]) => isProducts(v))
    .map(([key, v]) => ({ line: Math.max(1, lineAt(text, text.indexOf(`"${key}"`))), count: v.length }));
}

/** Hardcoded product lists: arrays of 2+ objects that each have a price and a title or name. */
export function findProductData(dir, files) {
  const found = [];
  for (const file of files) {
    const text = read(dir, file);
    const json = file.endsWith(".json");
    for (const hit of json ? productArraysInJson(text) : productArraysInSource(text)) {
      found.push({ file, line: hit.line, kind: json ? "json" : "array", count: hit.count });
    }
  }
  return found;
}

const CALL = /\b(?:fetch|axios\.(?:get|post|request))\(\s*(["'`])((?:(?!\1).)*)\1/g;
const MOCK_HOSTS = /fakestoreapi\.com|dummyjson\.com|mockapi\.io|jsonplaceholder\.typicode\.com|my-json-server\.typicode\.com/;
const PRODUCTISH = /product|item|catalog|collection|shop/i;
const ROUTE_FILE = /^(src\/)?app\/api\/.+\/route\.[jt]sx?$/;
const stripExt = (file) => file.replace(/\.[^/.]+$/, "").replace(/\/index$/, "");

export function importsFile(routeFile, spec, dataFile) {
  const target = stripExt(dataFile);
  if (spec.startsWith(".")) return stripExt(path.posix.join(path.posix.dirname(routeFile), spec)) === target;
  const rest = spec.replace(/^[@~]\//, "");
  return target === rest || target.endsWith(`/${stripExt(rest)}`);
}

/**
 * Calls to the frontend's own fake product API, and the API routes that serve the
 * hardcoded products. The cart and Shopify itself are not fake APIs.
 */
export function findFakeApis(dir, files, productData = findProductData(dir, files)) {
  const found = [];
  const dataFiles = [...new Set(productData.map((d) => d.file))];
  for (const file of files) {
    const lines = read(dir, file).split("\n");
    lines.forEach((text, i) => {
      for (const [, , target] of text.matchAll(CALL)) {
        if (/\/api\/cart\b|myshopify\.com/.test(target)) continue;
        if (MOCK_HOSTS.test(target) || PRODUCTISH.test(target)) found.push({ file, line: i + 1, kind: "fetch", target });
      }
      if (!ROUTE_FILE.test(file)) return;
      const spec = /\bfrom\s+["']([^"']+)["']/.exec(text)?.[1];
      const data = spec && dataFiles.find((d) => importsFile(file, spec, d));
      if (data) found.push({ file, line: i + 1, kind: "route", target: data });
    });
  }
  return found;
}
