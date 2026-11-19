import { env } from "cloudflare:workers";
import { chunks } from "./util";
import type { User } from "./auth";
import { type Addr, domainOf } from "./util";

export { domainOf };

export type Folder = "inbox" | "sent" | "archive" | "trash" | "spam";
export const FOLDERS: { id: Folder; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "archive", label: "Archive" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Trash" },
];
const FOLDER_IDS: ReadonlySet<string> = new Set(FOLDERS.map((f) => f.id));
export const isFolder = (f: string): f is Folder => FOLDER_IDS.has(f);

export type Mailbox = {
  id: string;
  address: string;
  display_name: string;
  signature: string;
  active: number;
  created_at: number;
};

export type MessageRow = {
  id: string;
  mailbox_id: string;
  thread_id: string;
  folder: Folder;
  direction: "in" | "out";
  message_id: string | null;
  in_reply_to: string | null;
  references_hdr: string | null;
  from_addr: string;
  from_name: string;
  to_json: string;
  cc_json: string;
  bcc_json: string;
  reply_to: string | null;
  subject: string;
  snippet: string;
  text_body: string | null;
  html_body: string | null;
  html_key: string | null;
  raw_key: string | null;
  size: number;
  has_attachments: number;
  is_read: number;
  is_starred: number;
  date: number;
  spam_reason: string | null;
};

export type AttachmentRow = {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
  content_id: string | null;
  disposition: string;
};

export const parseAddrs = (json: string): Addr[] => {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
};

/** `list` without `exclude` (the mailbox's own address), empty addresses or repeats. */
const uniqAddrs = (list: Addr[], exclude: string) => {
  const seen = new Set([exclude.toLowerCase()]);
  return list.filter((a) => {
    const k = a.address?.toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Who a reply goes to, as the webmail answers: the sender of a message received,
 * the recipients of one sent from this mailbox. Reply-all adds everyone else in
 * To and Cc as cc. The mailbox itself is never a recipient.
 */
export function replyRecipients(
  original: Pick<MessageRow, "direction" | "from_name" | "from_addr" | "reply_to" | "to_json" | "cc_json">,
  mailboxAddress: string,
  all = false,
): { to: Addr[]; cc: Addr[] } {
  const target =
    original.direction === "out" ? parseAddrs(original.to_json) : [{ name: original.from_name, address: original.reply_to || original.from_addr }];
  const to = uniqAddrs(target, mailboxAddress);
  if (!all) return { to, cc: [] };
  const already = new Set(to.map((a) => a.address.toLowerCase()));
  const cc = uniqAddrs(
    [...parseAddrs(original.to_json), ...parseAddrs(original.cc_json)].filter((a) => !already.has(a.address?.toLowerCase())),
    mailboxAddress,
  );
  return { to, cc };
}

/** The mailboxes a person sees: every one for an admin, otherwise those they're a member of. `columns` of `m`. */
const mailboxesForUser = (user: User, columns: string) =>
  user.role === "admin"
    ? env.DB.prepare(`SELECT ${columns} FROM mailboxes m ORDER BY m.address`)
    : env.DB.prepare(`SELECT ${columns} FROM mailboxes m JOIN mailbox_members mm ON mm.mailbox_id = m.id WHERE mm.user_id = ? ORDER BY m.address`).bind(
        user.id,
      );

export async function listMailboxesForUser(user: User): Promise<(Mailbox & { unread: number })[]> {
  const unread = "(SELECT COUNT(*) FROM messages x WHERE x.mailbox_id = m.id AND x.folder = 'inbox' AND x.is_read = 0) AS unread";
  return (await mailboxesForUser(user, `m.*, ${unread}`).all<Mailbox & { unread: number }>()).results;
}

/** The same mailboxes, ids and addresses only (no unread counts). */
export async function listMailboxAddressesForUser(user: User): Promise<{ id: string; address: string }[]> {
  return (await mailboxesForUser(user, "m.id, m.address").all<{ id: string; address: string }>()).results;
}

/** Returns the mailbox if the user may access it, otherwise null. */
export async function getMailboxForUser(user: User, mailboxId: string): Promise<Mailbox | null> {
  if (user.role === "admin") {
    return env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(mailboxId).first<Mailbox>();
  }
  return env.DB.prepare(
    `SELECT m.* FROM mailboxes m JOIN mailbox_members mm ON mm.mailbox_id = m.id
     WHERE m.id = ? AND mm.user_id = ?`,
  )
    .bind(mailboxId, user.id)
    .first<Mailbox>();
}

export async function getMessageForUser(user: User, messageId: string) {
  const msg = await env.DB.prepare("SELECT * FROM messages WHERE id = ?")
    .bind(messageId)
    .first<MessageRow>();
  if (!msg) return null;
  const mailbox = await getMailboxForUser(user, msg.mailbox_id);
  if (!mailbox) return null;
  return { msg, mailbox };
}

export async function listAttachments(messageIds: string[]): Promise<AttachmentRow[]> {
  const out: AttachmentRow[] = [];
  for (const part of chunks(messageIds)) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM attachments WHERE message_id IN (${part.map(() => "?").join(",")}) ORDER BY created_at`,
    )
      .bind(...part)
      .all<AttachmentRow>();
    out.push(...results);
  }
  return out;
}

export async function getHtmlBody(msg: MessageRow): Promise<string | null> {
  if (msg.html_body) return msg.html_body;
  if (msg.html_key) {
    const obj = await env.MAIL_BUCKET.get(msg.html_key);
    return obj ? obj.text() : null;
  }
  return null;
}

/** Deletes a message and its R2 objects. */
export async function deleteMessageForever(msg: MessageRow) {
  const atts = await listAttachments([msg.id]);
  const keys = [...atts.map((a) => a.r2_key), msg.raw_key, msg.html_key].filter(
    (k): k is string => !!k,
  );
  if (keys.length) await env.MAIL_BUCKET.delete(keys);
  await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(msg.id).run();
}

export type Domain = { id: string; name: string; active: number; created_at: number };

export async function listDomains(activeOnly = false): Promise<Domain[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM domains ${activeOnly ? "WHERE active = 1" : ""} ORDER BY name`,
  ).all<Domain>();
  return results;
}

export async function isDomainActive(name: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM domains WHERE name = ? AND active = 1").bind(name).first();
  return !!row;
}

export type SwitcherGroup = {
  domain: string;
  mailboxes: { id: string; address: string; name: string; unread: number; active: boolean }[];
};

/** Mailboxes a user can open, grouped by domain, with inbox unread counts. */
export async function switcherGroups(user: User): Promise<SwitcherGroup[]> {
  const groups = new Map<string, SwitcherGroup>();
  for (const m of await listMailboxesForUser(user)) {
    const d = domainOf(m.address);
    if (!groups.has(d)) groups.set(d, { domain: d, mailboxes: [] });
    groups.get(d)!.mailboxes.push({ id: m.id, address: m.address, name: m.display_name, unread: m.unread, active: !!m.active });
  }
  return [...groups.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Unread messages per folder of one mailbox. */
export async function unreadByFolder(mailboxId: string): Promise<Partial<Record<Folder, number>>> {
  const { results } = await env.DB.prepare(
    "SELECT folder, COUNT(*) AS n FROM messages WHERE mailbox_id = ? AND is_read = 0 GROUP BY folder",
  )
    .bind(mailboxId)
    .all<{ folder: Folder; n: number }>();
  return Object.fromEntries(results.map((r) => [r.folder, r.n]));
}

/**
 * SQL condition for a search, for the webmail and the API: the words anywhere in
 * the subject, sender, To, Cc or text of message `m`. % and _ match themselves.
 */
export function searchSql(term: string): { sql: string; binds: string[] } {
  const like = `%${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const columns = ["m.subject", "m.from_addr", "m.from_name", "m.to_json", "m.cc_json", "m.text_body"];
  return { sql: `(${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`, binds: columns.map(() => like) };
}
