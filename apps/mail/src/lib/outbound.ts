import { env, waitUntil } from "cloudflare:workers";
import { type Mailbox, type MessageRow, domainOf, getHtmlBody, isDomainActive, parseAddrs } from "./db";
import { hasSignature, outgoingSignature } from "./signature";
import { resolveThreadId } from "./threads";
import { emitMessageEvent } from "./webhooks";
import {
  type Addr,
  D1_TEXT_LIMIT,
  byteLength,
  escapeHtml,
  formatAddr,
  htmlToText,
  mailDate,
  makeSnippet,
  newId,
  now,
  rowText,
  stripBrackets,
  textToHtml,
} from "./util";

/** `contentId`: an image shown in the HTML where it says `cid:<contentId>`, rather than a file. */
export type OutgoingFile = { filename: string; type: string; content: ArrayBuffer; contentId?: string };

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
/** The email service takes at most this many attachments, images in the HTML included. */
const MAX_FILES = 32;

const sizeOf = (files: OutgoingFile[]) => files.reduce((s, f) => s + f.content.byteLength, 0);

/** "a%40b" → "a@b"; left as it is when it isn't valid percent-encoding. */
const decodeCid = (cid: string) => {
  try {
    return decodeURIComponent(cid);
  } catch {
    return cid;
  }
};

/**
 * The images a quoted message shows (`<img src="cid:…">`), taken along so the quote isn't
 * full of broken pictures. Each gets a new content ID: the old one was written by whoever
 * sent the message. `room` says whether one more image fits; those that don't, and those
 * GentleMail doesn't have, lose their tag. `carried` holds the attachments taken.
 */
async function carryImages(html: string, original: MessageRow, room: (file: OutgoingFile, taken: OutgoingFile[]) => boolean) {
  const files: OutgoingFile[] = [];
  const carried = new Set<string>();
  if (!/cid:/i.test(html)) return { html, files, carried };

  const wanted = new Set<string>();
  const cidOf = (el: Element) => {
    const m = /^\s*cid:(.+)$/i.exec(el.getAttribute("src") ?? "");
    return m ? decodeCid(m[1].trim()).toLowerCase() : null;
  };
  const rewrite = (element: (el: Element) => void) =>
    new HTMLRewriter()
      .on("img", { element })
      .transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }))
      .text();
  await rewrite((el) => {
    const cid = cidOf(el);
    if (cid) wanted.add(cid);
  });
  if (!wanted.size) return { html, files, carried };

  const { results } = await env.DB.prepare(
    "SELECT id, filename, content_type, r2_key, content_id FROM attachments WHERE message_id = ? AND content_id IS NOT NULL",
  )
    .bind(original.id)
    .all<{ id: string; filename: string; content_type: string; r2_key: string; content_id: string }>();
  const newCid = new Map<string, string>();
  for (const a of results) {
    const cid = a.content_id.toLowerCase();
    if (!wanted.has(cid) || newCid.has(cid) || !/^image\//i.test(a.content_type)) continue;
    const obj = await env.MAIL_BUCKET.get(a.r2_key);
    if (!obj) continue;
    const file = { filename: a.filename, type: a.content_type, content: await obj.arrayBuffer(), contentId: `image-${newId()}` };
    if (!room(file, files)) continue;
    files.push(file);
    carried.add(a.id);
    newCid.set(cid, file.contentId);
  }
  const out = await rewrite((el) => {
    const cid = cidOf(el);
    if (!cid) return;
    const to = newCid.get(cid);
    if (to) el.setAttribute("src", `cid:${to}`);
    else el.remove();
  });
  return { html: out, files, carried };
}

export class SendError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

const quotedSender = (m: MessageRow) => (m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr);

/** The line above a quoted reply, as it is sent: always in English. The composer shows this same line. */
export const replyIntro = (m: MessageRow) => `On ${mailDate(m.date)}, ${quotedSender(m)} wrote:`;

const originalHtml = async (original: MessageRow) => (await getHtmlBody(original)) ?? textToHtml(original.text_body ?? "");

function buildQuote(original: MessageRow, mode: "reply" | "forward", origHtml: string) {
  const origText = original.text_body?.trim() ? original.text_body : htmlToText(origHtml);

  if (mode === "forward") {
    const to = parseAddrs(original.to_json).map(formatAddr).join(", ");
    const header = `---------- Forwarded message ----------\nFrom: ${quotedSender(original)}\nDate: ${mailDate(original.date)}\nSubject: ${original.subject}\nTo: ${to}`;
    return {
      text: `\n\n${header}\n\n${origText}`,
      html: `<br><br><div>${textToHtml(header)}</div><br>${origHtml}`,
    };
  }
  const intro = replyIntro(original);
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

  const sig = input.includeSignature && hasSignature(mailbox) ? await outgoingSignature(mailbox) : null;
  const files = [...input.files, ...(sig?.files ?? [])];
  let quote = { text: "", html: "" };
  let carried = new Set<string>();
  if (original && mode && input.quote !== false) {
    const origHtml = await originalHtml(original);
    const typed = sizeOf(files) + input.body.length + (input.html?.length ?? 0);
    // A reply leaves out the images that don't fit. A forward passes the message on whole: past the limit it's refused below.
    const images = await carryImages(
      origHtml,
      original,
      (file, taken) =>
        mode === "forward" ||
        (files.length + taken.length < MAX_FILES && typed + sizeOf(taken) + file.content.byteLength <= MAX_TOTAL),
    );
    files.push(...images.files);
    carried = images.carried;
    quote = buildQuote(original, mode, images.html);
  }
  // Forwarding carries the original's other attachments along.
  if (original && mode === "forward") {
    const { results } = await env.DB.prepare(
      "SELECT id, filename, content_type, r2_key FROM attachments WHERE message_id = ?",
    )
      .bind(original.id)
      .all<{ id: string; filename: string; content_type: string; r2_key: string }>();
    for (const a of results) {
      if (carried.has(a.id)) continue;
      const obj = await env.MAIL_BUCKET.get(a.r2_key);
      if (obj) files.push({ filename: a.filename, type: a.content_type, content: await obj.arrayBuffer() });
    }
  }
  const total = sizeOf(files) + input.body.length + (input.html?.length ?? 0);
  // The text and HTML count too: they are part of the message the email service takes.
  if (total > MAX_TOTAL) throw new SendError("The message and its attachments exceed the 25 MB limit.");

  if (files.length > MAX_FILES) throw new SendError(`A message can carry at most ${MAX_FILES} files, images inside it included.`);

  const text = input.body + (sig?.text ? `\n\n-- \n${sig.text}` : "") + quote.text;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">` +
    (input.html ?? textToHtml(input.body)) +
    (sig?.html ? `<br><br>${sig.html}` : "") +
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
        ? files.map((f) => {
            // The bytes themselves: given text, the email service attaches that text, so base64 arrives as a
            // broken file. As a Uint8Array: local development can't pass an ArrayBuffer on.
            const file = { filename: f.filename, type: f.type || "application/octet-stream", content: new Uint8Array(f.content) };
            return f.contentId
              ? { ...file, disposition: "inline" as const, contentId: f.contentId }
              : { ...file, disposition: "attachment" as const };
          })
        : undefined,
    });
  } catch (e: any) {
    console.error("send failed", e?.code, e?.message);
    throw new SendError(e?.message ?? "Sending failed", e?.code);
  }

  // Store a copy in "sent". The email is already gone: the copy must fit its row whatever
  // the script (D1 counts bytes), so large HTML goes to storage, as for received mail.
  const id = newId();
  let rowHtml: string | null = html;
  let htmlKey: string | null = null;
  if (byteLength(html) > D1_TEXT_LIMIT) {
    htmlKey = `bodies/${mailbox.id}/${id}.html`;
    await env.MAIL_BUCKET.put(htmlKey, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    rowHtml = null;
  }
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
        from_addr, from_name, to_json, cc_json, bcc_json, subject, snippet, text_body, html_body, html_key,
        size, has_attachments, is_read, date, created_at)
       VALUES (?, ?, ?, 'sent', 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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
      rowText(text),
      rowHtml,
      htmlKey,
      total,
      files.some((f) => !f.contentId) ? 1 : 0,
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
        `INSERT INTO attachments (id, message_id, filename, content_type, size, r2_key, content_id, disposition, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        attId,
        id,
        f.filename,
        f.type || "application/octet-stream",
        f.content.byteLength,
        key,
        f.contentId ?? null,
        f.contentId ? "inline" : "attachment",
        ts,
      ),
    );
  }
  await env.DB.batch(stmts);
  waitUntil(emitMessageEvent("message.sent", id).catch((e) => console.error("webhook emit failed", e)));
  return id;
}
