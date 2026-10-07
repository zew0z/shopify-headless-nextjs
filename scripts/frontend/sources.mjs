import { existsSync, readFileSync } from "node:fs";
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
const SDK_IMPORT = /lib\/shopify/;
const stripExt = (file) => file.replace(/\.[^/.]+$/, "").replace(/\/index$/, "");

export function importsFile(routeFile, spec, dataFile) {
  const target = stripExt(dataFile);
  if (spec.startsWith(".")) return stripExt(path.posix.join(path.posix.dirname(routeFile), spec)) === target;
  const rest = spec.replace(/^[@~]\//, "");
  return target === rest || target.endsWith(`/${stripExt(rest)}`);
}

/** True when the route file behind `/api/<x>` imports the SDK, so its answers come from Shopify. */
function routeUsesSdk(dir, target) {
  const route = target.replace(/^\/api\//, "").split(/[?#]/)[0].replace(/\/$/, "");
  if (!target.startsWith("/api/") || !route) return false;
  for (const root of ["src/app", "app"]) {
    for (const ext of ["ts", "tsx", "js", "jsx"]) {
      const file = `${root}/api/${route}/route.${ext}`;
      if (existsSync(path.join(dir, file))) return SDK_IMPORT.test(read(dir, file));
    }
  }
  return false;
}

/**
 * Calls to the frontend's own fake product API, and the API routes that serve the
 * hardcoded products. The cart and Shopify itself are not fake APIs, and neither is
 * a route that imports the SDK or a call to one.
 */
export function findFakeApis(dir, files, productData = findProductData(dir, files)) {
  const found = [];
  const dataFiles = [...new Set(productData.map((d) => d.file))];
  for (const file of files) {
    const source = read(dir, file);
    if (ROUTE_FILE.test(file) && SDK_IMPORT.test(source)) continue;
    source.split("\n").forEach((text, i) => {
      for (const [, , target] of text.matchAll(CALL)) {
        if (/\/api\/cart\b|myshopify\.com/.test(target) || routeUsesSdk(dir, target)) continue;
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

/** Every import of a hardcoded product file: the places the wiring has to change. */
export function findDataReaders(dir, files, productData) {
  const dataFiles = [...new Set(productData.map((d) => d.file))];
  const found = [];
  for (const file of files) {
    if (dataFiles.includes(file)) continue;
    read(dir, file).split("\n").forEach((text, i) => {
      const spec = /\bfrom\s+["']([^"']+)["']/.exec(text)?.[1];
      const target = spec && dataFiles.find((d) => importsFile(file, spec, d));
      if (target) found.push({ file, line: i + 1, target });
    });
  }
  return found;
}

const IMPORT_SPEC = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'])([^"']+)\1/g;

/** For each file, the files that import it. Every import on a line counts, not only the first. */
export function findImporters(dir, files) {
  const importers = new Map(files.map((f) => [f, []]));
  for (const file of files) {
    const specs = new Set();
    for (const text of read(dir, file).split("\n")) for (const m of text.matchAll(IMPORT_SPEC)) specs.add(m[2]);
    for (const target of files) {
      if (target !== file && [...specs].some((spec) => importsFile(file, spec, target))) importers.get(target).push(file);
    }
  }
  return importers;
}

export const TEST_FILE = /(^|\/)(__tests__|e2e[^/]*|tests?)\/|\.(test|spec)\.[jt]sx?$/;

const SITE_FOLDER = /(^|\/)(data|content|constants|config)\//;
const SITE_NAME = /site|nav|menu|footer|polic|pages|social|announce/i;
const EXPORTED_LITERAL = /^export\s+(?:const|let|var)\s+(\w+)[^=\n]*=\s*[[{]|^export\s+default\s+[[{]/;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const KEY = /(?:^|[\s{,])["']?(\w+)["']?\s*:/gm;
const CLAIM_NAME = /site|announce|shipping|contact|social/i;

/** The first exported array or object literal of a source file: its line and the names it is exported under. */
function exportedLiteral(file, text) {
  if (file.endsWith(".json")) {
    try {
      const data = JSON.parse(text);
      return data && typeof data === "object" ? { line: 1, names: Array.isArray(data) ? [] : Object.keys(data) } : null;
    } catch {
      return null;
    }
  }
  const names = [];
  let line = 0;
  text.split("\n").forEach((l, i) => {
    const m = EXPORTED_LITERAL.exec(l);
    if (!m) return;
    line ||= i + 1;
    if (m[1]) names.push(m[1]);
  });
  return line ? { line, names } : null;
}

/**
 * Hardcoded store content that is not products: menus, policy and page text, store
 * claims. A file counts when it sits where content lives (or is named like it) and
 * exports an array or object literal; components that only render links do not.
 */
export function findSiteData(dir, files, productData = findProductData(dir, files)) {
  const found = [];
  for (const file of files) {
    if (productData.some((d) => d.file === file) || TEST_FILE.test(file)) continue;
    if (!SITE_FOLDER.test(file) && !SITE_NAME.test(path.posix.basename(file))) continue;
    const text = read(dir, file);
    const exported = exportedLiteral(file, text);
    if (!exported) continue;
    const keys = [...text.matchAll(KEY)].map((m) => m[1]);
    const what = [];
    if (keys.some((k) => /^(href|url)$/i.test(k))) what.push("menu");
    if ([...text.matchAll(STRING_LITERAL)].some((m) => m[0].length >= 202)) what.push("policy or page text");
    if ([...exported.names, ...keys].some((n) => CLAIM_NAME.test(n))) what.push("store claim");
    found.push({ file, line: exported.line, what: what.length ? what.join(", ") : "store content" });
  }
  return found;
}

const INVENTED_FIELD = /(?<![?\w.]\s*)(?:^|[\s{,;(])["']?(rating|reviewCount|reviews|stockLeft|badge|subscribable)["']?\??\s*:/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

/** Fields a store does not give by default (ratings, stock counts...): object keys or type fields, each once per file. */
export function findInventedFields(dir, files) {
  const found = [];
  for (const file of files) {
    if (TEST_FILE.test(file) || !/\.[jt]sx?$/.test(file)) continue;
    const seen = new Set();
    read(dir, file).split("\n").forEach((text, i) => {
      if (COMMENT_LINE.test(text)) return;
      const m = INVENTED_FIELD.exec(text);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        found.push({ file, line: i + 1, what: m[1] });
      }
    });
  }
  return found;
}

const CARD_ATTRIBUTE = /\b(name|id|placeholder|autocomplete)\s*=\s*\{?\s*(["'`])([^"'`]*)\2/gi;
const CARD_WORDS = /cc-number|cc-csc|cc-exp|card ?number|cvc|cvv|expiry/i;

/** Inputs that ask for card details. Shopify's checkout takes payment, never this frontend. */
export function findPaymentForms(dir, files) {
  const found = [];
  for (const file of files) {
    if (TEST_FILE.test(file) || !/\.[jt]sx?$/.test(file)) continue;
    read(dir, file).split("\n").forEach((text, i) => {
      const m = [...text.matchAll(CARD_ATTRIBUTE)].find((a) => CARD_WORDS.test(a[3]));
      if (m) found.push({ file, line: i + 1, what: `${m[1]}="${m[3]}"` });
    });
  }
  return found;
}
