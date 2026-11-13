"use server";

import { env } from "cloudflare:workers";
import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, fail, ok, signedIn, text } from "@/app/actions/guards";
import { type MessageRow, deleteMessageForever, getMailboxForUser, isFolder } from "@/lib/db";
import { SendError, sendMail } from "@/lib/outbound";
import { learnFrom } from "@/lib/spam";
import { isEmail, parseAddressList } from "@/lib/util";

/* Mailbox mutations. signedIn runs first; each action then checks access to the mailbox. */

const mailboxFor = (id: string) => getMailboxForUser(requestInfo.ctx.user!, id);

export type MailAction = "read" | "unread" | "star" | "unstar" | "archive" | "trash" | "spam" | "inbox" | "delete";

const DONE: Partial<Record<MailAction, string>> = {
  archive: "Archived.",
  trash: "Moved to trash.",
  spam: "Marked as spam. Future mail from this sender goes to spam.",
  inbox: "Moved to inbox.",
  delete: "Deleted forever.",
};

export const updateMessages = serverAction([
  signedIn,
  async (input: {
    mailboxId: string;
    /** Thread ids (scope "thread") or message ids (scope "message"). */
    ids: string[];
    scope: "thread" | "message";
    /** For threads: only touch the messages in this folder. */
    folder?: string;
    action: MailAction;
  }): Promise<ActionResult> => {
    const mailbox = await mailboxFor(input.mailboxId);
    if (!mailbox) return fail("You don't have access to this mailbox.");
    const ids = input.ids.filter(Boolean).slice(0, 500);
    if (!ids.length) return fail("Select at least one conversation.");

    const col = input.scope === "message" ? "id" : "thread_id";
    const inFolder = input.scope === "thread" && input.folder && isFolder(input.folder);
    const { results: msgs } = await env.DB.prepare(
      `SELECT * FROM messages WHERE mailbox_id = ? AND ${col} IN (${ids.map(() => "?").join(",")}) ${inFolder ? "AND folder = ?" : ""}`,
    )
      .bind(mailbox.id, ...ids, ...(inFolder ? [input.folder] : []))
      .all<MessageRow>();
    if (!msgs.length) return ok();
    const msgIds = msgs.map((m) => m.id);
    const ph = msgIds.map(() => "?").join(",");
    const update = (set: string, ...vals: unknown[]) =>
      env.DB.prepare(`UPDATE messages SET ${set} WHERE id IN (${ph})`).bind(...vals, ...msgIds).run();

    switch (input.action) {
      case "read":
        await update("is_read = 1");
        break;
      case "unread":
        await update("is_read = 0");
        break;
      case "star":
        await update("is_starred = 1");
        break;
      case "unstar":
        await update("is_starred = 0");
        break;
      case "archive":
      case "trash":
        await update("folder = ?", input.action);
        break;
      case "spam":
        await update("folder = 'spam', is_read = 1, spam_reason = ?", "You marked it as spam, so this sender is blocked.");
        await learnFrom(msgs, "block");
        break;
      case "inbox":
        // Out of spam means "not spam": trust the sender from now on.
        if (msgs.some((m) => m.folder === "spam")) await learnFrom(msgs.filter((m) => m.folder === "spam"), "allow");
        await update("folder = CASE direction WHEN 'out' THEN 'sent' ELSE 'inbox' END, spam_reason = NULL");
        break;
      case "delete":
        for (const m of msgs) if (m.folder === "trash" || m.folder === "spam") await deleteMessageForever(m);
        break;
      default:
        return fail("Unknown action.");
    }
    if (input.action === "inbox" && msgs.some((m) => m.folder === "spam")) return ok("Not spam. Mail from this sender stays in the inbox.");
    return ok(DONE[input.action]);
  },
]);

export const sendMessage = serverAction([
  signedIn,
  async (form: FormData): Promise<ActionResult> => {
    const mailbox = await mailboxFor(text(form, "mailbox_id"));
    if (!mailbox) return fail("You don't have access to this mailbox.");
    if (!mailbox.active) return fail("This mailbox is turned off, so it can't send.");

    const to = parseAddressList(text(form, "to"));
    const cc = parseAddressList(text(form, "cc"));
    const bcc = parseAddressList(text(form, "bcc"));
    if (!to.length && !cc.length && !bcc.length) return fail("Add at least one recipient.");
    const bad = [...to, ...cc, ...bcc].find((a) => !isEmail(a.address));
    if (bad) return fail(`${bad.address} isn't a valid address.`);

    const files = [];
    let total = 0;
    for (const f of form.getAll("files")) {
      if (typeof f === "string" || !f.size) continue;
      total += f.size;
      files.push({ filename: f.name, type: f.type, content: await f.arrayBuffer() });
    }
    if (total > 25 * 1024 * 1024) return fail("Attachments are limited to 25 MB in total.");

    const originalId = text(form, "original");
    const original = originalId
      ? await env.DB.prepare("SELECT * FROM messages WHERE id = ? AND mailbox_id = ?").bind(originalId, mailbox.id).first<MessageRow>()
      : null;
    const modeRaw = text(form, "mode");
    const mode = modeRaw === "reply" || modeRaw === "forward" ? modeRaw : null;

    try {
      await sendMail({
        mailbox,
        to,
        cc,
        bcc,
        subject: text(form, "subject"),
        body: String(form.get("body") ?? ""),
        includeSignature: form.get("signature") === "on",
        files,
        original,
        mode,
      });
    } catch (e) {
      return fail(e instanceof SendError ? e.message : "Sending failed. Try again in a moment.");
    }
    if (original && mode === "reply") {
      return ok("Reply sent.", { redirect: `/mb/${mailbox.id}/thread/${original.thread_id}?f=${original.folder}` });
    }
    return ok("Message sent.", { redirect: `/mb/${mailbox.id}/sent` });
  },
]);

export const saveMailboxSettings = serverAction([
  signedIn,
  async (form: FormData): Promise<ActionResult> => {
    const mailbox = await mailboxFor(text(form, "mailbox_id"));
    if (!mailbox) return fail("You don't have access to this mailbox.");
    await env.DB.prepare("UPDATE mailboxes SET display_name = ?, signature = ? WHERE id = ?")
      .bind(text(form, "display_name") || mailbox.display_name, String(form.get("signature") ?? "").slice(0, 5000), mailbox.id)
      .run();
    return ok("Settings saved.");
  },
]);

export const removeSenderRule = serverAction([
  signedIn,
  async (mailboxId: string, ruleId: string): Promise<ActionResult> => {
    const mailbox = await mailboxFor(mailboxId);
    if (!mailbox) return fail("You don't have access to this mailbox.");
    await env.DB.prepare("DELETE FROM sender_rules WHERE id = ? AND mailbox_id = ?").bind(ruleId, mailbox.id).run();
    return ok("Sender removed from the list.");
  },
]);
