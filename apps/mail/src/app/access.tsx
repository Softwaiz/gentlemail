import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { redirect } from "@/app/http";
import { showError } from "@/app/pages/errors";
import { getMailboxForUser, isFolder } from "@/lib/db";

/*
 * Route middleware for pages. It runs before the page renders, so it can set
 * the HTTP status (404 / 403) of the error page it returns. Server actions
 * check access again on their own (src/app/actions/guards.ts).
 */

export function requireAdmin(ri: RequestInfo) {
  if (!ri.ctx.user) return redirect("/login");
  if (ri.ctx.user.role !== "admin") return showError(ri, "admin-restricted");
}

/** /mb/:mailboxId/…: "Mailbox not found" if it doesn't exist, "Access restricted" if it isn't yours. */
export async function requireMailbox(ri: RequestInfo) {
  const id = ri.params.mailboxId;
  if (await getMailboxForUser(ri.ctx.user!, id)) return;
  const exists = await env.DB.prepare("SELECT 1 FROM mailboxes WHERE id = ?").bind(id).first();
  return showError(ri, exists ? "mailbox-restricted" : "mailbox");
}

export function requireFolder(ri: RequestInfo) {
  if (!isFolder(ri.params.folder)) return showError(ri, "page", ri.params.mailboxId);
}

/** A conversation that has no message left at all in this mailbox. */
export async function requireThread(ri: RequestInfo) {
  if (ri.isAction) return; // the page handles a thread that the action just deleted
  const found = await env.DB.prepare("SELECT 1 FROM messages WHERE mailbox_id = ? AND thread_id = ? LIMIT 1")
    .bind(ri.params.mailboxId, ri.params.threadId)
    .first();
  if (!found) return showError(ri, "message", ri.params.mailboxId);
}

/** Admin pages for one record (/admin/domains/:id, …). */
export const requireRecord =
  (table: "domains" | "mailboxes" | "webhooks", kind: "domain" | "mailbox" | "webhook") => async (ri: RequestInfo) => {
    if (ri.isAction) return; // the page handles a record that the action just deleted
    const found = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(ri.params.id).first();
    if (!found) return showError(ri, kind);
  };

/** Last route: anything that matched nothing else. */
export const pageNotFound = (ri: RequestInfo) => showError(ri, "page");
