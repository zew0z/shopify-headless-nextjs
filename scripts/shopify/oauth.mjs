/**
 * Authorization-code grant, for stores OUTSIDE the app's Shopify organization
 * (the client credentials grant covers the rest). Runs a one-shot localhost
 * server for the redirect and checks everything Shopify tells us to check:
 * state, the shop hostname, and the callback HMAC.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const REDIRECT_PORT = 3456; // must match the redirect URL registered on the app
export const SHOP_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
export const redirectUri = (port = REDIRECT_PORT) => `http://localhost:${port}/callback`;

export function buildAuthorizeUrl({ domain, clientId, scopes, redirect, state }) {
  const query = new URLSearchParams({ client_id: clientId, scope: scopes.join(","), redirect_uri: redirect, state });
  return `https://${domain}/admin/oauth/authorize?${query}`;
}

/** HMAC-SHA256 (hex) over the query without `hmac`, sorted, joined `k=v&k=v`, keyed with the client secret. */
export function computeHmac(params, secret) {
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function verifyCallback({ query, state, clientSecret, domain }) {
  if (query.get("state") !== state) return { ok: false, problem: "state mismatch. Re-run the command and use the fresh URL." };
  const shop = query.get("shop") ?? "";
  if (!SHOP_PATTERN.test(shop) || shop !== domain) return { ok: false, problem: `shop "${shop}" is not the store being set up (${domain}).` };
  const given = Buffer.from(query.get("hmac") ?? "");
  const expected = Buffer.from(computeHmac(query, clientSecret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, problem: "hmac check failed: the callback was not signed with this app's client secret." };
  }
  const code = query.get("code");
  if (!code) return { ok: false, problem: `no code in the callback: ${[...query.keys()].join(", ")}` };
  return { ok: true, code };
}

const page = (title, body) => `<body style="font:16px system-ui;padding:3rem;max-width:34rem"><h2>${title}</h2><p>${body}</p></body>`;

export function runOAuth({ domain, clientId, clientSecret, scopes, port = REDIRECT_PORT, fetchFn = fetch, save, onReady = () => {}, timeoutMs = 600_000 }) {
  return new Promise((resolve, reject) => {
    const state = randomBytes(16).toString("hex");
    let timer;
    let server;

    const stop = () => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
    };
    const respond = (res, status, title, body, settle) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(page(title, body), () => {
        stop();
        settle();
      });
    };

    server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/callback") return void res.writeHead(404).end("not found");

      const check = verifyCallback({ query: url.searchParams, state, clientSecret, domain });
      if (!check.ok) return respond(res, 400, "Failed", check.problem, () => reject(new Error(check.problem)));

      try {
        const exchange = await fetchFn(`https://${domain}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: check.code }).toString(),
        });
        const text = await exchange.text();
        if (!exchange.ok) throw new Error(`token exchange HTTP ${exchange.status}: ${text.slice(0, 300)}`);
        const json = JSON.parse(text);
        save("SHOPIFY_ADMIN_TOKEN", json.access_token);
        respond(res, 200, "Token saved", "Written to .env.local. Close this tab.", () =>
          resolve({ token: json.access_token, scope: json.scope ?? "", expiresIn: json.expires_in ?? null }),
        );
      } catch (error) {
        respond(res, 500, "Failed", String(error.message ?? error), () => reject(error));
      }
    });

    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(port, () => {
      const redirect = redirectUri(server.address().port);
      timer = setTimeout(() => {
        stop();
        reject(new Error("timed out waiting for the Install click"));
      }, timeoutMs);
      onReady({ redirect, authorizeUrl: buildAuthorizeUrl({ domain, clientId, scopes, redirect, state }) });
    });
  });
}
