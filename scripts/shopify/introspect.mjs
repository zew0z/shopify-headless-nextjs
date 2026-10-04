// Shopify's input shapes drift between API versions and docs lag behind.
// Print the live schema before writing or changing a mutation:
//   node scripts/shopify/introspect.mjs DeliveryMethodDefinitionInput
import { adminGraphQL, adminConfig, resolveAdminToken } from "./admin-client.mjs";
import { mask } from "./env.mjs";

const typeName = process.argv[2];
if (!typeName) {
  console.error("usage: node scripts/shopify/introspect.mjs <InputTypeName>");
  process.exit(1);
}
const data = await adminGraphQL(
  `query($name: String!) {
    __type(name: $name) {
      name kind
      inputFields { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } }
    }
  }`,
  { name: typeName },
);
const type = data.__type;
if (!type) {
  console.error(`No such type: ${typeName}`);
  process.exit(1);
}
const render = (node) => {
  if (!node) return "";
  if (node.kind === "NON_NULL") return `${render(node.ofType)}!`;
  if (node.kind === "LIST") return `[${render(node.ofType)}]`;
  return node.name || node.kind;
};
const cfg = adminConfig();
const { token, source } = await resolveAdminToken();
console.log(`${type.name} (${type.kind})  api ${cfg.apiVersion}  token ${mask(token)} (${source})`);
for (const field of type.inputFields ?? []) console.log(`  ${field.name}: ${render(field.type)}`);
