import { env, waitUntil } from "cloudflare:workers";
import PostalMime, { type Address } from "postal-mime";
import { resolveThreadId } from "./threads";
import { spamVerdict } from "./spam";
import { emitMessageEvent } from "./webhooks";
import { type Addr, makeSnippet, newId, now, stripBrackets } from "./util";

const D1_TEXT_LIMIT = 900_000; // keep rows well under D1's 2 MB limit

const flatten = (list?: Address[] | Address): Addr[] => {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.flatMap((a) =>
    a.group ? a.group.map((m) => ({ name: m.name, address: m.address })) : [{ name: a.name, address: a.address ?? "" }],
  );
};

const extFor = (mime: string) => {
  const sub = mime.split("/")[1]?.split(/[;+]/)[0];
  return sub && /^[a-z0-9]{1,6}$/i.test(sub) ? `.${sub}` : "";
};

/** Email Routing entrypoint: parse, store in D1 + R2. */
export async function handleInbound(message: ForwardableEmailMessage) {
  const recipient = message.to.toLowerCase();
  // Both the mailbox and its domain must be active.
  const mailbox = await env.DB.prepare(
    `SELECT m.id FROM mailboxes m JOIN domains d ON d.name = ? AND d.active = 1
     WHERE m.address = ? COLLATE NOCASE AND m.active = 1`,
  )
    .bind(recipient.slice(recipient.lastIndexOf("@") + 1), recipient)
    .first<{ id: string }>();

  if (!mailbox) {
    message.setReject("550 5.1.1 No such mailbox here");
    return;
  }

  // The raw stream can only be read once.
  const raw = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(raw);

  const id = newId();
  const ts = now();
  const rawKey = `raw/${mailbox.id}/${id}.eml`;
  await env.MAIL_BUCKET.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });

  const from = flatten(email.from)[0] ?? { name: "", address: message.from };
  const subject = email.subject ?? "(no subject)";

  let html = email.html ?? null;
  let htmlKey: string | null = null;
  if (html && html.length > D1_TEXT_LIMIT) {
    htmlKey = `bodies/${mailbox.id}/${id}.html`;
    await env.MAIL_BUCKET.put(htmlKey, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    html = null;
  }
  let text = email.text ?? null;
  if (text && text.length > D1_TEXT_LIMIT) text = text.slice(0, D1_TEXT_LIMIT) + "\n\n[…truncated — full message kept in storage]";

  const threadId = await resolveThreadId({
    mailboxId: mailbox.id,
    inReplyTo: email.inReplyTo,
    references: email.references,
    subject,
    counterpart: from.address,
  });

  const spamReason = await spamVerdict(mailbox.id, from.address, email.headers);
  const spamFlag = spamReason !== null;

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, message_id, in_reply_to, references_hdr,
        from_addr, from_name, to_json, cc_json, bcc_json, reply_to, subject, snippet, text_body, html_body, html_key,
        raw_key, size, has_attachments, is_read, date, created_at, spam_reason)
       VALUES (?, ?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(
      id,
      mailbox.id,
      threadId,
      spamFlag ? "spam" : "inbox",
      stripBrackets(email.messageId),
      stripBrackets(email.inReplyTo),
      email.references ?? null,
      from.address.toLowerCase(),
      from.name ?? "",
      JSON.stringify(flatten(email.to)),
      JSON.stringify(flatten(email.cc)),
      flatten(email.replyTo)[0]?.address ?? null,
      subject,
      makeSnippet(email.text, email.html),
      text,
      html,
      htmlKey,
      rawKey,
      message.rawSize,
      email.attachments.some((a) => a.disposition !== "inline" || !a.contentId) ? 1 : 0,
      email.date ? Date.parse(email.date) || ts : ts,
      ts,
      spamReason,
    ),
  ];

  let n = 0;
  for (const att of email.attachments) {
    n++;
    const attId = newId();
    const key = `att/${mailbox.id}/${id}/${attId}`;
    const filename = att.filename || `attachment-${n}${extFor(att.mimeType)}`;
    const content =
      typeof att.content === "string" ? new TextEncoder().encode(att.content) : att.content;
    await env.MAIL_BUCKET.put(key, content, {
      httpMetadata: { contentType: att.mimeType },
      customMetadata: { filename },
    });
    stmts.push(
      env.DB.prepare(
        `INSERT INTO attachments (id, message_id, filename, content_type, size, r2_key, content_id, disposition, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        attId,
        id,
        filename,
        att.mimeType,
        content.byteLength,
        key,
        stripBrackets(att.contentId),
        att.disposition === "inline" ? "inline" : "attachment",
        ts,
      ),
    );
  }

  await env.DB.batch(stmts);

  // Spam doesn't wake up webhooks; everything that reaches the inbox does.
  if (!spamFlag) {
    waitUntil(emitMessageEvent("message.received", id).catch((e) => console.error("webhook emit failed", e)));
  }
}
