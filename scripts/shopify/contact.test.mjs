import test from "node:test";
import assert from "node:assert/strict";
import { loadSdk } from "../test-support/load-sdk.mjs";

const contact = await loadSdk("contact");

test("no key, sender or inbox means not configured, never a typed-in fallback", () => {
  assert.equal(contact.mailConfig({}), null);
  assert.equal(contact.mailConfig({ RESEND_API_KEY: "k", CONTACT_FROM: "Shop <a@b.gr>" }), null);
  assert.deepEqual(contact.mailConfig({ RESEND_API_KEY: "k", CONTACT_FROM: "Shop <a@b.gr>", CONTACT_TO: "one@b.gr, two@b.gr" }), { apiKey: "k", from: "Shop <a@b.gr>", to: ["one@b.gr", "two@b.gr"] });
});

test("the hidden website field marks a bot: accepted, not sent", () => {
  assert.deepEqual(contact.parseForm({ type: "newsletter", email: "a@b.gr", website: "spam.example" }), { ok: true, spam: true });
});

test("bad email and missing fields are answered with codes", () => {
  assert.deepEqual(contact.parseForm({ type: "newsletter", email: "nope" }), { ok: false, error: "invalid_email" });
  assert.deepEqual(contact.parseForm({ type: "contact", email: "a@b.gr", name: "", message: "hi" }), { ok: false, error: "missing_fields" });
  assert.deepEqual(contact.parseForm(null), { ok: false, error: "invalid_email" });
});

test("a contact message escapes what the visitor typed and replies to them", () => {
  const parsed = contact.parseForm({ type: "contact", email: "a@b.gr", name: "<b>Maria</b>", message: "Hello & bye", subject: "Delivery" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.replyTo, "a@b.gr");
  assert.match(parsed.message.subject, /Delivery/);
  assert.match(parsed.message.html, /&lt;b&gt;Maria&lt;\/b&gt;/);
  assert.match(parsed.message.html, /Hello &amp; bye/);
  assert.doesNotMatch(parsed.message.html, /<b>Maria/);
});

test("sending posts to Resend with the configured sender and inboxes, and throws on failure", async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, init }; return new Response("{}", { status: 200 }); };
  const config = { apiKey: "re_test", from: "Shop <a@b.gr>", to: ["one@b.gr"] };
  const { message } = contact.parseForm({ type: "newsletter", email: "fan@b.gr" });
  await contact.sendForm(message, config, ok);
  assert.equal(sent.url, "https://api.resend.com/emails");
  assert.equal(sent.init.headers.Authorization, "Bearer re_test");
  const body = JSON.parse(sent.init.body);
  assert.deepEqual([body.from, body.to], ["Shop <a@b.gr>", ["one@b.gr"]]);
  assert.match(body.text, /fan@b\.gr/);
  await assert.rejects(contact.sendForm(message, config, async () => new Response("bad", { status: 422 })), /Resend 422/);
});
