import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { validateEntries, pushEntries } from "./metaobjects.mjs";

const swatch = { type: "color_swatch", name: "Colour", displayNameKey: "label", fieldDefinitions: [{ key: "label", name: "Label", type: "single_line_text_field", required: true }, { key: "hex", name: "Hex", type: "single_line_text_field" }] };

test("entries must use a defined type, known fields, required fields and unique handles", () => {
  const problems = validateEntries(
    [
      { type: "color_swatch", handle: "grey", fields: { label: "Grey", hex: "#888" } },
      { type: "color_swatch", handle: "grey", fields: { label: "Grey again" } },
      { type: "color_swatch", handle: "Blue!", fields: { label: "Blue" } },
      { type: "color_swatch", handle: "red", fields: { hex: "#f00", shade: "dark" } },
      { type: "material", handle: "oak", fields: { label: "Oak" } },
    ],
    [swatch]
  );
  assert.deepEqual(problems, [
    "duplicate entry color_swatch/grey",
    'entry handle not url-safe: "color_swatch/Blue!"',
    "color_swatch/red: missing required field label",
    'color_swatch/red: field "shade" is not in the color_swatch definition',
    'material/oak: no definition for type "material"',
  ]);
});

afterEach(() => {
  mock.restoreAll();
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
});

test("entries are upserted by handle, published, with every value sent as a string", async () => {
  process.env.SHOPIFY_STORE_DOMAIN = "entries-test";
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_entriestest";
  const sent = [];
  mock.method(globalThis, "fetch", async (_url, init) => {
    const { variables } = JSON.parse(init.body);
    sent.push(variables);
    return new Response(JSON.stringify({ data: { metaobjectUpsert: { metaobject: { id: `gid://mo-entry/${variables.handle.handle}` }, userErrors: [] } } }), { status: 200 });
  });
  const ids = await pushEntries([{ type: "color_swatch", handle: "grey", fields: { label: "Grey", sort: 2 } }], { log: () => {} });
  assert.deepEqual(ids, { "color_swatch/grey": "gid://mo-entry/grey" });
  assert.deepEqual(sent[0], {
    handle: { type: "color_swatch", handle: "grey" },
    metaobject: { fields: [{ key: "label", value: "Grey" }, { key: "sort", value: "2" }], capabilities: { publishable: { status: "ACTIVE" } } },
  });
});
