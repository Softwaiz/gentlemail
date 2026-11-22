import { answer } from "../server";

export type { MailAction } from "../../../src/app/actions/mail";

const DONE: Record<string, string> = {
  archive: "Archived.",
  trash: "Moved to trash.",
  spam: "Marked as spam. Future mail from this sender goes to spam.",
  inbox: "Moved to inbox.",
  delete: "Deleted forever.",
};

export const updateMessages = async (input: { action: string; ids: string[] }) => {
  console.info("[fake] updateMessages", input);
  return answer({ ok: true as const, message: DONE[input.action] });
};
export const markThreadRead = async () => answer({ ok: true as const });
export const sendMessage = async () => answer({ ok: true as const, message: "Sent." }, "The message couldn't be sent.");
export const saveMailboxSettings = async () => answer({ ok: true as const, message: "Saved." });
export const removeSenderRule = async () => answer({ ok: true as const });
