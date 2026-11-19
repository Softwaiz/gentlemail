/** The shapes GentleMail's API and webhooks send. Field names are the API's own (snake_case). */

export type Address = { name: string | null; address: string };

/** Where a message is filed. */
export type Folder = "inbox" | "sent" | "archive" | "spam" | "trash";

/** "organize" (marking and moving messages) exists from GentleMail 0.6.1; before, "read" allowed it. */
export type Permission = "read" | "organize" | "send";

export type Mailbox = {
  id: string;
  address: string;
  display_name: string;
  active: boolean;
  /** What this API key may do on the mailbox. */
  permissions: Permission[];
};

export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  /** An image shown inside the HTML body rather than a file attached to the message. */
  inline: boolean;
  /** Download address; needs a key with Read on the mailbox. */
  url: string;
};

/** A message as listed: everything but its text and HTML. */
export type MessageSummary = {
  id: string;
  thread_id: string;
  mailbox: { id: string; address: string };
  folder: Folder;
  direction: "inbound" | "outbound";
  from: Address;
  to: Address[];
  cc: Address[];
  reply_to: string | null;
  subject: string;
  /** ISO 8601. */
  date: string;
  message_id: string | null;
  in_reply_to: string | null;
  is_read: boolean;
  is_starred: boolean;
  snippet: string;
  has_html: boolean;
  attachments: Attachment[];
  url: string;
};

/** A message with its plain text, as in webhook events. */
export type MessageWithText = MessageSummary & {
  /** Up to 200,000 characters; see `text_truncated`. */
  text: string;
  text_truncated: boolean;
};

/** One message as `messages.get()` returns it. */
export type Message = MessageWithText & {
  /** The HTML exactly as received, or null. Sanitise it before showing it in a browser. */
  html: string | null;
};

export type MessageAction = "read" | "unread" | "star" | "unstar" | "archive" | "trash" | "spam" | "inbox";

export type ListMessagesOptions = {
  /** Only this mailbox's address. Without it, every mailbox the key can read. */
  mailbox?: string;
  /** Default `inbox`. */
  folder?: Folder | "all";
  /** Only unread messages. */
  unread?: boolean;
  /** Only messages after this moment: a Date, epoch milliseconds or an ISO 8601 string. */
  since?: Date | number | string;
  /** 1 to 100, default 25. */
  limit?: number;
};

/** A recipient: "a@b.c", "Name <a@b.c>" or { address, name }. */
export type Recipient = string | { address: string; name?: string };

export type OutgoingAttachment = {
  filename: string;
  /** The file: bytes, or a base64 string. */
  content: Uint8Array | ArrayBuffer | string;
  content_type?: string;
};

export type SendOptions = {
  /** Address of a mailbox the key can send from. */
  from: string;
  to?: Recipient | Recipient[];
  cc?: Recipient | Recipient[];
  bcc?: Recipient | Recipient[];
  subject?: string;
  /** At least one of text and html. With only HTML, a plain-text version is made for you. */
  text?: string;
  html?: string;
  /** Up to 25 MB in all. */
  attachments?: OutgoingAttachment[];
  /** Reply in this message's thread. `to` then defaults to its sender. Needs Read on the mailbox too. */
  reply_to_message_id?: string;
  /** With a reply, quote the original below your text. */
  quote?: boolean;
  /** Append the mailbox's signature. */
  signature?: boolean;
};

export type SendResult = { id: string; thread_id: string; from: string; status: "sent" };

/* ---------- Webhooks ---------- */

type EventBase<E extends string, D> = {
  /** The delivery id: the same event can arrive more than once, so skip ids you've handled. */
  id: string;
  event: E;
  /** ISO 8601. */
  created_at: string;
  data: D;
};

export type MessageReceivedEvent = EventBase<"message.received", MessageWithText>;
export type MessageSentEvent = EventBase<"message.sent", MessageWithText>;
/** Sent by "Send test" on a webhook's page. */
export type PingEvent = EventBase<"ping", { webhook: string }>;

export type WebhookEvent = MessageReceivedEvent | MessageSentEvent | PingEvent;
