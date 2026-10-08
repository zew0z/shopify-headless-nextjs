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
    id: "frontend-audit",
    title: "Audit the frontend you received",
    owner: "code",
    needs: [],
    instructions:
      "From the kit repo: pnpm shop-setup frontend-audit <path to the received repo>. Tell the owner in plain words what it found: how many hardcoded products and where, fake product APIs, the cart and its checkout button, pages that switch caching off, data typed into the site that Shopify should supply (menus, policy text, store claims), invented fields (ratings, stock counts, badges) and card forms. If it says Stop, do not install anything: tell the owner why and ask whether to move the frontend to Next.js with the App Router (a separate job). Never half-wire a frontend the kit does not support.",
    automation: "frontend-audit",
  },
  {
    id: "kit-install",
    title: "Install the kit into the received repo",
    owner: "code",
    needs: ["frontend-audit"],
    instructions:
      "From the kit repo: pnpm shop-setup kit-install <path> --dry-run, show the owner what it adds, then run it without --dry-run (it also adds error.tsx and global-error.tsx, and a CLAUDE.md that points at AGENTS.md, when they are missing). A conflict means the frontend already has a file or script with that name, usually its own fake app/api route: read it, note what it does for the wiring, rename it (for example app/api/search-old/) so the kit's route can go in, point their callers at the renamed path until the wiring replaces them, and delete it under the dead-code rule once nothing calls it. Then run kit-install again. After that, in the received repo: pnpm install, pnpm test:scripts, commit. From here on, work in the received repo; its store-setup.state.json already has this step and the audit done.",
    automation: "kit-install",
  },
  {
    id: "frontend-catalogue",
    title: "Show Shopify's products and collections in the received design",
    owner: "code",
    needs: ["kit-install"],
    instructions:
      "Follow docs/frontend-wiring.md, sections Catalogue, Product page and Header, footer, policies and pages. Keep their components and their product type: write one mapper from the SDK's Product to their type, read products and collections with the SDK in server components, pass the mapped data down. Lists use the paged reads (getProductsPage, getCollectionProductsPage, searchProducts) with Shopify's own filters, never a filter over the whole catalogue in memory; the product page gets extra fields from getProduct(handle, { metafields }); menus, policies and info pages come from getMenu, menuLinks, getPolicies and getPage. Fields Shopify does not have (ratings, reviews, made-up was-prices, announcement bar, newsletter) are hidden and listed for the owner, never invented. Remove anything that switches caching off on pages that show products, and allow cdn.shopify.com in next.config images. Done when the code is in and builds against mock.shop or the development store.",
  },
  {
    id: "frontend-cart",
    title: "Connect the received cart to Shopify's cart and checkout",
    owner: "code",
    needs: ["frontend-catalogue"],
    instructions:
      "Follow docs/frontend-wiring.md, section Cart. Keep their cart UI; wrap the root layout in CartProvider and use useCart() (import from @/lib/shopify/cart-provider) where their cart context was, show totals from cart.cost, and send the checkout button to checkout(), which opens Shopify's checkout. Every add needs a variant id: if products have several variants and the design has no picker, ask the owner. Done when the code is in and builds against mock.shop or the development store.",
  },
  {
    id: "frontend-check",
    title: "Prove the received frontend is wired to Shopify",
    owner: "code",
    needs: ["frontend-cart", "headless-channel"],
    instructions:
      "In the received repo: pnpm shop-setup frontend-check, then pnpm build, pnpm start, and pnpm shop-setup frontend-check --site http://localhost:3000 (it loads the home page and a product page and needs Shopify images on both). Then run it with the development store's public Storefront token in .env.local and click through: product list, a product page, add to cart, the checkout button opens Shopify's checkout. This is the only frontend step that waits for the development store: mark done only after that click-through passed; say which parts were not run. Unused old data files are listed for the owner, not deleted, until they agree.",
    automation: "frontend-check",
  },
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
    id: "sdk-queries",
    title: "Check the frontend's Shopify queries against the API version in use",
    owner: "api",
    needs: [],
    instructions:
      "Run pnpm shop-setup validate-queries. It uses shopify.dev's public schema proxy, so it needs no store and no token. Every document must be valid against the configured version (SHOPIFY_STOREFRONT_API_VERSION, default in src/lib/shopify/config.ts). Run it again whenever src/lib/shopify or that version changes. A failing document is fixed in the SDK, never worked around in the store.",
    automation: "validate-queries",
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
    title: "Create the Dev Dashboard app with the Admin scopes and install it",
    owner: "browser",
    needs: ["store-basics"],
    instructions: `Settings > Apps and sales channels > Develop apps > Build apps in Dev Dashboard. Scopes: write_shipping, read_locations, write_legal_policies, write_products, write_publications, write_inventory, write_files. Redirect URL exactly http://localhost:3456/callback (only needed for the OAuth fallback). Release a new app version, then install the app on the store from the Dev Dashboard (use its Install button; the exact clicks were not in Shopify's docs, so say what you see). Read Client ID and Client secret into .env.local (SHOPIFY_APP_CLIENT_ID, SHOPIFY_APP_CLIENT_SECRET). ${FALLBACK}`,
  },
  {
    id: "oauth",
    title: "Get the Admin token (the agent mints it, or one Install click)",
    owner: "human",
    needs: ["dev-app"],
    instructions:
      "Do not ask the human yet. First run: pnpm shop-setup token. If it prints a working token (client credentials grant: works when the store is in the same Shopify organization as the app, such as a dev store made in the Dev Dashboard), mark this step done with the note \"n/a: client credentials worked\". If it fails, run pnpm shop-setup oauth: it prints a URL, and the person opens it while logged into the store and clicks Install. That writes SHOPIFY_ADMIN_TOKEN to .env.local.",
    automation: "token",
  },
  {
    id: "hosting",
    title: "Deploy the frontend and point the main domain at it",
    owner: "human",
    needs: ["headless-channel", "frontend-check"],
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
      `Follow docs/shopify-analytics.md. Mount <ShopifyAnalytics /> once in the root layout. Configure the verified permanent store domain, Shop ID, exact permitted origins and localization with pnpm shop-setup analytics-configure --enable plus its public flags. Supply public static paths and the frontend's product path prefix; dynamic products are verified server-side. The default controls accept, reject and withdraw statistics; a custom banner calls setAnalyticsConsent and exposes cookie settings. Allow the Shopify CDN, the Monorail endpoint and this site's consent route in CSP; supply a nonce for inline bootstrap when needed. Missing, rejected or unavailable consent sends nothing. Product/cart hooks require a separate experimental opt-in and are not dashboard-verified by the visits release. ${FALLBACK}`,
  },
  {
    id: "analytics-check",
    title: "Verify consent-gated visits and page-view wiring",
    owner: "code",
    needs: ["cookie-consent", "frontend-check"],
    instructions:
      "Run pnpm shop-setup analytics-check, pnpm test:scripts, typecheck, lint and build. Use the mocked browser rehearsal in docs/shopify-analytics.md: pending/rejected consent sends zero events; accept sends the current page only; saved choices restore; withdrawal immediately blocks navigation; blocked scripts leave shopping functional. Run analytics-check --site=https://<frontend> after deployment for public configuration only. No command publishes a synthetic event to a real store. HTTP success alone does not verify dashboard receipt.",
    automation: "analytics-check",
  },
  {
    id: "live-view",
    title: "Verify visits and page views in the actual Shopify dashboard",
    owner: "human",
    needs: ["hosting", "cookie-consent", "analytics-check"],
    instructions:
      "On the deployed permitted HTTPS frontend, open a fresh private session, accept statistics and navigate between public pages. Check Shopify Analytics > Live View and later sessions/page-view reporting in the correct store; record the site origin, time, consent state and observed dashboard evidence in the completion note. A successful Monorail response is not dashboard proof; missing or delayed reporting remains unverified. Local mocked tests do not count as dashboard receipt. This step validates visits/page views only, not cart, purchases or checkout attribution.",
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
    instructions:
      "Needs the public https SITE_URL from the hosting step. Run pnpm shop-setup webhooks --dry-run, show the plan, then pnpm shop-setup webhooks. Set SHOPIFY_WEBHOOK_SECRET to the app client secret locally and on the host (webhooks created by the app are signed with it) and redeploy. Prove it: first check the frontend does not switch caching off (search it for force-dynamic, force-no-store and cache: \"no-store\" on catalogue reads; with caching off every reload is fresh and the test proves nothing), then change a product title in the Admin and reload the product page; it changes at once when the webhook works. /api/revalidate refuses every request while the secret is unset.",
    automation: "webhooks",
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
    needs: ["sdk-queries", "test-order", "rotate-secrets", "legal-details", "withdrawal-button", "cookie-consent", "hosting", "catalogue", "inventory", "courier", "cod-payment", "eu-vat", "customer-accounts", "staff-alerts", "languages", "search-console", "live-view", "policies-approve"],
    instructions:
      "Run pnpm shop-setup status: every step must be done, or marked done with an n/a reason. Read the list of n/a reasons back to the owner. Only then say the shop is ready.",
  },
];
