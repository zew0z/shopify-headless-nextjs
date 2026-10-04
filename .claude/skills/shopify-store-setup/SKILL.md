---
name: shopify-store-setup
description: Set up a Shopify store behind this headless frontend end to end - taxes, shipping, policies, invoicing, payments, test order - doing everything an agent can and handing the human one step at a time. Use whenever the user mentions setting up the shop, going live, taxes, shipping rates, invoices, policies, or "the Shopify side".
---

# Shopify store setup

**This is a manual for the agent. Nothing here runs on its own.** You read it, decide what to do, run the scripts yourself, and talk to the human in chat. `pnpm shop-setup next` only tells you what is ready; it never acts.

The agent does its part and asks the human only for what only a human can do.

## The loop

1. `pnpm shop-setup next`. It prints what you can do now and the ONE thing to ask the human.
2. Start the agent steps immediately, in parallel with the human step.
3. Ask the human for the one step, in plain words, with the exact menu path. Wait.
4. When a step is done and checked, `pnpm shop-setup done <id> "<note>"`.
5. Repeat until `pnpm shop-setup status` shows everything done.

Do not ask for two human things at once. Do not ask anything the questionnaire already answered.

## Who does each step

| Owner | Meaning |
|---|---|
| `api` | You run a script that calls the Shopify Admin API |
| `browser` | You click through the Shopify admin while the human is logged in and watching |
| `code` | You edit the frontend code in this repo (cookie banner, SEO) |
| `human` | Only a person can: identity, money, DNS, legal sign-off, a real card |

**Not applicable?** If a step does not apply to this shop (no cash on delivery, one language, Greece only), do not skip it silently. Ask the human, then record the reason: `pnpm shop-setup done <id> "n/a: <reason>"`. The final `go-live` step reads every n/a reason back to the owner.

## Intake first

If `store-setup.config.json` is missing, ask the business decisions once with AskUserQuestion (concrete choices, trade-off in the description, commercial words not technical ones): stock tracking, shipping rates and free-shipping threshold, whether compare-at prices are real, reviews. Write the answers to `store-setup.config.json` (shape: `store-setup.config.example.json`). Tell the human which values the profile assumed (`pnpm shop-setup preflight --config-only` prints them).

If they say "decide later" on tax: push back once (it cannot change after the first order), then use tax-inclusive for EU retail and say you did.

## Browser steps

Only while the human is logged into Shopify and watching. Never type a password, card, bank, tax-number or ID. Read tokens off the screen into `.env.local`; never into a committed file or the chat. If the browser is unavailable, give the human the exact clicks.

## Rules

- Say "unverified" for anything not run against a real (development) store. Pure-logic tests are not proof.
- Never put `SHOPIFY_ADMIN_TOKEN`, client id or client secret in the deployed environment.
- Tokens pasted into chat: tell the human once to rotate them.
- Policies and legal text are drafted by you and approved by a person. Never publish unread.
- Never invent reviews, "was" prices or testimonials.
- Introspect before changing a mutation: `node scripts/shopify/introspect.mjs <InputTypeName>`.
- Shopify moves menus. If a path is gone, use the admin search box with the bold term, then fix `scripts/setup/steps.mjs`.

## Done means

`pnpm shop-setup status` shows every step done or marked n/a with a reason, the `go-live` step has been walked through with the owner, the test order was placed and refunded, an invoice was issued for it, and credentials were rotated. Anything marked "unverified" along the way is repeated back to the owner at the end.
