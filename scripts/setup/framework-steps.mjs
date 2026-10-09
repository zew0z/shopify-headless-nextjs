/** Keep the same completion gates while describing the actual frontend runtime. */
export function stepsForFramework(steps, framework) {
  if (framework !== "astro") return steps;
  const instructions = {
    "frontend-audit": "Run frontend-audit from the kit. Astro 7 needs server output and an SSR adapter. Report hardcoded products, shop claims, old Shopify clients, payment choices and browser/server boundaries. Do not migrate the frontend to Next. Follow docs/frontend-wiring-astro.md.",
    "kit-install": "Run kit-install --dry-run and review conflicts. The Astro installer preserves the existing SSR adapter, CSP, template modules and npm dependencies; it does not copy the Next-only connection skill. After installation run the printed package-manager command and test:shopify.",
    "frontend-catalogue": "Follow docs/frontend-wiring-astro.md. Connect the existing provider to createAstroCommerce, retaining .astro pages, localized links, variants, native Shopify filters and paged reads. Read profile/FAQ with createAstroContent. Public catalogue pages use finite Astro commerce cache rules; absent content stays hidden. Run npm run check and npm run build.",
    "frontend-cart": "Keep the template's progressive forms, validation and httpOnly cookie handler; connect its CommerceProvider to Shopify. Bare Astro sites may use createCartEndpoint and the browser-only cart client. Never cache carts, expose cart access keys, replay a failed mutation or build a card form. Checkout uses Shopify's hosted URL.",
    "frontend-check": "Run frontend-check, the site's Astro check/build and test:shopify, then inspect products/collections, variant changes, add/update/remove, cookie persistence and hosted checkout on a development store. npm ci must pass after the printed install command. Compiler and heuristic checks alone cannot mark this complete.",
    hosting: "Preserve the site's existing Astro SSR adapter and server. Build and test locally first. Hosting, push and deployment require separate owner authorization; do not install Next's standalone deployment files.",
    "analytics-check": "The Next analytics component is not installed into Astro. An Astro integration needs an explicit implementation task, consent verification and per-store dashboard proof. Do not mark analytics-check complete from catalogue/cart tests.",
  };
  return steps.map((step) => instructions[step.id] ? { ...step, instructions: instructions[step.id] } : step);
}
