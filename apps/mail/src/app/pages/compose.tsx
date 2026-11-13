import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { Paperclip, Send } from "lucide-react";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
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
      <PageHeader title={mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "New message"} />

      <form method="post" encType="multipart/form-data" className="max-w-[880px] overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_rgb(8_11_16/5%),0_8px_24px_rgb(8_11_16/5%)]">
        {original && <input type="hidden" name="original" value={original.id} />}
        {mode && <input type="hidden" name="mode" value={mode} />}

        <div className="flex items-center gap-3 border-b bg-muted/40 px-5 py-3 text-sm">
          <span className="w-14 shrink-0 text-muted-foreground">From</span>
          <span className="min-w-0 truncate">
            <span className="font-medium">{mailbox.display_name}</span>{" "}
            <span className="text-muted-foreground">{mailbox.address}</span>
          </span>
        </div>
        <ComposeRow label="To">
          <input name="to" defaultValue={to} placeholder="name@example.com, …" required autoFocus={!to} className={fieldCls} />
        </ComposeRow>
        <ComposeRow label="Cc">
          <input name="cc" defaultValue={cc} className={fieldCls} />
        </ComposeRow>
        <ComposeRow label="Bcc">
          <input name="bcc" className={fieldCls} />
        </ComposeRow>
        <ComposeRow label="Subject">
          <input name="subject" defaultValue={subject} className={cn(fieldCls, "font-medium")} />
        </ComposeRow>

        <textarea
          name="body"
          rows={14}
          placeholder="Write your message…"
          autoFocus={!!to}
          className="block min-h-72 w-full resize-y bg-transparent px-5 py-4 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />

        {mailbox.signature.trim() && (
          <div className="border-t border-dashed px-5 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="signature" value="1" defaultChecked className="size-4 accent-[var(--violet)]" /> Add signature
            </label>
            <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-muted-foreground">-- {"\n"}{mailbox.signature}</pre>
          </div>
        )}

        {original && (
          <div className="mx-5 mb-4 max-h-56 overflow-auto border-l-2 border-input pl-4">
            <div className="text-xs text-muted-foreground">
              {mode === "reply"
                ? `On ${formatDate(original.date, true)}, ${original.from_name || original.from_addr} wrote:`
                : `Forwarded message from ${original.from_name || original.from_addr}, added below your text`}
            </div>
            <pre className="mt-1.5 font-sans text-sm whitespace-pre-wrap text-muted-foreground">{quotePreview.slice(0, 2000)}</pre>
          </div>
        )}

        {fwdAtts.length > 0 && (
          <div className="mx-5 mb-4 flex flex-wrap gap-2">
            {fwdAtts.map((a) => (
              <Badge key={a.id} variant="secondary" className="gap-1.5 font-normal">
                <Paperclip className="size-3" /> {a.filename} ({formatBytes(a.size)})
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/40 px-5 py-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Paperclip className="size-4" /> Attach
            <input type="file" name="files" multiple className="max-w-56 text-xs file:hidden" />
          </label>
          <span className="text-xs text-muted-foreground">Up to 25 MB in total</span>
          <span className="flex-1" />
          <Button variant="ghost" asChild>
            <a href={`/mb/${mailbox.id}/inbox`}>Discard</a>
          </Button>
          <Button type="submit" className="min-w-28">
            <Send /> Send
          </Button>
        </div>
      </form>
    </Shell>
  );
}

const fieldCls = "h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground";

function ComposeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 border-b px-5 focus-within:bg-accent/30">
      <span className="w-14 shrink-0 text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
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
      <PageHeader title="Signature" sub={`How ${mailbox.address} signs its mail`} />
      <div className="grid max-w-[980px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form method="post" className="flex flex-col gap-5 rounded-lg border bg-card p-6">
          <div className="grid gap-2">
            <Label htmlFor="display_name">Sender name</Label>
            <Input id="display_name" name="display_name" defaultValue={mailbox.display_name} required />
            <p className="text-xs text-muted-foreground">Recipients see this next to the address.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="signature">Signature</Label>
            <Textarea
              id="signature"
              name="signature"
              rows={7}
              defaultValue={mailbox.signature}
              placeholder={"Jane Doe\nAcme Inc., https://example.com"}
            />
            <p className="text-xs text-muted-foreground">Plain text. Links become clickable when sent.</p>
          </div>
          <div>
            <Button type="submit">Save signature</Button>
          </div>
        </form>
        <aside className="rounded-lg border border-dashed p-5 text-sm">
          <div className="font-medium">How it looks</div>
          <div className="mt-3 rounded-md bg-card p-4 shadow-sm">
            <div className="text-muted-foreground">…your message</div>
            <pre className="mt-3 font-sans whitespace-pre-wrap">-- {"\n"}{mailbox.signature.trim() || "No signature yet"}</pre>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">You can leave it out of any single message while writing.</p>
        </aside>
      </div>
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
