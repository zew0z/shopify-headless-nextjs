/**
 * The site's contact form and newsletter sign-up, emailed to the owner through
 * Resend. Server-only: never import this from a client component.
 * Nothing is typed in: the key, the sender and the inboxes come from env vars.
 * Without them the form answers "not_configured" instead of pretending to send.
 * The newsletter goes to the inbox because the Storefront API has no sign-up
 * without a customer password.
 */
export type FormError = "invalid_json" | "invalid_email" | "missing_fields" | "not_configured" | "send_failed";
export interface MailConfig { apiKey: string; from: string; to: string[] }
export interface FormMessage { subject: string; html: string; text: string; replyTo?: string }
export type ParsedForm = { ok: true; message: FormMessage } | { ok: true; spam: true } | { ok: false; error: FormError };

export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const to = (env.CONTACT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !env.CONTACT_FROM || !to.length) return null;
  return { apiKey: env.RESEND_API_KEY, from: env.CONTACT_FROM, to };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function table(rows: [string, string][]): string {
  const cells = rows
    .map(([label, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top"><strong>${escapeHtml(label)}</strong></td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`)
    .join("");
  return `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">${cells}</table>`;
}

export function parseForm(input: unknown): ParsedForm {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (str(body.website, 200)) return { ok: true, spam: true };
  const email = str(body.email, 254);
  if (!isEmail(email)) return { ok: false, error: "invalid_email" };

  if (body.type === "newsletter") {
    return { ok: true, message: { subject: `Newsletter sign-up: ${email}`, html: `<p style="font-family:Arial,sans-serif">New newsletter sign-up from the site.</p>${table([["Email", email]])}`, text: `New newsletter sign-up from the site.\nEmail: ${email}` } };
  }
  const name = str(body.name, 200);
  const message = str(body.message, 5000);
  if (!name || !message) return { ok: false, error: "missing_fields" };
  const subject = str(body.subject, 200);
  const rows: [string, string][] = [["Subject", subject || "-"], ["Name", name], ["Email", email], ["Phone", str(body.phone, 50) || "-"], ["Message", message]];
  return {
    ok: true,
    message: {
      subject: `Message from the site${subject ? `: ${subject}` : ""} (${name})`,
      html: `<p style="font-family:Arial,sans-serif">New message from the contact form. Reply to this email to answer the customer.</p>${table(rows)}`,
      text: rows.map(([l, v]) => `${l}: ${v}`).join("\n"),
      replyTo: email,
    },
  };
}

export async function sendForm(message: FormMessage, config: MailConfig, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.from, to: config.to, subject: message.subject, html: message.html, text: message.text, ...(message.replyTo && { reply_to: message.replyTo }) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
