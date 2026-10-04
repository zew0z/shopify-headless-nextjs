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
    id: "legal-details",
    title: "Collect the legal business details",
    owner: "human",
    needs: ["store-basics"],
    instructions:
      "Get from the owner or their accountant: registered company name, tax number (AFM), GEMI number, registered address, phone and email. They go in the frontend footer and into the invoicing app. The agent never guesses or invents any of them; ask the accountant to confirm the wording.",
  },
  {
    id: "customer-accounts",
    title: "Decide: guest checkout only, or customer accounts",
    owner: "human",
    needs: ["intake"],
    instructions:
      "Ask once. Guest checkout works with no login, and customer login is optional in the Customer Account API (shopify.dev/docs/api/customer). Recommend guest checkout for launch. Record the answer with: pnpm shop-setup done customer-accounts \"guest\" (or \"accounts\"). Building login is a separate plan.",
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
    id: "eu-vat",
    title: "Check EU VAT if shipping outside Greece",
    owner: "human",
    needs: ["tax-inclusive"],
    instructions:
      "If shippingCountries in the config has more than Greece, ask the accountant about EU VAT and One Stop Shop registration, then check Shopify's tax settings for each destination. If Greece only: pnpm shop-setup done eu-vat \"n/a: Greece only\". The agent has not verified these rules.",
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
    id: "hosting",
    title: "Deploy the frontend and point the main domain at it",
    owner: "human",
    needs: ["headless-channel"],
    instructions:
      "Deploy the frontend to its host, point the main domain's DNS at it, set the PUBLIC env vars there (never the Admin token), and set up an uptime check. Only the owner has the hosting and DNS accounts. Give the agent the live URL: it becomes SITE_URL and E2E_SITE_URL.",
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
    id: "catalogue",
    title: "Get the products into Shopify and published to the Headless channel",
    owner: "api",
    needs: ["preflight", "intake"],
    instructions:
      "Write a source module for this client (copy scripts/catalogue/sources/_template.mjs; read docs/catalogue-import.md first and report real counts to the owner before deciding variant grouping). Then: pnpm shop-setup catalogue-build, pnpm shop-setup catalogue --dry-run, pnpm shop-setup catalogue --limit=3 and look at them in the Admin, pnpm shop-setup catalogue, then pnpm shop-setup catalogue-verify. A re-run updates, never duplicates. Mark done only when catalogue-verify reports no problems.",
    automation: "catalogue",
  },
  {
    id: "inventory",
    title: "Apply the stock decision",
    owner: "api",
    needs: ["catalogue", "intake"],
    instructions:
      "The push applies config.tracksInventory to every variant. If tracked, the owner must supply real quantities in the source data. Run pnpm shop-setup inventory-check to read the flags back from Shopify. If not tracked, tell the owner out loud that nothing will ever show sold out.",
    automation: "inventory-check",
  },
  {
    id: "courier",
    title: "Connect a courier so orders get labels and tracking",
    owner: "human",
    needs: ["shipping"],
    instructions:
      "Choose the courier (for example ACS or Box Now, which have Shopify apps; the agent has not compared them). Install the courier's app from the Shopify App Store and connect the owner's courier account; the agent cannot enter courier credentials. Done when a test order can get a voucher or label and a tracking number that the shipping confirmation email shows. The Admin API can also create fulfillments with tracking (fulfillmentCreate), but the courier app normally does it.",
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
    needs: ["checkout-domain", "headless-channel", "theme-redirect", "hosting"],
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
    id: "staff-alerts",
    title: "Set who is told about new orders",
    owner: "browser",
    needs: ["store-basics"],
    instructions:
      `Settings > Notifications > Staff order notifications: add the people who must hear about every new order (use the admin search box for 'staff order notifications' if the menu moved). Add admin logins under Settings > Users only for people who need the admin. ${FALLBACK}`,
  },
  {
    id: "languages",
    title: "Add the shop languages (optional)",
    owner: "browser",
    needs: ["intake"],
    instructions:
      `If the shop sells in more than one language: Settings > Languages > add and publish them so checkout and emails are translated. Single language: pnpm shop-setup done languages "n/a: one language". ${FALLBACK}`,
  },
  {
    id: "cookie-consent",
    title: "Add a cookie banner that tells Shopify the visitor's choice",
    owner: "code",
    needs: ["intake", "checkout-domain"],
    instructions:
      "Follow-on plan. The agent adds a consent banner to the frontend and passes the choice with Shopify's Customer Privacy API: window.Shopify.customerPrivacy.setTrackingConsent with headlessStorefront true, checkoutRootDomain, storefrontRootDomain and the public Storefront token, and allows Shopify's script host in the content security policy (shopify.dev/docs/api/customer-privacy). No analytics may fire before consent.",
  },
  {
    id: "seo",
    title: "Add sitemap, robots, canonical URLs and product structured data",
    owner: "code",
    needs: ["hosting"],
    instructions:
      "Follow-on plan. The agent adds sitemap.xml and robots.txt to the frontend, canonical URLs, product structured data, and 301 redirects from any old URLs when migrating a shop.",
  },
  {
    id: "search-console",
    title: "Verify the domain in Google Search Console and add analytics",
    owner: "human",
    needs: ["hosting", "seo", "cookie-consent"],
    instructions:
      "Verify the domain in Google Search Console (a DNS record at the DNS provider) and submit the sitemap. Add analytics only after the cookie banner works.",
  },
  {
    id: "withdrawal-button",
    title: "Offer the EU online withdrawal function if it applies",
    owner: "human",
    needs: ["legal-details", "policies-approve"],
    instructions:
      "Ask an accountant or lawyer whether the goods fall under the EU online withdrawal function (Directive 2023/2673, applicable from 19 June 2026; made-to-order goods may be exempt; how Greece applies it is not checked). If required, the agent builds a withdrawal page in the frontend plus a confirmation email in a follow-on plan. If exempt: pnpm shop-setup done withdrawal-button \"n/a: <the reason>\".",
  },
  {
    id: "payments",
    title: "Activate payments",
    owner: "human",
    needs: ["store-basics"],
    instructions: "Settings > Payments. Needs identity, bank details and tax number; only the owner can do this. The agent never enters these.",
  },
  {
    id: "cod-payment",
    title: "Offer cash on delivery (optional)",
    owner: "human",
    needs: ["payments"],
    instructions:
      "If the shop does not offer cash on delivery: pnpm shop-setup done cod-payment \"n/a: not offered\". Otherwise Settings > Payments > Payment providers, add Cash on Delivery (COD) from the suggested manual payment methods, write the instructions customers see, activate it. Per Shopify's docs orders stay unpaid until the owner marks them paid after collecting the cash, so someone must do that every day.",
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
    needs: ["preflight", "hosting"],
    instructions: "Follow-on plan. Needs a public https SITE_URL after the first deploy. Webhooks created by an app are signed with the app client secret, not the Notifications-page secret.",
  },
  {
    id: "test-order",
    title: "Place a real order end to end and refund it",
    owner: "human",
    needs: ["tax-inclusive", "shipping", "payments", "invoicing", "e2e", "theme-redirect", "email-templates-install", "email-sender", "catalogue", "courier"],
    instructions: "Buy a real product with a real card. Check: checkout opens on checkout.<domain>, price at checkout equals the shelf price, shipping matches the rule, an invoice was issued, the order confirmation email arrives in the inbox (not spam) in the new design, and the default Shopify theme URL redirects to the frontend. Then refund it. Nothing else proves payments, tax, shipping and invoicing together.",
  },
  {
    id: "rotate-secrets",
    title: "Rotate every credential that was pasted into a chat",
    owner: "human",
    needs: ["test-order"],
    instructions: "Rotate the Storefront private token, the app client secret and any automation token, and remove the Admin token from any deployed environment.",
  },
  {
    id: "go-live",
    title: "Final check before telling anyone the shop is ready",
    owner: "human",
    needs: ["test-order", "rotate-secrets", "legal-details", "withdrawal-button", "cookie-consent", "hosting", "catalogue", "inventory", "courier", "cod-payment", "eu-vat", "customer-accounts", "staff-alerts", "languages", "search-console", "policies-approve"],
    instructions:
      "Run pnpm shop-setup status: every step must be done, or marked done with an n/a reason. Read the list of n/a reasons back to the owner. Only then say the shop is ready.",
  },
];
