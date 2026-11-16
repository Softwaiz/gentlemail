import type { WebhookEvent } from "./types.js";

/** Why a delivery was refused. `reason` is stable; the message is for people. */
export class WebhookVerificationError extends Error {
  readonly reason: "missing_headers" | "expired" | "bad_signature" | "invalid_json";
  constructor(reason: WebhookVerificationError["reason"], message: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

export type VerifyOptions = {
  /** Oldest delivery accepted, in seconds. Default 300 (five minutes), against replays. */
  tolerance?: number;
  /** The current time in milliseconds (tests). */
  now?: number;
};

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

/**
 * Checks a webhook delivery and returns its event.
 *
 * Pass the incoming `Request` (Workers, Deno, Bun, Hono, Next.js), or the raw body
 * and the headers (Express with `express.raw()`, Node's http). The body must be
 * exactly what was received: verify before parsing.
 *
 * Throws `WebhookVerificationError` when the signature is wrong, the delivery is
 * older than `tolerance`, or a header is missing.
 */
export async function verifyWebhook(
  input: Request | { body: string | Uint8Array; headers: HeaderSource },
  secret: string,
  options: VerifyOptions = {},
): Promise<WebhookEvent> {
  if (!secret) throw new TypeError("verifyWebhook: the webhook's signing secret (whsec_…) is required");
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const body = isRequest
    ? await (input as Request).text()
    : typeof (input as { body: unknown }).body === "string"
      ? ((input as { body: string }).body)
      : new TextDecoder().decode((input as { body: Uint8Array }).body);
  const headers = isRequest ? (input as Request).headers : (input as { headers: HeaderSource }).headers;

  const timestamp = header(headers, "x-gentlemail-timestamp");
  const signature = header(headers, "x-gentlemail-signature");
  if (!timestamp || !signature)
    throw new WebhookVerificationError("missing_headers", "X-GentleMail-Timestamp and X-GentleMail-Signature are required.");

  const tolerance = options.tolerance ?? 300;
  const now = (options.now ?? Date.now()) / 1000;
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > tolerance)
    throw new WebhookVerificationError("expired", `The delivery is older than ${tolerance} seconds, or its timestamp is invalid.`);

  const expected = `v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
  if (!timingSafeEqual(expected, signature.trim()))
    throw new WebhookVerificationError("bad_signature", "The signature doesn't match. Check the secret and that the body wasn't changed.");

  try {
    return JSON.parse(body) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError("invalid_json", "The body isn't JSON.");
  }
}

function header(headers: HeaderSource, name: string): string {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? "";
  // Node lower-cases header names; accept any case anyway.
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key ? record[key] : undefined;
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let hex = "";
  for (const b of mac) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
