/**
 * The setup plan, as data. Owner:
 *   api      the agent does it with an Admin API script
 *   browser  the agent clicks it in the Shopify admin while the human is logged in
 *   human    only a person can: identity, money, legal sign-off, a real card
 * `automation` names the `pnpm shop-setup <command>` that does it, when one exists.
 */
const FALLBACK = "If the browser is unavailable, give the human these exact clicks instead.";

export const STEPS = [
  {
    id: "intake",
    title: "Answer the store questionnaire",
    owner: "human",
    needs: [],
    instructions:
      "Ask the business decisions once, as concrete choices, and write the answers to store-setup.config.json (see store-setup.config.example.json): tax-inclusive prices, stock tracking, shipping rates and free-shipping threshold, whether compare-at prices are real, reviews, invoicing. Do not ask anything in this file again later.",
    verify: "pnpm shop-setup preflight --config-only",
  },
  {
    id: "store-basics",
    title: "Confirm store country, currency and contact email",
    owner: "human",
    needs: [],
    instructions:
      "Shopify admin > Settings > General. Confirm country, currency and contact email. Currency cannot change after the first order.",
  },
  {
    id: "tax-inclusive",
    title: 'Set "All prices include tax" to match the catalogue',
    owner: "browser",
    needs: ["intake", "store-basics"],
    instructions: `Shopify admin > Settings > Taxes and duties > the store country > set whether prices include tax to match pricesIncludeTax in store-setup.config.json. Read back with the Admin API field shop.taxesIncluded. ${FALLBACK}`,
    verify: "shop { taxesIncluded } equals config.pricesIncludeTax",
  },
  {
    id: "headless-channel",
    title: "Add the Headless sales channel and create a storefront",
    owner: "browser",
    needs: ["store-basics"],
    instructions: `Admin sidebar > Sales channels > + > Headless > Create storefront. Read the PUBLIC Storefront token off the page into .env.local (NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN). A token starting shpat_ is an Admin token and is wrong here. ${FALLBACK}`,
    verify: "pnpm shop-setup preflight",
  },
  {
    id: "dev-app",
    title: "Create the Dev Dashboard app with the Admin scopes",
    owner: "browser",
    needs: ["store-basics"],
    instructions: `Settings > Apps and sales channels > Develop apps > Build apps in Dev Dashboard. Scopes: write_shipping, read_locations, write_legal_policies (plus catalogue scopes when pushing products). Redirect URL exactly http://localhost:3456/callback. Release a new app version, then read Client ID and Client secret into .env.local (SHOPIFY_APP_CLIENT_ID, SHOPIFY_APP_CLIENT_SECRET). ${FALLBACK}`,
  },
  {
    id: "oauth",
    title: "Click Install on the app once",
    owner: "human",
    needs: ["dev-app"],
    instructions:
      "The agent prints an install URL; the person opens it and clicks Install. That mints the Admin token into .env.local. (The OAuth helper is ported in a follow-on plan; until then, mint the token through the Dev Dashboard install flow and paste it into .env.local as SHOPIFY_ADMIN_TOKEN.)",
  },
  {
    id: "preflight",
    title: "Check the Admin token has the scopes the steps need",
    owner: "api",
    needs: ["oauth"],
    instructions: "Run pnpm shop-setup preflight. If scopes are missing, a new app version was not released before install.",
    automation: "preflight",
  },
  {
    id: "shipping",
    title: "Create shipping zones and rates, including the free-shipping rule",
    owner: "api",
    needs: ["preflight", "intake"],
    instructions: "Run pnpm shop-setup shipping --dry-run, show the plan, then pnpm shop-setup shipping. Refuses if the zone would collide with an existing one.",
    automation: "shipping",
  },
  {
    id: "policies-draft",
    title: "Draft refund, privacy, terms and shipping policies",
    owner: "api",
    needs: ["preflight", "intake"],
    instructions: "Follow-on plan. Until then draft the four policies from the config and hand them to policies-approve.",
  },
  {
    id: "policies-approve",
    title: "Read and approve the legal policies",
    owner: "human",
    needs: ["policies-draft"],
    instructions: "A person must read the drafted policies before they go live; they are legally binding. Then publish via the API or Settings > Policies.",
  },
  {
    id: "checkout-domain",
    title: "Connect checkout.<domain> to Shopify and make it the primary domain",
    owner: "human",
    needs: ["intake", "store-basics"],
    instructions:
      "Shopify admin > Settings > Domains > Connect existing domain > enter checkout.<siteDomain> (siteDomain and checkoutSubdomain are in store-setup.config.json), then make it primary. At the DNS provider add a CNAME for the checkout subdomain to the target Shopify shows (normally shops.myshopify.com). Do NOT connect the main domain to Shopify: it stays on the frontend host. No API exists for this. Wait for Shopify to show the SSL as active.",
  },
  {
    id: "e2e",
    title: "Run the browser tests against the live site and Shopify",
    owner: "api",
    needs: ["checkout-domain", "headless-channel", "theme-redirect"],
    instructions:
      "Run pnpm test:e2e with E2E_SITE_URL set to the deployed frontend. It proves the Shopify theme URL redirects to the frontend, a cart created through /api/cart hands customers to checkout.<siteDomain>, and the pages load clean at 375px. A skipped test is NOT a pass: say which were skipped and why.",
    automation: "e2e",
  },
  {
    id: "theme-redirect",
    title: "Redirect the default Shopify theme to the frontend",
    owner: "browser",
    needs: ["checkout-domain"],
    instructions: `Paste the generated redirect snippet into layout/theme.liquid of the live theme (Online Store > Themes > the live theme > ... > Edit code), or push it with the Shopify CLI. The theme-files API needs a Shopify exemption, so it is not used. The snippet must NOT redirect the theme editor or preview, customer account pages, or anything Shopify serves itself such as checkout. ${FALLBACK}`,
  },
  {
    id: "email-templates-generate",
    title: "Generate branded customer email templates",
    owner: "api",
    needs: ["intake"],
    instructions:
      "Follow-on plan. Build Liquid for the order confirmation, shipping confirmation and refund emails from the frontend's brand (logo, colours, fonts in src/app/globals.css) and write them under email-templates/. Shopify has no API for these.",
  },
  {
    id: "email-templates-install",
    title: "Install the email templates in Shopify",
    owner: "browser",
    needs: ["email-templates-generate", "store-basics"],
    instructions: `Settings > Notifications > Customer notifications > open each template > Edit code > paste the matching file from email-templates/ > Save > Send test email. ${FALLBACK}`,
  },
  {
    id: "email-sender",
    title: "Authenticate the sender domain so emails do not land in spam",
    owner: "human",
    needs: ["store-basics"],
    instructions:
      "Settings > Notifications > Sender email > Authenticate domain, then add the DNS records Shopify lists (DKIM and SPF) at the DNS provider. Only the person with DNS access can do this.",
  },
  {
    id: "payments",
    title: "Activate payments",
    owner: "human",
    needs: ["store-basics"],
    instructions: "Settings > Payments. Needs identity, bank details and tax number; only the owner can do this. The agent never enters these.",
  },
  {
    id: "invoicing",
    title: "Install the invoicing app and connect it to the tax authority",
    owner: "human",
    needs: ["intake", "store-basics"],
    instructions: "Install a myDATA app (for example myData Comply) from the Shopify App Store, then enter the tax number (AFM) and the AADE credentials inside the app. The agent does not touch credentials. Skipped when config.invoicing is none.",
  },
  {
    id: "webhooks",
    title: "Register cache-invalidation webhooks",
    owner: "api",
    needs: ["preflight"],
    instructions: "Follow-on plan. Needs a public https SITE_URL after the first deploy. Webhooks created by an app are signed with the app client secret, not the Notifications-page secret.",
  },
  {
    id: "test-order",
    title: "Place a real order end to end and refund it",
    owner: "human",
    needs: ["tax-inclusive", "shipping", "payments", "invoicing", "e2e", "theme-redirect", "email-templates-install", "email-sender"],
    instructions: "Buy a real product with a real card. Check: checkout opens on checkout.<domain>, price at checkout equals the shelf price, shipping matches the rule, an invoice was issued, the order confirmation email arrives in the inbox (not spam) in the new design, and the default Shopify theme URL redirects to the frontend. Then refund it. Nothing else proves payments, tax, shipping and invoicing together.",
  },
  {
    id: "rotate-secrets",
    title: "Rotate every credential that was pasted into a chat",
    owner: "human",
    needs: ["test-order"],
    instructions: "Rotate the Storefront private token, the app client secret and any automation token, and remove the Admin token from any deployed environment.",
  },
];
