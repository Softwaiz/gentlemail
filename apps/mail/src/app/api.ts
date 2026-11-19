import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { type ApiAuth, type Scope, apiError, apiJson, authenticate, can, coveredMailboxes } from "@/lib/apikeys";
import { type Mailbox, type MessageRow, getHtmlBody, isFolder, listAttachments, replyRecipients, searchSql } from "@/lib/db";
import { SendError, type OutgoingFile, sendMail } from "@/lib/outbound";
import { type Addr, htmlToText, isEmail, parseAddressList } from "@/lib/util";
import { messageJson } from "@/lib/webhooks";

/*
 * Public HTTP API, authenticated with API keys created in Admin → API & webhooks.
 *   POST /api/v1/send                 send (scope: send)
 *   GET  /api/v1/mailboxes            mailboxes this key can use, with its permissions on each
 *   GET  /api/v1/messages             list and search (scope: read)
 *   GET  /api/v1/messages/:id         one message with text and HTML (scope: read)
 *   POST /api/v1/messages/:id         mark read/unread, archive, trash, star… (scope: organize)
 *   GET  /api/v1/attachments/:id      attachment bytes (scope: read)
 *
 * A key's access is a set of grants (all mailboxes, a domain, a mailbox), each
 * with read, organize and/or send; every request is checked against the mailbox it touches.
 *
 * The work itself is in the functions below the handlers (sendMessage,
 * listMessages…), which take an authenticated key and return the response;
 * the MCP endpoint (src/app/mcp.ts) calls the same ones.
 */

type Handler = (info: RequestInfo, auth: ApiAuth) => Promise<Response>;

/** Wraps a handler with key auth; `scope: null` accepts a key with any permission. */
const withKey =
  (scope: Scope | null, fn: Handler) =>
  async (info: RequestInfo): Promise<Response> => {
    const auth = await authenticate(info.request, scope);
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

export async function mailboxFor(auth: ApiAuth, address: string, scope: Scope) {
  const mb = await env.DB.prepare("SELECT * FROM mailboxes WHERE address = ? COLLATE NOCASE").bind(address.trim()).first<Mailbox>();
  if (!mb || !can(auth, mb, scope)) return null;
  return mb;
}

/** A message with its mailbox's address, whoever may see it (check with can()). */
const loadMessage = (id: string) =>
  env.DB.prepare("SELECT m.*, b.address AS mailbox_address FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id WHERE m.id = ?")
    .bind(id)
    .first<MessageRow & { mailbox_address: string }>();

const mailboxOf = (msg: MessageRow & { mailbox_address: string }) => ({ id: msg.mailbox_id, address: msg.mailbox_address });

export async function messageFor(auth: ApiAuth, id: string, scope: Scope) {
  const msg = await loadMessage(id);
  if (!msg || !can(auth, mailboxOf(msg), scope)) return null;
  return msg;
}

/** The mailboxes this key can do something on, with what it can do there. */
async function usableMailboxes(auth: ApiAuth) {
  const covered = coveredMailboxes(auth);
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.address, b.display_name, b.active,
       MAX(g.can_read) AS can_read, MAX(g.can_organize) AS can_organize, MAX(g.can_send) AS can_send
     FROM ${covered.sql}
     GROUP BY b.id HAVING MAX(g.can_read) = 1 OR MAX(g.can_organize) = 1 OR MAX(g.can_send) = 1
     ORDER BY b.address`,
  )
    .bind(...covered.binds)
    .all<{ id: string; address: string; display_name: string; active: number; can_read: number; can_organize: number; can_send: number }>();
  return results;
}

/* ---------- POST /api/v1/send ---------- */

export const sendHandler = withKey("send", async ({ request }, auth) => sendMessage(auth, await readJson(request)));

/** `loaded`: the message being answered, when the caller already fetched it with messageFor(auth, id, "read"). */
export async function sendMessage(auth: ApiAuth, b: Record<string, unknown> | null, loaded?: MessageRow & { mailbox_address: string }) {
  if (!b) return apiError(400, "invalid_json", "Send a JSON object body.");

  if (typeof b.from !== "string") return apiError(422, "invalid_from", '"from" must be the address of one of your mailboxes.');
  const mailbox = await mailboxFor(auth, b.from, "send");
  if (!mailbox) return apiError(403, "mailbox_not_allowed", `This key can't send from ${b.from}.`);
  if (!mailbox.active) return apiError(422, "mailbox_disabled", `${mailbox.address} is disabled.`);

  // Optional threading: reply to a message stored in this mailbox. A reply
  // quotes and threads the original, so the key must also be able to read it.
  let original: MessageRow | null = null;
  if (b.reply_to_message_id != null) {
    if (!can(auth, mailbox, "read"))
      return apiError(403, "read_required", `Replying needs the "read" permission on ${mailbox.address}.`);
    const id = String(b.reply_to_message_id);
    original = loaded?.id === id ? loaded : await messageFor(auth, id, "read");
    if (!original || original.mailbox_id !== mailbox.id)
      return apiError(404, "original_not_found", "reply_to_message_id isn't a message in this mailbox.");
  }

  let to = toAddrs(b.to);
  const cc = toAddrs(b.cc);
  const bcc = toAddrs(b.bcc);
  if (!to || !cc || !bcc) return apiError(422, "invalid_recipient", "to, cc and bcc must hold valid email addresses.");
  // No recipients given: as the webmail answers (the sender, or for a message sent from here, its recipients).
  if (!to.length && original) to = replyRecipients(original, mailbox.address).to;

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
}

/* ---------- GET /api/v1/mailboxes ---------- */

export const mailboxesHandler = withKey(null, async (_info, auth) => listMailboxes(auth));

export async function listMailboxes(auth: ApiAuth) {
  const mailboxes = await usableMailboxes(auth);
  return apiJson({
    data: mailboxes.map(({ can_read, can_organize, can_send, ...m }) => ({
      ...m,
      active: !!m.active,
      permissions: [...(can_read ? ["read"] : []), ...(can_organize ? ["organize"] : []), ...(can_send ? ["send"] : [])],
    })),
  });
}

/* ---------- GET /api/v1/messages ---------- */

export const listHandler = withKey("read", async ({ request }, auth) => listMessages(auth, new URL(request.url).searchParams));

/** SQL condition: message `m` is in a mailbox this key may read (no limit on how many). */
export function readableSql(auth: ApiAuth): { sql: string; binds: unknown[] } {
  const covered = coveredMailboxes(auth);
  return { sql: `m.mailbox_id IN (SELECT b.id FROM ${covered.sql} WHERE g.can_read = 1)`, binds: covered.binds };
}

/** `skipJunk`: with folder=all, leave out spam and trash (the MCP search's default). */
export async function listMessages(auth: ApiAuth, q: URLSearchParams, opts: { skipJunk?: boolean } = {}) {
  const where: string[] = [];
  const binds: unknown[] = [];

  const mailboxParam = q.get("mailbox");
  if (mailboxParam) {
    const mb = await mailboxFor(auth, mailboxParam, "read");
    if (!mb) return apiError(403, "mailbox_not_allowed", `This key can't read ${mailboxParam}.`);
    where.push("m.mailbox_id = ?");
    binds.push(mb.id);
  } else {
    // Only the mailboxes this key may read, worked out in SQL (no limit on how many).
    const readable = readableSql(auth);
    where.push(readable.sql);
    binds.push(...readable.binds);
  }
  const folder = q.get("folder") ?? "inbox";
  if (folder !== "all") {
    if (!isFolder(folder)) return apiError(422, "invalid_folder", "folder must be inbox, sent, archive, spam, trash or all.");
    where.push("m.folder = ?");
    binds.push(folder);
  } else if (opts.skipJunk) where.push("m.folder NOT IN ('spam', 'trash')");
  if (q.get("unread") === "true") where.push("m.is_read = 0");
  // The webmail's search.
  const search = (q.get("q") ?? "").trim().slice(0, 200);
  if (search) {
    const s = searchSql(search);
    where.push(s.sql);
    binds.push(...s.binds);
  }
  const since = q.get("since");
  if (since) {
    const t = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
    if (Number.isNaN(t)) return apiError(422, "invalid_since", "since must be an ISO date or epoch milliseconds.");
    where.push("m.date > ?");
    binds.push(t);
  }
  // Out-of-range values are brought within 1–100 (0 gives 1); a missing or unreadable one gives 25.
  const raw = q.get("limit")?.trim();
  const asked = raw ? Number(raw) : Number.NaN;
  const limit = Number.isNaN(asked) ? 25 : Math.min(100, Math.max(1, Math.trunc(asked)));

  const { results } = await env.DB.prepare(
    `SELECT m.*, b.address AS mailbox_address FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.date DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<MessageRow & { mailbox_address: string }>();
  // Group the page's attachments by message once, instead of filtering them all for each message.
  const attsByMessage = new Map<string, Awaited<ReturnType<typeof listAttachments>>>();
  for (const a of await listAttachments(results.map((m) => m.id))) {
    const list = attsByMessage.get(a.message_id);
    if (list) list.push(a);
    else attsByMessage.set(a.message_id, [a]);
  }
  return apiJson({
    data: results.map((m) => {
      const { text: _t, ...summary } = messageJson(m, m.mailbox_address, attsByMessage.get(m.id) ?? []);
      return summary;
    }),
  });
}

/* ---------- GET / POST /api/v1/messages/:id ---------- */

export const messageHandler = withKey("read", async ({ params }, auth) => getMessage(auth, params.id));

export async function getMessage(auth: ApiAuth, id: string) {
  const msg = await messageFor(auth, id, "read");
  if (!msg) return apiError(404, "not_found", "No such message.");
  return apiJson({
    data: {
      ...messageJson(msg, msg.mailbox_address, await listAttachments([msg.id])),
      // Raw HTML exactly as received. Never render it in a browser without sanitising it.
      html: await getHtmlBody(msg),
    },
  });
}

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

export const MESSAGE_ACTIONS = Object.keys(ACTIONS);

// Any key: actOnMessage() answers with what is missing (organize_required, forbidden or not found).
export const messageActionHandler = withKey(null, async ({ params, request }, auth) => {
  const b = await readJson(request);
  return actOnMessage(auth, params.id, typeof b?.action === "string" ? b.action : "");
});

export async function actOnMessage(auth: ApiAuth, id: string, action: string) {
  const msg = await loadMessage(id);
  if (!msg || !can(auth, mailboxOf(msg), "organize")) {
    // One it can see but not file: say what's missing, as a reply does for read. This is
    // what a key from before Organize existed gets, so it's checked before "no organize at all".
    if (msg && can(auth, mailboxOf(msg), "read"))
      return apiError(403, "organize_required", `Marking and moving messages needs the "organize" permission on ${msg.mailbox_address}.`);
    if (!auth.can.organize) return apiError(403, "forbidden", 'This key has no "organize" permission on any mailbox.');
    return apiError(404, "not_found", "No such message.");
  }
  if (!ACTIONS[action]) return apiError(422, "invalid_action", `action must be one of: ${Object.keys(ACTIONS).join(", ")}.`);
  await env.DB.prepare(`UPDATE messages SET ${ACTIONS[action]} WHERE id = ?`).bind(msg.id).run();
  return apiJson({ id: msg.id, action, status: "ok" });
}

/* ---------- GET /api/v1/attachments/:id ---------- */

export const attachmentApiHandler = withKey("read", async ({ params }, auth) => {
  const att = await env.DB.prepare(
    `SELECT a.*, m.mailbox_id, b.address AS mailbox_address FROM attachments a
     JOIN messages m ON m.id = a.message_id JOIN mailboxes b ON b.id = m.mailbox_id WHERE a.id = ?`,
  )
    .bind(params.id)
    .first<{ r2_key: string; filename: string; content_type: string; mailbox_id: string; mailbox_address: string }>();
  if (!att || !can(auth, { id: att.mailbox_id, address: att.mailbox_address }, "read")) return apiError(404, "not_found", "No such attachment.");
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
