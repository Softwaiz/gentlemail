import type {
  ListMessagesOptions,
  Mailbox,
  Message,
  MessageAction,
  MessageSummary,
  OutgoingAttachment,
  SendOptions,
  SendResult,
} from "./types.js";

export type GentleMailOptions = {
  /** Your GentleMail's address, for example "https://mail.example.com". */
  url: string;
  /** An API key (gm_…) from Admin → API & webhooks. */
  apiKey: string;
  /** A fetch to use instead of the global one (tests, proxies). */
  fetch?: typeof fetch;
};

/** An error answered by the API. `code` is stable; switch on it. */
export class GentleMailError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GentleMailError";
    this.status = status;
    this.code = code;
  }
}

/**
 * A client for one GentleMail instance.
 *
 * ```ts
 * const mail = new GentleMail({ url: "https://mail.example.com", apiKey: env.GENTLEMAIL_KEY });
 * await mail.send({ from: "support@example.com", to: "ada@example.org", subject: "Hi", text: "Hello" });
 * ```
 */
export class GentleMail {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;

  constructor(options: GentleMailOptions) {
    if (!options?.url) throw new TypeError("GentleMail: `url` is required, for example https://mail.example.com");
    if (!options.apiKey) throw new TypeError("GentleMail: `apiKey` is required");
    this.#base = `${options.url.replace(/\/+$/, "")}/api/v1`;
    this.#key = options.apiKey;
    // Bound, so a global fetch keeps its `this` (Workers require it).
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Sends an email, or a reply in a thread with `reply_to_message_id`. */
  send(options: SendOptions): Promise<SendResult> {
    const { attachments, ...rest } = options;
    return this.#json("POST", "/send", {
      ...rest,
      ...(attachments ? { attachments: attachments.map(encodeAttachment) } : {}),
    });
  }

  readonly mailboxes = {
    /** The mailboxes this key can use, with its permissions on each. */
    list: async (): Promise<Mailbox[]> => (await this.#json<{ data: Mailbox[] }>("GET", "/mailboxes")).data,
  };

  readonly messages = {
    /** Messages, newest first. */
    list: async (options: ListMessagesOptions = {}): Promise<MessageSummary[]> => {
      const q = new URLSearchParams();
      if (options.mailbox) q.set("mailbox", options.mailbox);
      if (options.folder) q.set("folder", options.folder);
      if (options.unread) q.set("unread", "true");
      if (options.since != null) q.set("since", options.since instanceof Date ? String(options.since.getTime()) : String(options.since));
      if (options.limit != null) q.set("limit", String(options.limit));
      const qs = q.toString();
      return (await this.#json<{ data: MessageSummary[] }>("GET", `/messages${qs ? `?${qs}` : ""}`)).data;
    },

    /** One message, with its text and its HTML as received. */
    get: async (id: string): Promise<Message> =>
      (await this.#json<{ data: Message }>("GET", `/messages/${encodeURIComponent(id)}`)).data,

    /**
     * Marks or moves a message: read, unread, star, unstar, archive, trash, spam or inbox.
     * The key needs Organize on its mailbox (Read, before GentleMail 0.6.1).
     */
    update: async (id: string, action: MessageAction): Promise<void> => {
      await this.#json("POST", `/messages/${encodeURIComponent(id)}`, { action });
    },

    /**
     * Replies to a message from its own mailbox, in its thread: pass a message from
     * `messages.get()`, `messages.list()` or a webhook event's `data`. The key needs
     * Read and Send on that mailbox.
     */
    reply: (
      message: { id: string; mailbox: { address: string } },
      options: Omit<SendOptions, "from" | "reply_to_message_id"> & { from?: string },
    ): Promise<SendResult> =>
      this.send({ ...options, from: options.from ?? message.mailbox.address, reply_to_message_id: message.id }),
  };

  readonly attachments = {
    /**
     * Downloads an attachment, by id or by its `url`. Returns the response, so you
     * can stream it (`.body`), or read it (`.arrayBuffer()`, `.blob()`).
     */
    download: async (idOrUrl: string): Promise<Response> => {
      const path = idOrUrl.includes("/") ? idOrUrl.slice(idOrUrl.lastIndexOf("/") + 1) : idOrUrl;
      const res = await this.#request("GET", `/attachments/${encodeURIComponent(path)}`);
      if (!res.ok) throw await errorFrom(res);
      return res;
    },
  };

  #request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.#fetch(this.#base + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.#key}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async #json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#request(method, path, body);
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as T;
  }
}

async function errorFrom(res: Response): Promise<GentleMailError> {
  let code = "http_error";
  let message = `GentleMail answered ${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Not JSON (a proxy's error page, say): keep the status line.
  }
  return new GentleMailError(res.status, code, message);
}

function encodeAttachment(a: OutgoingAttachment) {
  const content = typeof a.content === "string" ? a.content : toBase64(a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content));
  return { filename: a.filename, content, ...(a.content_type ? { content_type: a.content_type } : {}) };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In slices, so large files don't overflow the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
