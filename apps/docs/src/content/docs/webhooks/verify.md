---
title: Verify a webhook
description: Check the HMAC-SHA256 signature of GentleMail webhook deliveries and reject replays.
---

With the [JavaScript SDK](/docs/sdk/#webhooks) it's one call: `await verifyWebhook(request, secret)`. Without it, here's what to check.

The signature is an HMAC-SHA256 of the timestamp, a dot and the raw body, keyed with your secret and written in hex:

```
X-GentleMail-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>
```

Check it on the **raw body**, before parsing, and reject timestamps older than five minutes to stop replays.

```ts
// TypeScript: Cloudflare Workers, Node 20+, Deno, Bun.
async function verify(request: Request, secret: string) {
  const body = await request.text();
  const ts = request.headers.get("X-GentleMail-Timestamp") ?? "";
  const sig = request.headers.get("X-GentleMail-Signature") ?? "";

  // Refuse anything older than five minutes.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return null;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  const expected = "v1=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Compare in constant time.
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? JSON.parse(body) : null;
}
```

If a secret leaks, choose **Generate a new secret** on the webhook's page. The old one stops working straight away.
