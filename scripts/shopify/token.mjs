/**
 * Client credentials grant: the app exchanges its own client id and secret for
 * an Admin API token. No redirect, no click. Only works when the app and the
 * store are in the SAME Shopify organization and the app is installed on the
 * store (shopify.dev, checked 2026-10-04). Tokens last 24 hours.
 */
export function explainTokenError(status, body) {
  return (
    `client credentials grant failed (HTTP ${status}): ${String(body).slice(0, 300)}\n` +
    "  This grant only works when the app is installed on the store AND the store is in the same Shopify organization as the app\n" +
    "  (a dev store created in the Dev Dashboard is; a client's own store is not). Otherwise run: pnpm shop-setup oauth"
  );
}

export async function mintAdminToken({ domain, clientId, clientSecret, fetchFn = fetch }) {
  const response = await fetchFn(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(explainTokenError(response.status, text));
  const json = JSON.parse(text);
  return { token: json.access_token, scope: json.scope ?? "", expiresIn: json.expires_in ?? null };
}
