import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import type { ActionResult } from "@/app/actions/guards";
import type { MailAction } from "@/app/actions/mail";
import { i18n } from "@/lib/i18n";
import { isEmail, parseAddressList } from "@/lib/util";
import { answer } from "../server";

/*
 * Specific answers for src/app/actions/mail.ts, with the same translation keys. The other actions get
 * the generated fake. What the app looks up in the database, these take from their input.
 */

const DONE: Partial<Record<MailAction, MessageDescriptor>> = {
  archive: msg({ id: "done.archive", message: "Archived." }),
  trash: msg({ id: "done.trash", message: "Moved to trash." }),
  spam: msg({ id: "done.spam", message: "Marked as spam. Future mail from this sender goes to spam." }),
  inbox: msg({ id: "done.inbox", message: "Moved to inbox." }),
  delete: msg({ id: "done.delete", message: "Deleted forever." }),
};

type Update = { mailboxId: string; ids: string[]; scope: "thread" | "message"; folder?: string; action: MailAction };

export const updateMessages = async (input: Update): Promise<ActionResult> => {
  console.info("[fake] updateMessages", input);
  if (!input.ids.length) return answer({ ok: false, error: t({ id: "errors.select_one", message: "Select at least one conversation." }) });
  const notSpam = input.action === "inbox" && input.folder === "spam";
  if (notSpam) return answer({ ok: true, message: t({ id: "done.not_spam", message: "Not spam. Mail from this sender stays in the inbox." }) });
  const done = DONE[input.action];
  return answer({ ok: true, message: done && i18n._(done) });
};

export const sendMessage = async (form: FormData): Promise<ActionResult> => {
  const field = (name: string) => String(form.get(name) ?? "").trim();
  console.info("[fake] sendMessage", field("mode") || "new");
  const to = [field("to"), field("cc"), field("bcc")].flatMap(parseAddressList);
  if (!to.length) return answer({ ok: false, error: t({ id: "errors.no_recipient", message: "Add at least one recipient." }) });
  const bad = to.find((a) => !isEmail(a.address));
  if (bad) return answer({ ok: false, error: t({ id: "errors.bad_address", message: `${bad.address} isn't a valid address.` }) });
  const mailbox = `/mb/${field("mailbox_id")}`;
  const sent: ActionResult =
    field("mode") === "reply" && field("original")
      ? { ok: true, message: t({ id: "done.reply_sent", message: "Reply sent." }), redirect: `${mailbox}/thread/${field("original")}?f=inbox` }
      : { ok: true, message: t({ id: "done.sent", message: "Message sent." }), redirect: `${mailbox}/sent` };
  return answer(sent, t({ id: "errors.send_failed", message: "Sending failed. Try again in a moment." }));
};
