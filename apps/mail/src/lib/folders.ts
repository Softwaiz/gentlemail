// Folder names, for server and browser alike (lib/db.ts is server-only).
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/lib/i18n";

type Folder = "inbox" | "sent" | "archive" | "trash" | "spam";

const FOLDER_NAMES: Record<Folder, MessageDescriptor> = {
  inbox: msg({ id: "folder.inbox", message: "Inbox" }),
  sent: msg({ id: "folder.sent", message: "Sent" }),
  archive: msg({ id: "folder.archive", message: "Archive" }),
  spam: msg({ id: "folder.spam", message: "Spam" }),
  trash: msg({ id: "folder.trash", message: "Trash" }),
};
/** A folder's name, in the reader's language; an unknown id is shown as it is. */
export const folderName = (f: string) => f in FOLDER_NAMES ? i18n._(FOLDER_NAMES[f as Folder]) : f;
