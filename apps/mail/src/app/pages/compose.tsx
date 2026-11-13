import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { Icon } from "@/app/components/icons";
import { Shell, flashFrom } from "@/app/components/shell";
import { field, notFound, redirect, withFlash } from "@/app/http";
import { type Mailbox, type MessageRow, getHtmlBody, getMailboxForUser, listAttachments, parseAddrs } from "@/lib/db";
import { SendError, sendMail } from "@/lib/outbound";
import { type Addr, formatAddr, formatBytes, formatDate, htmlToText, isEmail, parseAddressList } from "@/lib/util";

async function loadOriginal(mailbox: Mailbox, id: string | null) {
  if (!id) return null;
  return env.DB.prepare("SELECT * FROM messages WHERE id = ? AND mailbox_id = ?")
    .bind(id, mailbox.id)
    .first<MessageRow>();
}

const prefix = (p: string, s: string) => (s.toLowerCase().startsWith(p.toLowerCase()) ? s : `${p} ${s}`);
const uniq = (list: Addr[], exclude: string) => {
  const seen = new Set([exclude.toLowerCase()]);
  return list.filter((a) => {
    const k = a.address.toLowerCase();
    if (!a.address || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export async function ComposePage({ params, ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const mailbox = await getMailboxForUser(user, params.mailboxId);
  if (!mailbox) return notFound();
  const url = new URL(request.url);
  const replyId = url.searchParams.get("reply");
  const forwardId = url.searchParams.get("forward");
  const replyAll = url.searchParams.get("all") === "1";
  const original = await loadOriginal(mailbox, replyId ?? forwardId);
  const mode = original ? (replyId ? "reply" : "forward") : null;

  let to = url.searchParams.get("to") ?? "";
  let cc = "";
  let subject = "";
  if (original && mode === "reply") {
    const replyTarget =
      original.direction === "out"
        ? parseAddrs(original.to_json)
        : [{ name: original.from_name, address: original.reply_to || original.from_addr }];
    to = uniq(replyTarget, mailbox.address).map(formatAddr).join(", ");
    if (replyAll) {
      const others = uniq(
        [...parseAddrs(original.to_json), ...parseAddrs(original.cc_json)].filter(
          (a) => !replyTarget.some((r) => r.address.toLowerCase() === a.address.toLowerCase()),
        ),
        mailbox.address,
      );
      cc = others.map(formatAddr).join(", ");
    }
    subject = prefix("Re:", original.subject);
  } else if (original && mode === "forward") {
    subject = prefix("Fwd:", original.subject);
  }

  const quotePreview = original
    ? original.text_body?.trim()
      ? original.text_body
      : htmlToText((await getHtmlBody(original)) ?? original.snippet)
    : "";
  const fwdAtts = original && mode === "forward" ? await listAttachments([original.id]) : [];

  return (
    <Shell user={user} mailboxId={mailbox.id} flash={flashFrom(request)}>
      <header className="toolbar">
        <h1>{mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "New message"}</h1>
      </header>

      <form method="post" encType="multipart/form-data" className="compose">
        {original && <input type="hidden" name="original" value={original.id} />}
        {mode && <input type="hidden" name="mode" value={mode} />}

        <div className="compose-row">
          <span className="compose-label">From</span>
          <span>
            {mailbox.display_name} &lt;{mailbox.address}&gt;
          </span>
        </div>
        <label className="compose-row">
          <span className="compose-label">To</span>
          <input name="to" defaultValue={to} placeholder="name@example.com, …" required autoFocus={!to} />
        </label>
        <label className="compose-row">
          <span className="compose-label">Cc</span>
          <input name="cc" defaultValue={cc} />
        </label>
        <label className="compose-row">
          <span className="compose-label">Bcc</span>
          <input name="bcc" />
        </label>
        <label className="compose-row">
          <span className="compose-label">Subject</span>
          <input name="subject" defaultValue={subject} />
        </label>

        <textarea name="body" rows={14} placeholder="Write your message…" autoFocus={!!to} />

        {mailbox.signature.trim() && (
          <div className="sig-preview">
            <label className="check">
              <input type="checkbox" name="signature" value="1" defaultChecked /> Add signature
            </label>
            <pre>-- {"\n"}{mailbox.signature}</pre>
          </div>
        )}

        {original && (
          <div className="quoted">
            <div className="muted small">
              {mode === "reply"
                ? `On ${formatDate(original.date, true)}, ${original.from_name || original.from_addr} wrote:`
                : `Forwarded message from ${original.from_name || original.from_addr} — included below your text`}
            </div>
            <pre>{quotePreview.slice(0, 2000)}</pre>
          </div>
        )}

        {fwdAtts.length > 0 && (
          <div className="muted small">
            Original attachments included: {fwdAtts.map((a) => `${a.filename} (${formatBytes(a.size)})`).join(", ")}
          </div>
        )}

        <div className="compose-foot">
          <label className="file-pick">
            <Icon name="clip" size={16} /> Attach files
            <input type="file" name="files" multiple />
          </label>
          <span className="muted small">Max 25 MB total</span>
          <span className="spacer" />
          <a className="btn btn-ghost" href={`/mb/${mailbox.id}/inbox`}>
            Discard
          </a>
          <button className="btn btn-primary" type="submit">
            Send
          </button>
        </div>
      </form>
    </Shell>
  );
}

export async function composeAction({ params, ctx, request }: RequestInfo) {
  const mailbox = await getMailboxForUser(ctx.user!, params.mailboxId);
  if (!mailbox) return notFound();
  if (!mailbox.active) {
    return redirect(withFlash(`/mb/${mailbox.id}/inbox`, "err", "This mailbox is disabled."));
  }
  const form = await request.formData();
  const self = new URL(request.url);
  const retry = self.pathname + self.search;

  const to = parseAddressList(field(form, "to"));
  const cc = parseAddressList(field(form, "cc"));
  const bcc = parseAddressList(field(form, "bcc"));
  const bad = [...to, ...cc, ...bcc].find((a) => !isEmail(a.address));
  if (bad) return redirect(withFlash(retry, "err", `Invalid address: ${bad.address}`));

  const files = [];
  for (const f of form.getAll("files")) {
    if (typeof f === "string" || !f.size) continue;
    files.push({ filename: f.name, type: f.type, content: await f.arrayBuffer() });
  }

  const original = await loadOriginal(mailbox, field(form, "original") || null);
  const modeRaw = field(form, "mode");
  const mode = modeRaw === "reply" || modeRaw === "forward" ? modeRaw : null;

  try {
    await sendMail({
      mailbox,
      to,
      cc,
      bcc,
      subject: field(form, "subject"),
      body: String(form.get("body") ?? ""),
      includeSignature: form.get("signature") === "1",
      files,
      original,
      mode,
    });
  } catch (e) {
    const msg = e instanceof SendError ? e.message : "Sending failed.";
    // Note: typed text is lost on error since this is a plain form post.
    return redirect(withFlash(retry, "err", msg));
  }

  if (original && mode === "reply") {
    return redirect(withFlash(`/mb/${mailbox.id}/thread/${original.thread_id}?f=${original.folder}`, "msg", "Reply sent."));
  }
  return redirect(withFlash(`/mb/${mailbox.id}/sent`, "msg", "Message sent."));
}

/* ---------- Mailbox settings (signature, display name) ---------- */

export async function SettingsPage({ params, ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const mailbox = await getMailboxForUser(user, params.mailboxId);
  if (!mailbox) return notFound();
  return (
    <Shell user={user} mailboxId={mailbox.id} folder="settings" flash={flashFrom(request)}>
      <header className="toolbar">
        <div>
          <h1>Settings</h1>
          <div className="muted small">{mailbox.address}</div>
        </div>
      </header>
      <form method="post" className="card stack narrow">
        <label>
          Sender name
          <input name="display_name" defaultValue={mailbox.display_name} required />
        </label>
        <label>
          Signature
          <textarea name="signature" rows={6} defaultValue={mailbox.signature} placeholder={"Jane Doe\nAcme Inc. · https://example.com"} />
        </label>
        <div className="muted small">Plain text. Links are made clickable automatically.</div>
        <div>
          <button className="btn btn-primary" type="submit">
            Save
          </button>
        </div>
      </form>
    </Shell>
  );
}

export async function settingsAction({ params, ctx, request }: RequestInfo) {
  const mailbox = await getMailboxForUser(ctx.user!, params.mailboxId);
  if (!mailbox) return notFound();
  const form = await request.formData();
  await env.DB.prepare("UPDATE mailboxes SET display_name = ?, signature = ? WHERE id = ?")
    .bind(field(form, "display_name") || mailbox.display_name, String(form.get("signature") ?? "").slice(0, 5000), mailbox.id)
    .run();
  return redirect(withFlash(`/mb/${mailbox.id}/settings`, "msg", "Settings saved."));
}
