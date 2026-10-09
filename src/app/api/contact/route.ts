import { NextResponse } from "next/server";
import { mailConfig, parseForm, sendForm } from "@/lib/shopify/contact";

/**
 * The contact form and newsletter sign-up. Answers error codes, not sentences:
 * the frontend shows them in the shop's language.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseForm(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if ("spam" in parsed) return NextResponse.json({ ok: true });
  const config = mailConfig();
  if (!config) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  try {
    await sendForm(parsed.message, config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[contact] send failed", error);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }
}
