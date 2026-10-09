/**
 * Content definitions: the metaobject types (hero slides, reviews, a source's
 * swatches or materials) and the product metafield definitions the storefront
 * reads. The Storefront API returns null for a metafield whose definition has
 * no storefront access, so every metafield the catalogue sets gets one here.
 * Idempotent: keyed on type and namespace.key; never changes a field's type.
 * UNVERIFIED until run against a development store.
 */
import { adminGraphQL } from "../shopify/admin-client.mjs";

const PUBLIC = { storefront: "PUBLIC_READ" };
const TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
const KIT_TYPES = new Set(["hero_slide", "customer_review"]);

/** The kit's own types. The owner fills them in under Content > Metaobjects. */
export function kitDefinitions({ wantsReviews = false } = {}) {
  const metaobjects = [
    {
      type: "hero_slide",
      name: "Hero slide",
      displayNameKey: "title",
      fieldDefinitions: [
        { key: "title", name: "Title (blank: the product's name)", type: "single_line_text_field" },
        { key: "subtitle", name: "Subtitle", type: "multi_line_text_field" },
        { key: "image", name: "Image (blank: the product's photo)", type: "file_reference" },
        { key: "product", name: "Product", type: "product_reference" },
        { key: "link", name: "Link, a path like /collections/sofas", type: "single_line_text_field" },
        { key: "rank", name: "Order (1 shows first)", type: "number_integer" },
      ],
    },
  ];
  if (wantsReviews) {
    metaobjects.push({
      type: "customer_review",
      name: "Customer review",
      displayNameKey: "author",
      fieldDefinitions: [
        { key: "author", name: "Customer name", type: "single_line_text_field", required: true },
        { key: "rating", name: "Rating (1-5)", type: "number_integer", required: true, validations: [{ name: "min", value: "1" }, { name: "max", value: "5" }] },
        { key: "body", name: "Review", type: "multi_line_text_field", required: true },
        { key: "product", name: "Product", type: "product_reference" },
        { key: "location", name: "City", type: "single_line_text_field" },
        { key: "date", name: "Date", type: "date" },
      ],
    });
  }
  return { metaobjects, metafields: [] };
}

const humanise = (key) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isReference = (type) => /metaobject_reference$/.test(type ?? "");

/** Everything the catalogue needs defined: the kit's types, the source's own, and one field per metafield key used. */
export function wantedDefinitions(catalog, { wantsReviews = false } = {}) {
  const kit = kitDefinitions({ wantsReviews });
  const problems = [];
  const own = catalog.definitions?.metaobjects ?? [];
  for (const def of own) {
    if (KIT_TYPES.has(def.type)) problems.push(`${def.type} is a kit type; give the source's type another name`);
    else if (!TYPE_PATTERN.test(def.type ?? "")) problems.push(`metaobject type "${def.type}" must be lower_snake_case`);
    else if (!def.fieldDefinitions?.some((f) => f.key === def.displayNameKey)) problems.push(`${def.type}: displayNameKey "${def.displayNameKey}" is not one of its fields`);
  }
  const metaobjects = [...kit.metaobjects, ...own.filter((d) => !KIT_TYPES.has(d.type))];
  const types = new Set(metaobjects.map((d) => d.type));

  const fields = new Map();
  for (const def of [...kit.metafields, ...(catalog.definitions?.metafields ?? [])]) {
    fields.set(`${def.namespace}.${def.key}`, { ownerType: "PRODUCT", name: humanise(def.key), ...def });
  }
  for (const product of catalog.products ?? []) {
    for (const mf of product.metafields ?? []) {
      const id = `${mf.namespace}.${mf.key}`;
      const refType = isReference(mf.type) ? [...new Set((mf.refs ?? []).map((r) => r.split("/")[0]))] : [];
      if (refType.length > 1) problems.push(`${id} refers to several types (${refType.join(", ")}); one field holds one type`);
      const seen = fields.get(id);
      if (seen && seen.type !== mf.type) {
        problems.push(`${id} is set as ${seen.type} and as ${mf.type}; pick one`);
        continue;
      }
      if (!seen) {
        fields.set(id, { ownerType: "PRODUCT", namespace: mf.namespace, key: mf.key, name: humanise(mf.key), type: mf.type, ...(refType[0] && { refType: refType[0] }) });
      }
    }
  }
  for (const [id, def] of fields) {
    if (def.refType && !types.has(def.refType)) problems.push(`${id} refers to type "${def.refType}", which no definition declares`);
  }
  return { metaobjects, metafields: [...fields.values()], problems };
}

/** Pure: what to write, given what the store already has. */
export function planDefinitions(wanted, existing) {
  const problems = [];
  const haveTypes = new Map(existing.metaobjects.map((d) => [d.type, d]));
  const createTypes = [];
  const addFields = [];
  for (const def of wanted.metaobjects) {
    const have = haveTypes.get(def.type);
    if (!have) {
      createTypes.push(def);
      continue;
    }
    const haveFields = new Map(have.fieldDefinitions.map((f) => [f.key, f.type.name]));
    const missing = def.fieldDefinitions.filter((f) => !haveFields.has(f.key));
    for (const f of def.fieldDefinitions) {
      if (haveFields.has(f.key) && haveFields.get(f.key) !== f.type) problems.push(`${def.type}.${f.key} is ${haveFields.get(f.key)} in Shopify, the kit wants ${f.type}`);
    }
    if (missing.length) addFields.push({ id: have.id, type: def.type, fields: missing });
  }

  const haveFields = new Map(existing.metafields.map((d) => [`${d.ownerType}:${d.namespace}.${d.key}`, d]));
  const createFields = [];
  const openAccess = [];
  for (const def of wanted.metafields) {
    const have = haveFields.get(`${def.ownerType}:${def.namespace}.${def.key}`);
    if (!have) createFields.push(def);
    else if (have.type.name !== def.type) problems.push(`${def.namespace}.${def.key} is ${have.type.name} in Shopify, the catalogue wants ${def.type}`);
    else if (have.access?.storefront !== "PUBLIC_READ") openAccess.push(def);
  }
  return { createTypes, addFields, createFields, openAccess, problems };
}

const TYPES = `query { metaobjectDefinitions(first: 250) { nodes { id type fieldDefinitions { key type { name } } } } }`;
const FIELDS = `query($owner: MetafieldOwnerType!) { metafieldDefinitions(first: 250, ownerType: $owner) { nodes { id namespace key ownerType type { name } access { storefront } } } }`;
const CREATE_TYPE = `mutation($definition: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } userErrors { field message code } } }`;
const UPDATE_TYPE = `mutation($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) { metaobjectDefinitionUpdate(id: $id, definition: $definition) { metaobjectDefinition { id } userErrors { field message code } } }`;
const CREATE_FIELD = `mutation($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } } }`;
const UPDATE_FIELD = `mutation($definition: MetafieldDefinitionUpdateInput!) { metafieldDefinitionUpdate(definition: $definition) { updatedDefinition { id } userErrors { field message code } } }`;

async function readExisting() {
  const metaobjects = (await adminGraphQL(TYPES)).metaobjectDefinitions.nodes;
  const metafields = (await adminGraphQL(FIELDS, { owner: "PRODUCT" })).metafieldDefinitions.nodes;
  return { metaobjects, metafields };
}

/** Reads the store, writes only the difference, and returns each type's id for reference fields and entries. */
export async function pushDefinitions(wanted, { log = console.log } = {}) {
  const plan = planDefinitions(wanted, await readExisting());
  const known = new Set(wanted.metaobjects.map((d) => d.type));
  for (const def of wanted.metafields) {
    if (def.refType && !known.has(def.refType)) plan.problems.push(`${def.namespace}.${def.key}: no metaobject definition "${def.refType}"`);
  }
  if (plan.problems.length) throw new Error(`definitions not written:\n  ${plan.problems.join("\n  ")}`);

  for (const def of plan.createTypes) {
    await adminGraphQL(CREATE_TYPE, { definition: { ...def, access: PUBLIC, capabilities: { publishable: { enabled: true } } } });
    log(`  + type ${def.type}`);
  }
  for (const { id, type, fields } of plan.addFields) {
    await adminGraphQL(UPDATE_TYPE, { id, definition: { fieldDefinitions: fields.map((f) => ({ create: f })) } });
    log(`  ~ type ${type}: added ${fields.map((f) => f.key).join(", ")}`);
  }
  const typeIds = Object.fromEntries((await adminGraphQL(TYPES)).metaobjectDefinitions.nodes.map((d) => [d.type, d.id]));

  for (const { refType, ...def } of plan.createFields) {
    const validations = refType ? [{ name: "metaobject_definition_id", value: typeIds[refType] }] : [];
    await adminGraphQL(CREATE_FIELD, { definition: { ...def, validations, access: PUBLIC } });
    log(`  + field ${def.namespace}.${def.key} (${def.type})`);
  }
  for (const def of plan.openAccess) {
    await adminGraphQL(UPDATE_FIELD, { definition: { namespace: def.namespace, key: def.key, ownerType: def.ownerType, access: PUBLIC } });
    log(`  ~ field ${def.namespace}.${def.key}: storefront can read it now`);
  }
  const untouched = wanted.metaobjects.length + wanted.metafields.length - plan.createTypes.length - plan.createFields.length - plan.openAccess.length;
  log(`  = ${untouched} definition(s) already right`);
  return { typeIds };
}
