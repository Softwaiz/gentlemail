import { env } from "cloudflare:workers";
import { newId, normalizeSubject, stripBrackets } from "./util";

/**
 * Finds the thread a message belongs to:
 *  1. In-Reply-To / References matching a stored Message-ID in the same mailbox
 *  2. Fallback: same normalized subject with the same counterpart in the last 30 days
 *     (Cloudflare generates outbound Message-IDs, so replies may not always match 1.)
 */
export async function resolveThreadId(opts: {
  mailboxId: string;
  inReplyTo?: string | null;
  references?: string | null;
  subject: string;
  counterpart?: string | null;
}): Promise<string> {
  const ids = [
    stripBrackets(opts.inReplyTo),
    ...(opts.references ?? "").split(/\s+/).map(stripBrackets),
  ].filter((x): x is string => !!x);

  if (ids.length) {
    const row = await env.DB.prepare(
      `SELECT thread_id FROM messages WHERE mailbox_id = ? AND message_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
    )
      .bind(opts.mailboxId, ...ids)
      .first<{ thread_id: string }>();
    if (row) return row.thread_id;
  }

  const isReply = /^\s*(re|aw|fwd?|tr)\s*:/i.test(opts.subject);
  const norm = normalizeSubject(opts.subject);
  if (isReply && norm && opts.counterpart) {
    const since = Date.now() - 30 * 24 * 3600 * 1000;
    const { results } = await env.DB.prepare(
      `SELECT thread_id, subject, from_addr, to_json FROM messages
       WHERE mailbox_id = ? AND date > ? AND (from_addr = ? COLLATE NOCASE OR to_json LIKE ?)
       ORDER BY date DESC LIMIT 50`,
    )
      .bind(opts.mailboxId, since, opts.counterpart, `%${opts.counterpart}%`)
      .all<{ thread_id: string; subject: string }>();
    const hit = results.find((r) => normalizeSubject(r.subject) === norm);
    if (hit) return hit.thread_id;
  }

  return newId();
}
