import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { type ApiAuth, type Scope, apiError, apiJson, authenticate, keyAllowsMailbox } from "@/lib/apikeys";
import { type Mailbox, type MessageRow, getHtmlBody, isFolder, listAttachments } from "@/lib/db";
import { SendError, type OutgoingFile, sendMail } from "@/lib/outbound";
import { type Addr, htmlToText, isEmail, parseAddressList } from "@/lib/util";
import { messageJson } from "@/lib/webhooks";

/*
 * Public HTTP API, authenticated with API keys created in Admin → API & webhooks.
 *   POST /api/v1/send                 send (scope: send)
 *   GET  /api/v1/mailboxes            mailboxes this key can use
 *   GET  /api/v1/messages             list (scope: read)
 *   GET  /api/v1/messages/:id         one message with text and HTML (scope: read)
 *   POST /api/v1/messages/:id         mark read/unread, archive, trash, star… (scope: read)
 *   GET  /api/v1/attachments/:id      attachment bytes (scope: read)
 */

type Handler = (info: RequestInfo, auth: ApiAuth) => Promise<Response>;

/** Wraps a handler with key auth; `scope: null` accepts any valid key. */
const withKey =
  (scope: Scope | null, fn: Handler) =>
  async (info: RequestInfo): Promise<Response> => {
    let auth = await authenticate(info.request, scope ?? "send");
    if (auth instanceof Response && scope === null) auth = await authenticate(info.request, "read");
    if (auth instanceof Response) return auth;
    try {
      return await fn(info, auth);
    } catch (e) {
      console.error("api error", e);
      return apiError(500, "internal", "Something went wrong on our side.");
    }
  };

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await request.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Accepts "a@b.c", "Name <a@b.c>", {address, name} or an array of those. */
function toAddrs(v: unknown): Addr[] | null {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : [v];
  const out: Addr[] = [];
  for (const item of list) {
    if (typeof item === "string") out.push(...parseAddressList(item));
    else if (item && typeof item === "object" && typeof (item as any).address === "string")
      out.push({ address: (item as any).address.trim(), name: String((item as any).name ?? "").trim() });
    else return null;
  }
  return out.every((a) => isEmail(a.address)) ? out : null;
}

async function mailboxFor(auth: ApiAuth, address: string) {
  const mb = await env.DB.prepare("SELECT * FROM mailboxes WHERE address = ? COLLATE NOCASE").bind(address.trim()).first<Mailbox>();
  if (!mb || !keyAllowsMailbox(auth, mb.id)) return null;
  return mb;
}

async function messageFor(auth: ApiAuth, id: string) {
  const msg = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first<MessageRow>();
  if (!msg || !keyAllowsMailbox(auth, msg.mailbox_id)) return null;
  return msg;
}

/* ---------- POST /api/v1/send ---------- */

export const sendHandler = withKey("send", async ({ request }, auth) => {
  const b = await readJson(request);
  if (!b) return apiError(400, "invalid_json", "Send a JSON object body.");

  if (typeof b.from !== "string") return apiError(422, "invalid_from", '"from" must be the address of one of your mailboxes.');
  const mailbox = await mailboxFor(auth, b.from);
  if (!mailbox) return apiError(403, "mailbox_not_allowed", `This key can't send from ${b.from}.`);
  if (!mailbox.active) return apiError(422, "mailbox_disabled", `${mailbox.address} is disabled.`);

  // Optional threading: reply to a message stored in this mailbox.
  let original: MessageRow | null = null;
  if (b.reply_to_message_id != null) {
    original = await messageFor(auth, String(b.reply_to_message_id));
    if (!original || original.mailbox_id !== mailbox.id)
      return apiError(404, "original_not_found", "reply_to_message_id isn't a message in this mailbox.");
  }

  let to = toAddrs(b.to);
  const cc = toAddrs(b.cc);
  const bcc = toAddrs(b.bcc);
  if (!to || !cc || !bcc) return apiError(422, "invalid_recipient", "to, cc and bcc must hold valid email addresses.");
  if (!to.length && original) {
    to = [{ name: original.from_name, address: original.reply_to || original.from_addr }];
  }

  const text = typeof b.text === "string" ? b.text : null;
  const html = typeof b.html === "string" ? b.html : null;
  if (text === null && html === null) return apiError(422, "missing_body", 'Provide "text", "html" or both.');

  let subject = typeof b.subject === "string" ? b.subject : "";
  if (!subject && original) subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;

  const files: OutgoingFile[] = [];
  if (b.attachments != null) {
    if (!Array.isArray(b.attachments)) return apiError(422, "invalid_attachments", '"attachments" must be an array.');
    for (const a of b.attachments as any[]) {
      if (!a || typeof a.filename !== "string" || typeof a.content !== "string")
        return apiError(422, "invalid_attachments", "Each attachment needs filename and base64 content.");
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0));
      } catch {
        return apiError(422, "invalid_attachments", `${a.filename}: content isn't valid base64.`);
      }
      files.push({ filename: a.filename, type: typeof a.content_type === "string" ? a.content_type : "", content: bytes.buffer as ArrayBuffer });
    }
  }

  try {
    const id = await sendMail({
      mailbox,
      to,
      cc,
      bcc,
      subject,
      body: text ?? htmlToText(html!),
      html: html ?? undefined,
      includeSignature: b.signature === true,
      files,
      original,
      mode: original ? "reply" : null,
      quote: b.quote === true,
    });
    const row = await env.DB.prepare("SELECT thread_id FROM messages WHERE id = ?").bind(id).first<{ thread_id: string }>();
    return apiJson({ id, thread_id: row?.thread_id, from: mailbox.address, status: "sent" }, 201);
  } catch (e) {
    if (e instanceof SendError) return apiError(422, e.code || "send_failed", e.message);
    throw e;
  }
});

/* ---------- GET /api/v1/mailboxes ---------- */

export const mailboxesHandler = withKey(null, async (_info, auth) => {
  const { results } = await env.DB.prepare(
    `SELECT id, address, display_name, active FROM mailboxes ${auth.key.mailbox_id ? "WHERE id = ?" : ""} ORDER BY address`,
  )
    .bind(...(auth.key.mailbox_id ? [auth.key.mailbox_id] : []))
    .all<{ id: string; address: string; display_name: string; active: number }>();
  return apiJson({ data: results.map((m) => ({ ...m, active: !!m.active })) });
});

/* ---------- GET /api/v1/messages ---------- */

export const listHandler = withKey("read", async ({ request }, auth) => {
  const q = new URL(request.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];

  const mailboxParam = q.get("mailbox");
  if (mailboxParam) {
    const mb = await mailboxFor(auth, mailboxParam);
    if (!mb) return apiError(403, "mailbox_not_allowed", `This key can't read ${mailboxParam}.`);
    where.push("m.mailbox_id = ?");
    binds.push(mb.id);
  } else if (auth.key.mailbox_id) {
    where.push("m.mailbox_id = ?");
    binds.push(auth.key.mailbox_id);
  }
  const folder = q.get("folder") ?? "inbox";
  if (folder !== "all") {
    if (!isFolder(folder)) return apiError(422, "invalid_folder", "folder must be inbox, sent, archive, spam, trash or all.");
    where.push("m.folder = ?");
    binds.push(folder);
  }
  if (q.get("unread") === "true") where.push("m.is_read = 0");
  const since = q.get("since");
  if (since) {
    const t = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
    if (Number.isNaN(t)) return apiError(422, "invalid_since", "since must be an ISO date or epoch milliseconds.");
    where.push("m.date > ?");
    binds.push(t);
  }
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 25));

  const { results } = await env.DB.prepare(
    `SELECT m.*, b.address AS mailbox_address FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.date DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<MessageRow & { mailbox_address: string }>();
  const atts = await listAttachments(results.map((m) => m.id));
  return apiJson({
    data: results.map((m) => {
      const { text: _t, ...summary } = messageJson(m, m.mailbox_address, atts.filter((a) => a.message_id === m.id));
      return summary;
    }),
  });
});

/* ---------- GET / POST /api/v1/messages/:id ---------- */

export const messageHandler = withKey("read", async ({ params }, auth) => {
  const msg = await messageFor(auth, params.id);
  if (!msg) return apiError(404, "not_found", "No such message.");
  const mb = await env.DB.prepare("SELECT address FROM mailboxes WHERE id = ?").bind(msg.mailbox_id).first<{ address: string }>();
  return apiJson({
    data: {
      ...messageJson(msg, mb?.address ?? "", await listAttachments([msg.id])),
      // Raw HTML exactly as received. Never render it in a browser without sanitising it.
      html: await getHtmlBody(msg),
    },
  });
});

const ACTIONS: Record<string, string> = {
  read: "is_read = 1",
  unread: "is_read = 0",
  star: "is_starred = 1",
  unstar: "is_starred = 0",
  archive: "folder = 'archive'",
  trash: "folder = 'trash'",
  spam: "folder = 'spam'",
  inbox: "folder = CASE direction WHEN 'out' THEN 'sent' ELSE 'inbox' END",
};

export const messageActionHandler = withKey("read", async ({ params, request }, auth) => {
  const msg = await messageFor(auth, params.id);
  if (!msg) return apiError(404, "not_found", "No such message.");
  const b = await readJson(request);
  const action = typeof b?.action === "string" ? b.action : "";
  if (!ACTIONS[action]) return apiError(422, "invalid_action", `action must be one of: ${Object.keys(ACTIONS).join(", ")}.`);
  await env.DB.prepare(`UPDATE messages SET ${ACTIONS[action]} WHERE id = ?`).bind(msg.id).run();
  return apiJson({ id: msg.id, action, status: "ok" });
});

/* ---------- GET /api/v1/attachments/:id ---------- */

export const attachmentApiHandler = withKey("read", async ({ params }, auth) => {
  const att = await env.DB.prepare(
    `SELECT a.*, m.mailbox_id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = ?`,
  )
    .bind(params.id)
    .first<{ r2_key: string; filename: string; content_type: string; mailbox_id: string }>();
  if (!att || !keyAllowsMailbox(auth, att.mailbox_id)) return apiError(404, "not_found", "No such attachment.");
  const obj = await env.MAIL_BUCKET.get(att.r2_key);
  if (!obj) return apiError(404, "not_found", "Attachment content is missing.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": att.content_type || "application/octet-stream",
      "Content-Length": String(obj.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const apiNotFound = () => apiError(404, "not_found", "Unknown API route. See /admin/api for the reference.");
