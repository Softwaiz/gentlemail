import { env } from "cloudflare:workers";
import type { User } from "./auth";
import type { Addr } from "./util";

export type Folder = "inbox" | "sent" | "archive" | "trash" | "spam";
export const FOLDERS: { id: Folder; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "archive", label: "Archive" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Trash" },
];
export const isFolder = (f: string): f is Folder => FOLDERS.some((x) => x.id === f);

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

export async function listMailboxesForUser(user: User): Promise<(Mailbox & { unread: number })[]> {
  const base = `SELECT m.*, (SELECT COUNT(*) FROM messages x WHERE x.mailbox_id = m.id AND x.folder = 'inbox' AND x.is_read = 0) AS unread FROM mailboxes m`;
  const q =
    user.role === "admin"
      ? env.DB.prepare(`${base} ORDER BY m.address`)
      : env.DB.prepare(
          `${base} JOIN mailbox_members mm ON mm.mailbox_id = m.id WHERE mm.user_id = ? ORDER BY m.address`,
        ).bind(user.id);
  const { results } = await q.all<Mailbox & { unread: number }>();
  return results;
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
  if (!messageIds.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT * FROM attachments WHERE message_id IN (${messageIds.map(() => "?").join(",")}) ORDER BY created_at`,
  )
    .bind(...messageIds)
    .all<AttachmentRow>();
  return results;
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

export const allowedDomains = () =>
  (env.MAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
