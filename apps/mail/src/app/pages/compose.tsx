import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { Paperclip } from "lucide-react";
import { removeSenderRule, saveMailboxSettings } from "@/app/actions/mail";
import { ActionButton, ActionForm } from "@/app/components/action-form";
import { ComposeForm } from "@/app/components/compose-form";
import { Field, Section } from "@/app/components/section";
import { Checkbox } from "@/app/components/ui/checkbox";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Badge } from "@/app/components/ui/badge";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import { missing } from "@/app/pages/errors";
import type { SenderRule } from "@/lib/spam";
import { type Mailbox, type MessageRow, getHtmlBody, getMailboxForUser, listAttachments, parseAddrs } from "@/lib/db";
import { type Addr, formatAddr, formatBytes, formatDate, htmlToText } from "@/lib/util";

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

export async function ComposePage(ri: RequestInfo) {
  const { params, ctx, request } = ri;
  const user = ctx.user!;
  const mailbox = await getMailboxForUser(user, params.mailboxId);
  if (!mailbox) return missing(ri, "mailbox");
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
      <div className="w-full max-w-5xl">

      <ComposeForm discardHref={original ? `/mb/${mailbox.id}/thread/${original.thread_id}?f=${original.folder}` : `/mb/${mailbox.id}/inbox`}>
        <input type="hidden" name="mailbox_id" value={mailbox.id} />
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
          <input name="to" defaultValue={to} placeholder="name@example.com, …" autoFocus={!to} className={fieldCls} />
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
              <Checkbox name="signature" defaultChecked /> Add signature
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

      </ComposeForm>
      </div>
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

/* ---------- Mailbox settings (signature, display name) ---------- */

export async function SettingsPage(ri: RequestInfo) {
  const { params, ctx, request } = ri;
  const user = ctx.user!;
  const mailbox = await getMailboxForUser(user, params.mailboxId);
  if (!mailbox) return missing(ri, "mailbox");
  const { results: rules } = await env.DB.prepare("SELECT * FROM sender_rules WHERE mailbox_id = ? ORDER BY created_at DESC")
    .bind(mailbox.id)
    .all<SenderRule>();
  const lists = [
    {
      kind: "block",
      title: "Blocked senders",
      description: "Their mail goes straight to spam. Added when you mark a conversation as spam.",
      empty: "Nobody blocked.",
    },
    {
      kind: "allow",
      title: "Trusted senders",
      description: "Their mail always reaches the inbox. Added when you mark a conversation as not spam.",
      empty: "Nobody trusted yet.",
    },
  ] as const;

  return (
    <Shell user={user} mailboxId={mailbox.id} folder="settings" flash={flashFrom(request)}>
      <PageHeader title="Mailbox settings" sub={mailbox.address} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Name and signature">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
            <ActionForm action={saveMailboxSettings} submitLabel="Save">
              <input type="hidden" name="mailbox_id" value={mailbox.id} />
              <Field label="Sender name" hint="Recipients see this next to the address.">
                <Input name="display_name" defaultValue={mailbox.display_name} required />
              </Field>
              <Field label="Signature" hint="Plain text. Links become clickable when sent.">
                <Textarea name="signature" rows={7} defaultValue={mailbox.signature} placeholder={"Jane Doe\nAcme Inc., https://example.com"} />
              </Field>
            </ActionForm>
            <aside className="text-sm">
              <div className="text-xs font-medium text-muted-foreground">How it looks</div>
              <div className="mt-2 rounded-md border bg-background p-4">
                <div className="text-muted-foreground">…your message</div>
                <pre className="mt-3 font-sans whitespace-pre-wrap">-- {"\n"}{mailbox.signature.trim() || "No signature yet"}</pre>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">You can leave it out of any single message.</p>
            </aside>
          </div>
        </Section>

        <div className="grid content-start gap-6">
          {lists.map((l) => {
            const items = rules.filter((r) => r.kind === l.kind);
            return (
              <Section key={l.kind} title={l.title} description={l.description}>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{l.empty}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {items.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">{r.sender}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>
                        <ActionButton variant="ghost" size="sm" className="h-7" action={removeSenderRule} args={[mailbox.id, r.id]}>
                          Remove
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
