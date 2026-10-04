import crypto from "node:crypto";

export type WebhookCheck = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Verifies Shopify's X-Shopify-Hmac-SHA256 header (base64 HMAC-SHA256 of the raw
 * body, keyed with the app client secret). Fails CLOSED: with no secret
 * configured it refuses, because accepting unsigned requests lets anyone who
 * finds the URL force cache purges.
 */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, secret: string | undefined): WebhookCheck {
  if (!secret) return { ok: false, status: 503, reason: "SHOPIFY_WEBHOOK_SECRET is not set; refusing unsigned webhooks" };
  if (!hmacHeader) return { ok: false, status: 401, reason: "Missing x-shopify-hmac-sha256 header" };

  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"));
  const given = Buffer.from(hmacHeader);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, status: 401, reason: "Invalid HMAC signature" };
  }
  return { ok: true };
}
