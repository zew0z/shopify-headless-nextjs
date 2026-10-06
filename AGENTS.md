<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Store setup

To set up or take live a Shopify store behind this frontend, follow `.claude/skills/shopify-store-setup/SKILL.md` and start with `pnpm shop-setup next`.

To connect a frontend someone else built, follow `.claude/skills/shopify-connect-frontend/SKILL.md`: `pnpm shop-setup frontend-audit <path>` then `pnpm shop-setup kit-install <path>` from this repo.
