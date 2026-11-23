import type { ActionResult } from "@/app/actions/guards";
import type { MailAction } from "@/app/actions/mail";
import { isEmail, parseAddressList } from "@/lib/util";
import { answer } from "../server";

/*
 * Specific answers for src/app/actions/mail.ts, worded as there. The other actions get the
 * generated fake. What the app looks up in the database, these take from their input.
 */

const DONE: Partial<Record<MailAction, string>> = {
  archive: "Archived.",
  trash: "Moved to trash.",
  spam: "Marked as spam. Future mail from this sender goes to spam.",
  inbox: "Moved to inbox.",
  delete: "Deleted forever.",
};

type Update = { mailboxId: string; ids: string[]; scope: "thread" | "message"; folder?: string; action: MailAction };

export const updateMessages = async (input: Update): Promise<ActionResult> => {
  console.info("[fake] updateMessages", input);
  if (!input.ids.length) return answer({ ok: false, error: "Select at least one conversation." });
  const notSpam = input.action === "inbox" && input.folder === "spam";
  return answer({ ok: true, message: notSpam ? "Not spam. Mail from this sender stays in the inbox." : DONE[input.action] });
};

export const sendMessage = async (form: FormData): Promise<ActionResult> => {
  const field = (name: string) => String(form.get(name) ?? "").trim();
  console.info("[fake] sendMessage", field("mode") || "new");
  const to = [field("to"), field("cc"), field("bcc")].flatMap(parseAddressList);
  if (!to.length) return answer({ ok: false, error: "Add at least one recipient." });
  const bad = to.find((a) => !isEmail(a.address));
  if (bad) return answer({ ok: false, error: `${bad.address} isn't a valid address.` });
  const mailbox = `/mb/${field("mailbox_id")}`;
  const sent: ActionResult =
    field("mode") === "reply" && field("original")
      ? { ok: true, message: "Reply sent.", redirect: `${mailbox}/thread/${field("original")}?f=inbox` }
      : { ok: true, message: "Message sent.", redirect: `${mailbox}/sent` };
  return answer(sent, "Sending failed. Try again in a moment.");
};
