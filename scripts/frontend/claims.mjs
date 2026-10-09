import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TEST_FILE } from "./sources.mjs";

const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");
const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const ROOT_LAYOUT = /^(src\/)?app\/layout\.[jt]sx?$/;
const HOME_PAGE = /^(src\/)?app\/page\.[jt]sx?$/;
const PAGE_OR_COMPONENT = /^(src\/)?(app|components)\//;

/** Words that make a promise about the shop. Each is the owner's to make, in Shopify, not the frontend's. */
const CLAIMS = [
  /\bfree (shipping|delivery|returns?|exchanges?)\b/i,
  /\b(returns?|refunds?|exchanges?|warranty|guarantee)\b.*\b\d+[- ]?(days?|weeks?|months?|years?)\b/i,
  /\b\d+[- ]?(days?|weeks?|months?|years?)\b.*\b(returns?|refunds?|exchanges?|warranty|guarantee)\b/i,
  /\b(taxes|tax|vat)\s+(included|incl\.?|inclusive)\b|\bincl\.?\s+(vat|tax)\b/i,
  /\b([Hh]and)?[Mm]ade in [A-Z]/,
  /\b\d(\.\d)?\s*(\/\s*5\s*)?(stars?|★)|★{3,}/i,
  /\b\d[\d,.]*\+?\s+(reviews|ratings|happy customers|customers)\b/i,
  /\bnewsletter\b/i,
  /©\s*(\d{4}|[A-Za-z])/,
  /\b(since|est\.?|established)\s+\d{4}\b/i,
  /\bmoney[- ]back\b|\b(secure|safe) (checkout|payments?)\b/i,
  /\b(ships?|dispatched|delivered) (in|within|every) \d/i,
  /\bevery \d+ (days?|weeks?|months?)\b|\bcancel any ?time\b/i,
  // Greek letters are not ASCII word characters, so these use no \b.
  /δωρε[άα]ν\s+(μεταφορ|αποστολ|παράδοσ|παραδοσ|επιστροφ)/iu,
  /(συμπεριλαμβ\S*|συμπ\.?|με)\s+(το\s+)?(φπα|φ\.π\.α\.?)/iu,
  /(φπα|φ\.π\.α\.?)\s*\d+\s*%/iu,
  /(από|απο)\s+το\s+(19|20)\d{2}/iu,
  /επιστροφ\S*\s+(εντός|μέσα\s+σε)\s+\d+/iu,
  /εγγύηση\s+\d+/iu,
];
const STOCK_PHOTO = /\b(images\.unsplash\.com|source\.unsplash\.com|plus\.unsplash\.com|images\.pexels\.com|picsum\.photos|placehold\.co|placehold\.it|via\.placeholder\.com|placekitten\.com|loremflickr\.com|i\.pravatar\.cc|randomuser\.me|dummyimage\.com|fakeimg\.pl)\b/;
// String values of these attributes are code, not words a shopper reads.
const CODE_ATTRIBUTE = /\b(className|class|id|htmlFor|key|href|src|type|rel|target|role|name|style|as|variant|size|color|method|action|data-[\w-]+)\s*=\s*\{?\s*$/;
const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

const LEGAL_ROUTE = /^(src\/)?app\/(?:.+\/)?(privacy|terms|shipping|delivery|returns?|refunds?|legal|cookies?|polic\w*|oroi|aporrito)[^/]*\/(?:.+\/)?page\.[jt]sx$/i;
const READS_SHOPIFY_TEXT = /\b(getPolicy|getPolicies|getPage)\s*\(/;
const LEGAL_MIN_CHARS = 1500;
const SHOP_DETAIL_KEYS = /^(address|street|phone|phones|mobile|tel|email|hours|openingHours|opening_hours|iban|beneficiary|coords|mapsUrl|mapUrl|foundedYear|vatNumber|afm)$/;
const EXPORTED_OBJECT = /^export\s+(?:const|let|var)\s+\w+[^=\n]*=\s*\{/;
// A key holding a literal (a string, number, list or object). `phone: string` in a type is not one.
const LITERAL_KEY = /(?:^|[\s{,])["']?(\w+)["']?\s*:\s*(?=-?\d|["'`[{])/gm;

const stripExpressions = (line) => {
  let text = line;
  for (let prev; prev !== text; ) {
    prev = text;
    text = text.replace(/\{[^{}]*\}/g, " ");
  }
  return text;
};

const clean = (text) => text.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
// Text outside the tags on a line is shown only when it has no code in it ("Lumen <span>&</span> Loom" is all text).
const outside = (text) => (/[=();:{}<>]/.test(text) ? "" : text);

/**
 * Words a shopper reads on a JSX line: the text between tags, plus text before the first or after the last
 * tag when it is not code, with {expressions} removed. A line with no tags counts only when it is plain words.
 */
export function visibleText(line) {
  if (COMMENT.test(line) || /^\s*(import|export\s+\*|export\s+\{)/.test(line)) return "";
  const text = stripExpressions(line);
  if (!/[<>]/.test(text)) return /[=();:{}]/.test(text) || /^\s*[a-z_$][\w$]*,?\s*$/.test(text) ? "" : clean(text);
  const first = text.indexOf("<");
  const last = text.lastIndexOf(">");
  const pieces = [];
  if (first > 0) pieces.push(outside(text.slice(0, first)));
  for (const m of text.matchAll(/>([^<>]*)</g)) pieces.push(m[1]);
  if (last >= 0 && last < text.length - 1) pieces.push(outside(text.slice(last + 1)));
  return clean(pieces.join(" "));
}

/** String literals a shopper may read (alt text, placeholders, props), minus code attributes and imports. */
function readableStrings(line) {
  if (COMMENT.test(line) || /^\s*(import|export\s+\*|export\s+\{)|^\s*["']use (client|server)["']/.test(line)) return [];
  const out = [];
  for (const m of line.matchAll(STRING)) {
    if (CODE_ATTRIBUTE.test(line.slice(0, m.index))) continue;
    const inner = m[0].slice(1, -1).replace(/\$\{[^{}]*\}/g, " ").trim();
    if (inner) out.push(inner);
  }
  return out;
}

const shorten = (text) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

/** The shop's name as the received frontend typed it: a literal title in the root layout, or `name` in its site data. */
export function findBrand(dir, files) {
  for (const file of files.filter((f) => ROOT_LAYOUT.test(f))) {
    const lines = read(dir, file).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /\b(?:title|default)\s*:\s*(["'`])([^"'`$]+)\1/.exec(lines[i]);
      const name = m?.[2].replace(/%s/g, "").split(/\s+[|·•—–-]\s+/).map((s) => s.trim()).find((s) => s.length >= 3);
      if (name) return { name, file, line: i + 1 };
    }
  }
  const siteFiles = files.filter((f) => /(^|\/)(site|site-?config|config)\.[jt]sx?$/i.test(f) || /(^|\/)(data|content|constants|config)\/site/i.test(f));
  for (const file of siteFiles) {
    const lines = read(dir, file).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*(?:name|siteName|storeName|shopName|brand)\s*:\s*(["'`])([^"'`$]{3,})\1/.exec(lines[i]);
      if (m) return { name: m[2].trim(), file, line: i + 1 };
    }
  }
  return null;
}

/** The lines of the object literal opening on line `start`, until its braces close, as [lineIndex, text]. */
function objectLines(lines, start) {
  const out = [];
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    out.push([i, lines[i]]);
    depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
    if (depth <= 0 && (i > start || lines[i].includes("{"))) break;
  }
  return out;
}

/** Lines of the root layout's `export const metadata = {...}` object, as [lineIndex, text]. */
function metadataLines(lines) {
  const start = lines.findIndex((l) => /export\s+const\s+metadata\b/.test(l));
  return start === -1 ? [] : objectLines(lines, start);
}

/** A page under a legal-sounding route with long typed text and no Shopify read: the policy belongs in Shopify. */
function legalPages(dir, files, add) {
  for (const file of files.filter((f) => LEGAL_ROUTE.test(f))) {
    const text = read(dir, file);
    if (READS_SHOPIFY_TEXT.test(text)) continue;
    const chars = text.split("\n").map(visibleText).join(" ").length;
    if (chars >= LEGAL_MIN_CHARS) add(file, 1, "legal page", `${chars} characters of typed text`);
  }
}

/**
 * A module exporting objects that hold two or more shop details (address, phone, IBAN...) as literals,
 * when something imports it. Without `importers`, every such module counts.
 */
function shopDetailModules(dir, files, importers, add) {
  for (const file of files.filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !TEST_FILE.test(f))) {
    if (importers && !(importers.get(file)?.length > 0)) continue;
    const lines = read(dir, file).split("\n");
    const keys = new Set();
    let first = -1;
    lines.forEach((line, i) => {
      if (!EXPORTED_OBJECT.test(line)) return;
      const body = objectLines(lines, i).map(([, text]) => text).join("\n");
      const found = [...body.matchAll(LITERAL_KEY)].map((m) => m[1]).filter((k) => SHOP_DETAIL_KEYS.test(k));
      if (found.length && first < 0) first = i;
      for (const k of found) keys.add(k);
    });
    if (keys.size >= 2) add(file, first + 1, "shop details", [...keys].join(", "));
  }
}

/**
 * Words and pictures typed into pages and components that should come from Shopify:
 * store claims, the shop's name, the root layout's metadata, the home headline, stock photos,
 * legal pages with typed text, and imported modules of shop details. `skip` lists files already
 * reported elsewhere; `importers` (from findImporters) limits shop details to modules something uses.
 */
export function findTypedClaims(dir, files, { skip = [], importers } = {}) {
  const brand = findBrand(dir, files);
  const kept = files.filter((f) => !skip.includes(f));
  const scanned = kept.filter((f) => !TEST_FILE.test(f) && (/\.[jt]sx$/.test(f) || (PAGE_OR_COMPONENT.test(f) && /\.[cm]?[jt]s$/.test(f))));
  const found = [];
  const seen = new Set();
  const add = (file, line, kind, what) => {
    const key = `${file}:${line}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ file, line, kind, what: shorten(what) });
  };

  const config = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"].find((f) => existsSync(path.join(dir, f)));
  if (config) read(dir, config).split("\n").forEach((text, i) => {
    const m = !COMMENT.test(text) && STOCK_PHOTO.exec(text);
    if (m) add(config, i + 1, "stock photo", m[1]);
  });

  for (const file of scanned) {
    const lines = read(dir, file).split("\n");
    const jsx = /\.[jt]sx$/.test(file);
    if (ROOT_LAYOUT.test(file)) {
      for (const [i, text] of metadataLines(lines)) {
        const m = /^\s*(title|default|description)\s*:\s*(["'`])([^"'`]*)\2/.exec(text);
        if (m && !m[3].includes("${") && m[3].trim()) add(file, i + 1, "metadata", `${m[1]}: ${m[3]}`);
      }
    }
    lines.forEach((line, i) => {
      if (COMMENT.test(line)) return;
      const photo = STOCK_PHOTO.exec(line);
      if (photo) add(file, i + 1, "stock photo", photo[1]);
      const texts = [...(jsx ? [visibleText(line)] : []), ...readableStrings(line)].filter(Boolean);
      for (const text of texts) {
        if (CLAIMS.some((c) => c.test(text))) add(file, i + 1, "claim", text);
        if (brand && file !== brand.file && text.includes(brand.name)) add(file, i + 1, "shop name", brand.name);
      }
      if (HOME_PAGE.test(file)) {
        for (const m of stripExpressions(line).matchAll(/<h1\b[^>]*>([^<]*)/g)) {
          const words = m[1].trim().split(/\s+/).filter(Boolean);
          if (words.length >= 2) add(file, i + 1, "headline", words.join(" "));
        }
      }
    });
  }
  legalPages(dir, kept, add);
  shopDetailModules(dir, kept, importers, add);
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
