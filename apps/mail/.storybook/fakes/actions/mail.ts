import { answer } from "../server";

/* Specific answers for src/app/actions/mail.ts. The other actions there get the generated fake. */

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

export const sendMessage = async (input: unknown) => {
  console.info("[fake] sendMessage", input);
  return answer({ ok: true as const, message: "Sent." }, "The message couldn't be sent.");
};
