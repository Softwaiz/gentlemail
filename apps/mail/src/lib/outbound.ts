import { env, waitUntil } from "cloudflare:workers";
import { type Mailbox, type MessageRow, domainOf, getHtmlBody, isDomainActive, parseAddrs } from "./db";
import { resolveThreadId } from "./threads";
import { emitMessageEvent } from "./webhooks";
import {
  type Addr,
  escapeHtml,
  formatAddr,
  formatDate,
  htmlToText,
  makeSnippet,
  newId,
  now,
  stripBrackets,
  textToHtml,
  toBase64,
} from "./util";

export type OutgoingFile = { filename: string; type: string; content: ArrayBuffer };

export type SendInput = {
  mailbox: Mailbox;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  body: string; // plain text typed by the user
  includeSignature: boolean;
  files: OutgoingFile[];
  /** Message being replied to / forwarded (quoted below the new text). */
  original?: MessageRow | null;
  mode?: "reply" | "forward" | null;
  /** Ready-made HTML body (API). When absent, HTML is built from `body`. */
  html?: string;
  /** Quote the original below the new text (default true). */
  quote?: boolean;
};

const toApi = (a: Addr): string | EmailAddress => (a.name ? { email: a.address, name: a.name } : a.address);

const MAX_TOTAL = 25 * 1024 * 1024;

export class SendError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

async function buildQuote(original: MessageRow, mode: "reply" | "forward") {
  const who = original.from_name ? `${original.from_name} <${original.from_addr}>` : original.from_addr;
  const when = formatDate(original.date, true);
  const origHtml = (await getHtmlBody(original)) ?? textToHtml(original.text_body ?? "");
  const origText = original.text_body?.trim() ? original.text_body : htmlToText(origHtml);

  if (mode === "forward") {
    const to = parseAddrs(original.to_json).map(formatAddr).join(", ");
    const header = `---------- Forwarded message ----------\nFrom: ${who}\nDate: ${when}\nSubject: ${original.subject}\nTo: ${to}`;
    return {
      text: `\n\n${header}\n\n${origText}`,
      html: `<br><br><div>${textToHtml(header)}</div><br>${origHtml}`,
    };
  }
  const intro = `On ${when}, ${who} wrote:`;
  return {
    text: `\n\n${intro}\n${origText.split("\n").map((l) => `> ${l}`).join("\n")}`,
    html: `<br><br><div>${escapeHtml(intro)}</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${origHtml}</blockquote>`,
  };
}

export async function sendMail(input: SendInput): Promise<string> {
  const { mailbox, original, mode } = input;
  const recipients = [...input.to, ...input.cc, ...input.bcc];
  if (!(await isDomainActive(domainOf(mailbox.address)))) {
    throw new SendError(`Sending from ${domainOf(mailbox.address)} is disabled.`);
  }
  if (!recipients.length) throw new SendError("Add at least one recipient.");
  if (recipients.length > 50) throw new SendError("Maximum 50 recipients per email.");

  // Forwarding carries the original attachments along.
  const files = [...input.files];
  if (original && mode === "forward") {
    const { results } = await env.DB.prepare(
      "SELECT filename, content_type, r2_key FROM attachments WHERE message_id = ?",
    )
      .bind(original.id)
      .all<{ filename: string; content_type: string; r2_key: string }>();
    for (const a of results) {
      const obj = await env.MAIL_BUCKET.get(a.r2_key);
      if (obj) files.push({ filename: a.filename, type: a.content_type, content: await obj.arrayBuffer() });
    }
  }
  const total = files.reduce((s, f) => s + f.content.byteLength, 0) + input.body.length;
  if (total > MAX_TOTAL) throw new SendError("Attachments exceed the 25 MB limit.");

  const sig = input.includeSignature && mailbox.signature.trim() ? mailbox.signature.trim() : "";
  const quote = original && mode && input.quote !== false ? await buildQuote(original, mode) : { text: "", html: "" };

  const text = input.body + (sig ? `\n\n-- \n${sig}` : "") + quote.text;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">` +
    (input.html ?? textToHtml(input.body)) +
    (sig ? `<br><br><div style="color:#555">-- <br>${textToHtml(sig)}</div>` : "") +
    quote.html +
    `</div>`;

  const headers: Record<string, string> = {};
  if (original && mode === "reply" && original.message_id) {
    headers["In-Reply-To"] = `<${original.message_id}>`;
    const refs = [original.references_hdr, `<${original.message_id}>`].filter(Boolean).join(" ");
    headers["References"] = refs.slice(-1900);
  }

  let result: EmailSendResult;
  try {
    result = await env.EMAIL.send({
      from: { email: mailbox.address, name: mailbox.display_name },
      to: input.to.map(toApi),
      cc: input.cc.length ? input.cc.map(toApi) : undefined,
      bcc: input.bcc.length ? input.bcc.map(toApi) : undefined,
      subject: input.subject || "(no subject)",
      text,
      html,
      headers: Object.keys(headers).length ? headers : undefined,
      attachments: files.length
        ? files.map((f) => ({
            filename: f.filename,
            type: f.type || "application/octet-stream",
            content: toBase64(f.content),
            disposition: "attachment" as const,
          }))
        : undefined,
    });
  } catch (e: any) {
    console.error("send failed", e?.code, e?.message);
    throw new SendError(e?.message ?? "Sending failed", e?.code);
  }

  // Store a copy in "sent".
  const id = newId();
  const ts = now();
  const threadId =
    original && mode === "reply"
      ? original.thread_id
      : await resolveThreadId({
          mailboxId: mailbox.id,
          subject: input.subject,
          counterpart: input.to[0]?.address,
        });

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, message_id, in_reply_to, references_hdr,
        from_addr, from_name, to_json, cc_json, bcc_json, subject, snippet, text_body, html_body,
        size, has_attachments, is_read, date, created_at)
       VALUES (?, ?, ?, 'sent', 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      id,
      mailbox.id,
      threadId,
      stripBrackets(result?.messageId),
      stripBrackets(headers["In-Reply-To"]),
      headers["References"] ?? null,
      mailbox.address.toLowerCase(),
      mailbox.display_name,
      JSON.stringify(input.to),
      JSON.stringify(input.cc),
      JSON.stringify(input.bcc),
      input.subject || "(no subject)",
      makeSnippet(input.body),
      text,
      html.length < 900_000 ? html : null,
      total,
      files.length ? 1 : 0,
      ts,
      ts,
    ),
  ];

  for (const f of files) {
    const attId = newId();
    const key = `att/${mailbox.id}/${id}/${attId}`;
    await env.MAIL_BUCKET.put(key, f.content, {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
      customMetadata: { filename: f.filename },
    });
    stmts.push(
      env.DB.prepare(
        `INSERT INTO attachments (id, message_id, filename, content_type, size, r2_key, disposition, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'attachment', ?)`,
      ).bind(attId, id, f.filename, f.type || "application/octet-stream", f.content.byteLength, key, ts),
    );
  }
  await env.DB.batch(stmts);
  waitUntil(emitMessageEvent("message.sent", id).catch((e) => console.error("webhook emit failed", e)));
  return id;
}
