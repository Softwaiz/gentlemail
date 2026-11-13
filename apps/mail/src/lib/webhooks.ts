import { env } from "cloudflare:workers";
import { type AttachmentRow, type MessageRow, listAttachments, parseAddrs } from "./db";
import { newId, now } from "./util";

export type WebhookEvent = "message.received" | "message.sent";
export const EVENTS: { id: WebhookEvent; label: string }[] = [
  { id: "message.received", label: "Message received" },
  { id: "message.sent", label: "Message sent" },
];

export type WebhookRow = {
  id: string;
  name: string;
  url: string;
  secret: string;
  mailbox_id: string | null;
  events: string;
  active: number;
  created_at: number;
};

export type DeliveryRow = {
  id: string;
  webhook_id: string;
  event: string;
  message_id: string | null;
  payload: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  next_attempt_at: number | null;
  created_at: number;
  delivered_at: number | null;
};

// Retry schedule after a failed attempt: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h; then give up.
const BACKOFF = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3];
const TEXT_LIMIT = 200_000;

export const publicUrl = () => (env.PUBLIC_URL || "").replace(/\/$/, "");

export const newSecret = () =>
  `whsec_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/** The JSON shape of a message, shared by webhooks and the API. */
export function messageJson(msg: MessageRow, mailboxAddress: string, atts: AttachmentRow[]) {
  const base = publicUrl();
  const text = msg.text_body ?? "";
  return {
    id: msg.id,
    thread_id: msg.thread_id,
    mailbox: { id: msg.mailbox_id, address: mailboxAddress },
    folder: msg.folder,
    direction: msg.direction === "in" ? "inbound" : "outbound",
    from: { name: msg.from_name || null, address: msg.from_addr },
    to: parseAddrs(msg.to_json),
    cc: parseAddrs(msg.cc_json),
    reply_to: msg.reply_to,
    subject: msg.subject,
    date: new Date(msg.date).toISOString(),
    message_id: msg.message_id,
    in_reply_to: msg.in_reply_to,
    is_read: !!msg.is_read,
    is_starred: !!msg.is_starred,
    snippet: msg.snippet,
    text: text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) : text,
    text_truncated: text.length > TEXT_LIMIT,
    has_html: !!(msg.html_body || msg.html_key),
    attachments: atts.map((a) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
      inline: a.disposition === "inline" && !!a.content_id,
      url: `${base}/api/v1/attachments/${a.id}`,
    })),
    url: `${base}/api/v1/messages/${msg.id}`,
  };
}

async function sign(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One HTTP attempt. Updates the delivery row with the outcome. */
export async function attemptDelivery(d: DeliveryRow, hook: WebhookRow) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "GentleMail-Webhooks/1",
        "X-GentleMail-Event": d.event,
        "X-GentleMail-Delivery": d.id,
        "X-GentleMail-Timestamp": timestamp,
        "X-GentleMail-Signature": `v1=${await sign(hook.secret, timestamp, d.payload)}`,
      },
      body: d.payload,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (!res.ok) error = (await res.text().catch(() => "")).slice(0, 300) || `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const attempts = d.attempts + 1;
  const ok = status !== null && status >= 200 && status < 300;
  const giveUp = !ok && attempts > BACKOFF.length;
  await env.DB.prepare(
    `UPDATE webhook_deliveries SET status = ?, attempts = ?, last_status = ?, last_error = ?, next_attempt_at = ?, delivered_at = ?
     WHERE id = ?`,
  )
    .bind(
      ok ? "success" : giveUp ? "failed" : "pending",
      attempts,
      status,
      ok ? null : error,
      ok || giveUp ? null : now() + BACKOFF[attempts - 1],
      ok ? now() : null,
      d.id,
    )
    .run();
  return ok;
}

/** Records one delivery per matching webhook, then tries each right away. */
export async function emitMessageEvent(event: WebhookEvent, messageId: string) {
  const msg = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(messageId).first<MessageRow>();
  if (!msg) return;
  const { results: hooks } = await env.DB.prepare(
    `SELECT * FROM webhooks WHERE active = 1 AND (mailbox_id IS NULL OR mailbox_id = ?)
       AND (',' || events || ',') LIKE ?`,
  )
    .bind(msg.mailbox_id, `%,${event},%`)
    .all<WebhookRow>();
  if (!hooks.length) return;

  const mailbox = await env.DB.prepare("SELECT address FROM mailboxes WHERE id = ?").bind(msg.mailbox_id).first<{ address: string }>();
  const atts = await listAttachments([msg.id]);
  const data = messageJson(msg, mailbox?.address ?? "", atts);

  await Promise.all(
    hooks.map(async (hook) => {
      const d: DeliveryRow = {
        id: newId(),
        webhook_id: hook.id,
        event,
        message_id: msg.id,
        payload: JSON.stringify({ id: "", event, created_at: new Date().toISOString(), data }),
        status: "pending",
        attempts: 0,
        last_status: null,
        last_error: null,
        next_attempt_at: now(),
        created_at: now(),
        delivered_at: null,
      };
      // The delivery id doubles as the idempotency key for receivers.
      d.payload = JSON.stringify({ id: d.id, event, created_at: new Date(d.created_at).toISOString(), data });
      await env.DB.prepare(
        `INSERT INTO webhook_deliveries (id, webhook_id, event, message_id, payload, status, attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
        .bind(d.id, hook.id, event, msg.id, d.payload, d.next_attempt_at, d.created_at)
        .run();
      await attemptDelivery(d, hook);
    }),
  );
}

/** Sends a sample event so the receiver can be checked from the admin page. */
export async function sendTestEvent(hook: WebhookRow) {
  const d: DeliveryRow = {
    id: newId(),
    webhook_id: hook.id,
    event: "ping",
    message_id: null,
    payload: "",
    status: "pending",
    attempts: 0,
    last_status: null,
    last_error: null,
    next_attempt_at: null,
    created_at: now(),
    delivered_at: null,
  };
  d.payload = JSON.stringify({ id: d.id, event: "ping", created_at: new Date(d.created_at).toISOString(), data: { webhook: hook.name } });
  await env.DB.prepare(
    `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, attempts, created_at)
     VALUES (?, ?, 'ping', ?, 'pending', 0, ?)`,
  )
    .bind(d.id, hook.id, d.payload, d.created_at)
    .run();
  // A test is tried once; it isn't retried.
  d.attempts = BACKOFF.length;
  return attemptDelivery(d, hook);
}

/** Cron: retries deliveries whose next attempt is due. */
export async function retryDueDeliveries() {
  const { results } = await env.DB.prepare(
    `SELECT d.*, w.url, w.secret, w.name, w.mailbox_id, w.events, w.active, w.created_at AS w_created
     FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ? AND w.active = 1
     ORDER BY d.next_attempt_at LIMIT 50`,
  )
    .bind(now())
    .all<DeliveryRow & { url: string; secret: string; name: string; mailbox_id: string | null; events: string; active: number; w_created: number }>();
  await Promise.all(
    results.map((r) =>
      attemptDelivery(r, {
        id: r.webhook_id,
        name: r.name,
        url: r.url,
        secret: r.secret,
        mailbox_id: r.mailbox_id,
        events: r.events,
        active: r.active,
        created_at: r.w_created,
      }),
    ),
  );
  return results.length;
}
