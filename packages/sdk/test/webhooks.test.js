import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhook, WebhookVerificationError } from "../dist/index.js";

const secret = "whsec_0123456789abcdef";
const body = JSON.stringify({ id: "d1", event: "message.received", created_at: "2026-11-16T10:00:00.000Z", data: { id: "m1", subject: "Héllo ✓" } });
const ts = 1794830400;
// Signed the way GentleMail signs (lib/webhooks.ts), with node:crypto rather than the SDK's code.
const sig = (s = secret, t = ts, b = body) => `v1=${createHmac("sha256", s).update(`${t}.${b}`).digest("hex")}`;
const now = ts * 1000 + 30_000;
const request = (headers, b = body) =>
  new Request("https://hooks.test/mail", { method: "POST", body: b, headers: { "Content-Type": "application/json", ...headers } });

test("accepts a valid Request and returns the event", async () => {
  const e = await verifyWebhook(request({ "X-GentleMail-Timestamp": String(ts), "X-GentleMail-Signature": sig() }), secret, { now });
  assert.equal(e.event, "message.received");
  assert.equal(e.data.subject, "Héllo ✓");
});

test("accepts a raw body with Node-style headers, string or bytes", async () => {
  const headers = { "x-gentlemail-timestamp": String(ts), "x-gentlemail-signature": sig() };
  assert.equal((await verifyWebhook({ body, headers }, secret, { now })).id, "d1");
  assert.equal((await verifyWebhook({ body: new TextEncoder().encode(body), headers }, secret, { now })).id, "d1");
  assert.equal((await verifyWebhook({ body, headers: { "X-GentleMail-Timestamp": [String(ts)], "X-GentleMail-Signature": sig() } }, secret, { now })).id, "d1");
});

const refuses = async (input, reason, opts = { now }) =>
  assert.rejects(verifyWebhook(input, secret, opts), (e) => e instanceof WebhookVerificationError && e.reason === reason);

test("refuses a wrong secret, a changed body and a missing header", async () => {
  await refuses(request({ "X-GentleMail-Timestamp": String(ts), "X-GentleMail-Signature": sig("whsec_other") }), "bad_signature");
  await refuses(request({ "X-GentleMail-Timestamp": String(ts), "X-GentleMail-Signature": sig() }, body.replace("Héllo", "Hello")), "bad_signature");
  await refuses(request({ "X-GentleMail-Timestamp": String(ts + 1), "X-GentleMail-Signature": sig() }), "bad_signature");
  await refuses(request({ "X-GentleMail-Signature": sig() }), "missing_headers");
});

test("refuses old or future deliveries, honours tolerance", async () => {
  const h = { "X-GentleMail-Timestamp": String(ts), "X-GentleMail-Signature": sig() };
  await refuses(request(h), "expired", { now: ts * 1000 + 301_000 });
  await refuses(request(h), "expired", { now: ts * 1000 - 301_000 });
  await refuses(request({ ...h, "X-GentleMail-Timestamp": "abc" }), "expired");
  assert.equal((await verifyWebhook(request(h), secret, { now: ts * 1000 + 3_600_000, tolerance: 7200 })).id, "d1");
});

test("a ping (Send test) verifies too", async () => {
  const ping = JSON.stringify({ id: "d2", event: "ping", created_at: "2026-11-16T10:00:00.000Z", data: { webhook: "Slack" } });
  const e = await verifyWebhook({ body: ping, headers: { "x-gentlemail-timestamp": String(ts), "x-gentlemail-signature": sig(secret, ts, ping) } }, secret, { now });
  assert.equal(e.event, "ping");
  assert.equal(e.data.webhook, "Slack");
});
