/**
 * Content entries a source supplies (colour swatches, materials...): validated
 * against their definitions, then upserted by type and handle, published, so a
 * re-run updates and never duplicates. UNVERIFIED until run against a development store.
 */
import { adminGraphQL } from "../shopify/admin-client.mjs";
import { HANDLE_PATTERN } from "./format.mjs";

export function validateEntries(entries = [], definitions = []) {
  const problems = [];
  const defs = new Map(definitions.map((d) => [d.type, d]));
  const seen = new Set();
  for (const entry of entries) {
    const id = `${entry.type}/${entry.handle}`;
    if (seen.has(id)) {
      problems.push(`duplicate entry ${id}`);
      continue;
    }
    seen.add(id);
    if (!HANDLE_PATTERN.test(entry.handle ?? "")) {
      problems.push(`entry handle not url-safe: "${id}"`);
      continue;
    }
    const def = defs.get(entry.type);
    if (!def) {
      problems.push(`${id}: no definition for type "${entry.type}"`);
      continue;
    }
    const fields = entry.fields ?? {};
    for (const f of def.fieldDefinitions) if (f.required && (fields[f.key] ?? "") === "") problems.push(`${id}: missing required field ${f.key}`);
    const known = new Set(def.fieldDefinitions.map((f) => f.key));
    for (const key of Object.keys(fields)) if (!known.has(key)) problems.push(`${id}: field "${key}" is not in the ${entry.type} definition`);
  }
  return problems;
}

const UPSERT = `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id } userErrors { field message code } } }`;

/** Returns { "type/handle": id } for every entry, for product reference fields. */
export async function pushEntries(entries = [], { log = console.log } = {}) {
  const ids = {};
  for (const entry of entries) {
    const data = await adminGraphQL(UPSERT, {
      handle: { type: entry.type, handle: entry.handle },
      metaobject: {
        fields: Object.entries(entry.fields ?? {}).map(([key, value]) => ({ key, value: String(value) })),
        capabilities: { publishable: { status: "ACTIVE" } },
      },
    });
    ids[`${entry.type}/${entry.handle}`] = data.metaobjectUpsert.metaobject.id;
  }
  if (entries.length) log(`  = ${entries.length} content entries upserted`);
  return ids;
}
