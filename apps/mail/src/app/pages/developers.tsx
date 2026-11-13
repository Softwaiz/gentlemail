import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Field, Section, StatusBadge } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/app/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { field, notFound, redirect, withFlash } from "@/app/http";
import { type ApiKeyRow, SCOPES, type Scope, createApiKey } from "@/lib/apikeys";
import { type Mailbox } from "@/lib/db";
import { formatDate, newId, now } from "@/lib/util";
import { cn } from "@/lib/utils";
import {
  type DeliveryRow,
  EVENTS,
  type WebhookRow,
  attemptDelivery,
  newSecret,
  publicUrl,
  sendTestEvent,
} from "@/lib/webhooks";

const listMailboxes = async () =>
  (await env.DB.prepare("SELECT id, address FROM mailboxes ORDER BY address").all<Pick<Mailbox, "id" | "address">>()).results;

const check = "size-4 accent-[var(--violet)]";

function MailboxSelect({ mailboxes, defaultValue }: { mailboxes: { id: string; address: string }[]; defaultValue?: string | null }) {
  return (
    <NativeSelect name="mailbox_id" defaultValue={defaultValue ?? ""} className="bg-card">
      <NativeSelectOption value="">All mailboxes</NativeSelectOption>
      {mailboxes.map((m) => (
        <NativeSelectOption key={m.id} value={m.id}>
          {m.address}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-md bg-sidebar px-4 py-3 font-mono text-[12.5px] leading-relaxed text-sidebar-foreground">{children}</pre>
);

/* ---------- /admin/api ---------- */

export async function DevelopersPage(info: RequestInfo, created?: { name: string; key: string }) {
  const { ctx, request } = info;
  const mailboxes = await listMailboxes();
  const label = (id: string | null) => (id ? (mailboxes.find((m) => m.id === id)?.address ?? "deleted mailbox") : "All mailboxes");

  const { results: keys } = await env.DB.prepare("SELECT * FROM api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC").all<ApiKeyRow>();
  const { results: hooks } = await env.DB.prepare(
    `SELECT w.*,
       (SELECT status FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY created_at DESC LIMIT 1) AS last_status,
       (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed') AS failed
     FROM webhooks w ORDER BY w.created_at DESC`,
  ).all<WebhookRow & { last_status: string | null; failed: number }>();
  const base = publicUrl() || new URL(request.url).origin;
  const example = mailboxes[0]?.address ?? "hello@example.com";

  return (
    <Shell user={ctx.user!} folder="api" flash={flashFrom(request)}>
      <PageHeader
        title="API & webhooks"
        sub="Let other programs send and read mail, and get notified the moment mail arrives."
      />

      <div className="grid gap-6">
        {created && (
          <div role="status" className="rounded-lg border-2 border-foreground bg-lime/30 p-5 dark:bg-lime/10">
            <div className="font-semibold">Your new key “{created.name}”</div>
            <p className="mt-1 text-sm text-muted-foreground">Copy it now. It won't be shown again: only a fingerprint is stored.</p>
            <input
              readOnly
              value={created.key}
              aria-label="New API key"
              className="mt-3 w-full rounded-md border bg-card px-3 py-2 font-mono text-sm select-all"
            />
          </div>
        )}

        <Section title="API keys" description="Each key can be limited to one mailbox and to sending, reading, or both.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Mailbox</TableHead>
                <TableHead>Can</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id} className={cn(k.revoked_at && "opacity-50")}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                  <TableCell>{label(k.mailbox_id)}</TableCell>
                  <TableCell>{k.scopes.split(",").join(", ")}</TableCell>
                  <TableCell className="text-muted-foreground">{k.last_used_at ? formatDate(k.last_used_at, true) : "Never"}</TableCell>
                  <TableCell className="text-right">
                    {k.revoked_at ? (
                      <span className="text-xs text-muted-foreground">Revoked</span>
                    ) : (
                      <form method="post">
                        <input type="hidden" name="op" value="revoke" />
                        <input type="hidden" name="id" value={k.id} />
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {keys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No keys yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <form method="post" className="mt-6 grid gap-4 rounded-md bg-muted/50 p-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
            <input type="hidden" name="op" value="create_key" />
            <Field label="Name">
              <Input name="name" placeholder="Invoice agent" required className="bg-card" />
            </Field>
            <Field label="Mailbox">
              <MailboxSelect mailboxes={mailboxes} />
            </Field>
            <fieldset className="flex gap-4 pb-2">
              <legend className="sr-only">Permissions</legend>
              {SCOPES.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm" title={s.hint}>
                  <input type="checkbox" name="scopes" value={s.id} defaultChecked={s.id === "send"} className={check} /> {s.label}
                </label>
              ))}
            </fieldset>
            <Button type="submit">Create key</Button>
          </form>
        </Section>

        <Section
          title="Webhooks"
          description="We POST a signed JSON event to your URL when mail arrives or is sent. Failed deliveries are retried for about a day."
        >
          {hooks.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No webhooks yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {hooks.map((h) => (
                <li key={h.id}>
                  <a href={`/admin/webhooks/${h.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-accent/40">
                    <span className="min-w-40 font-medium">{h.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{h.url}</span>
                    <span className="text-xs text-muted-foreground">{label(h.mailbox_id)}</span>
                    {h.failed > 0 && <span className="text-xs font-medium text-destructive">{h.failed} failed</span>}
                    <StatusBadge on={!!h.active} onLabel="On" offLabel="Off" />
                  </a>
                </li>
              ))}
            </ul>
          )}

          <form method="post" className="mt-6 grid gap-4 rounded-md bg-muted/50 p-4 md:grid-cols-2">
            <input type="hidden" name="op" value="create_hook" />
            <Field label="Name">
              <Input name="name" placeholder="Invoice processor" required className="bg-card" />
            </Field>
            <Field label="URL" hint="Must be https.">
              <Input name="url" type="url" placeholder="https://agents.example.com/hooks/mail" required className="bg-card" />
            </Field>
            <Field label="Mailbox">
              <MailboxSelect mailboxes={mailboxes} />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-sm font-medium">Events</legend>
              {EVENTS.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="events" value={e.id} defaultChecked={e.id === "message.received"} className={check} />
                  {e.label} <code className="font-mono text-xs text-muted-foreground">{e.id}</code>
                </label>
              ))}
            </fieldset>
            <div>
              <Button type="submit">Add webhook</Button>
            </div>
          </form>
        </Section>

        <Section title="Quick reference" description={`Base URL ${base}/api/v1. Send the key as a Bearer token.`}>
          <div className="grid gap-5 text-sm">
            <div>
              <div className="mb-2 font-medium">Send an email</div>
              <Code>{`curl ${base}/api/v1/send \\
  -H "Authorization: Bearer $GENTLEMAIL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "${example}",
    "to": ["someone@example.com"],
    "subject": "Your invoice",
    "text": "Hello, the invoice is attached.",
    "attachments": [{ "filename": "invoice.pdf", "content": "<base64>", "content_type": "application/pdf" }]
  }'`}</Code>
              <p className="mt-2 text-muted-foreground">
                Optional: <code className="font-mono">html</code>, <code className="font-mono">cc</code>,{" "}
                <code className="font-mono">bcc</code>, <code className="font-mono">signature: true</code>, and{" "}
                <code className="font-mono">reply_to_message_id</code> to answer in the same thread.
              </p>
            </div>
            <div>
              <div className="mb-2 font-medium">Read mail</div>
              <Code>{`GET  /api/v1/mailboxes
GET  /api/v1/messages?mailbox=${example}&folder=inbox&unread=true&since=2026-11-01
GET  /api/v1/messages/{id}             full text, raw HTML, attachment links
GET  /api/v1/attachments/{id}          file bytes
POST /api/v1/messages/{id}  {"action":"archive"}   read, unread, star, archive, trash, inbox`}</Code>
            </div>
            <div>
              <div className="mb-2 font-medium">Webhook deliveries</div>
              <Code>{`POST <your url>
X-GentleMail-Event: message.received
X-GentleMail-Delivery: <id, use it to ignore duplicates>
X-GentleMail-Timestamp: <unix seconds>
X-GentleMail-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>

{ "id": "...", "event": "message.received", "created_at": "...",
  "data": { "id", "thread_id", "mailbox", "from", "to", "subject", "text", "attachments": [{ "url", ... }], ... } }`}</Code>
              <p className="mt-2 text-muted-foreground">
                Check the signature and reject timestamps older than five minutes. Answer with any 2xx status within 10
                seconds; anything else is retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h. Attachment URLs need a key
                with the Read permission.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </Shell>
  );
}

export async function developersAction(info: RequestInfo) {
  const { request, ctx } = info;
  const form = await request.formData();
  const op = field(form, "op");
  const mailboxId = field(form, "mailbox_id") || null;
  if (mailboxId && !(await env.DB.prepare("SELECT 1 FROM mailboxes WHERE id = ?").bind(mailboxId).first())) {
    return redirect(withFlash("/admin/api", "err", "Unknown mailbox."));
  }

  if (op === "create_key") {
    const name = field(form, "name").slice(0, 80);
    const scopes = form.getAll("scopes").map(String).filter((s): s is Scope => SCOPES.some((x) => x.id === s));
    if (!name) return redirect(withFlash("/admin/api", "err", "Give the key a name."));
    if (!scopes.length) return redirect(withFlash("/admin/api", "err", "Pick at least one permission."));
    const { key } = await createApiKey({ name, mailboxId, scopes, userId: ctx.user!.id });
    // Rendered directly (not redirected) so the key never sits in a URL or history entry.
    return DevelopersPage(info, { name, key });
  }

  if (op === "revoke") {
    await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now(), field(form, "id")).run();
    return redirect(withFlash("/admin/api", "msg", "Key revoked. Programs using it are refused from now on."));
  }

  if (op === "create_hook") {
    const name = field(form, "name").slice(0, 80);
    const url = field(form, "url");
    const events = form.getAll("events").map(String).filter((e) => EVENTS.some((x) => x.id === e));
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {}
    if (!name) return redirect(withFlash("/admin/api", "err", "Give the webhook a name."));
    if (!parsed || parsed.protocol !== "https:") return redirect(withFlash("/admin/api", "err", "The URL must start with https://."));
    if (!events.length) return redirect(withFlash("/admin/api", "err", "Pick at least one event."));
    const id = newId();
    await env.DB.prepare(
      "INSERT INTO webhooks (id, name, url, secret, mailbox_id, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
      .bind(id, name, parsed.toString(), newSecret(), mailboxId, events.join(","), now())
      .run();
    return redirect(withFlash(`/admin/webhooks/${id}`, "msg", "Webhook added. Copy the signing secret into your receiver."));
  }
  return redirect("/admin/api");
}

/* ---------- /admin/webhooks/:id ---------- */

const statusStyle: Record<string, string> = {
  success: "bg-lime/25 text-foreground dark:bg-lime/15 dark:text-lime",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-destructive/10 text-destructive",
};

export async function WebhookPage({ params, ctx, request }: RequestInfo) {
  const hook = await env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(params.id).first<WebhookRow>();
  if (!hook) return notFound();
  const mailboxes = await listMailboxes();
  const { results: deliveries } = await env.DB.prepare(
    "SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 30",
  )
    .bind(hook.id)
    .all<DeliveryRow>();
  const events = new Set(hook.events.split(","));

  return (
    <Shell user={ctx.user!} folder="api" flash={flashFrom(request)}>
      <PageHeader title={hook.name} back={{ href: "/admin/api", label: "API & webhooks" }} sub={hook.url}>
        <form method="post">
          <input type="hidden" name="op" value="test" />
          <Button variant="outline">Send test event</Button>
        </form>
      </PageHeader>

      <div className="grid max-w-[980px] gap-6">
        <Section title="Signing secret" description="Your receiver uses it to check that a request really comes from this app.">
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium select-none">Show secret</summary>
            <input readOnly value={hook.secret} aria-label="Signing secret" className="mt-3 w-full rounded-md border bg-card px-3 py-2 font-mono text-sm select-all" />
          </details>
          <form method="post" className="mt-4">
            <input type="hidden" name="op" value="rotate" />
            <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
              Generate a new secret
            </Button>
          </form>
        </Section>

        <Section title="Settings">
          <form method="post" className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="op" value="update" />
            <Field label="Name">
              <Input name="name" defaultValue={hook.name} required />
            </Field>
            <Field label="URL">
              <Input name="url" type="url" defaultValue={hook.url} required />
            </Field>
            <Field label="Mailbox">
              <MailboxSelect mailboxes={mailboxes} defaultValue={hook.mailbox_id} />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-sm font-medium">Events</legend>
              {EVENTS.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="events" value={e.id} defaultChecked={events.has(e.id)} className={check} /> {e.label}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" value="1" defaultChecked={!!hook.active} className={check} /> On
            </label>
            <div className="md:col-span-2">
              <Button type="submit">Save webhook</Button>
            </div>
          </form>
        </Section>

        <Section title="Recent deliveries" description="The last 30 attempts, newest first.">
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet. Use “Send test event” to try your receiver.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  <span className={cn("rounded-sm px-2 py-0.5 text-xs font-semibold", statusStyle[d.status])}>{d.status}</span>
                  <span className="font-mono text-xs">{d.event}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {d.last_status ? `HTTP ${d.last_status}` : d.attempts ? "no response" : "queued"}, {d.attempts}{" "}
                    {d.attempts === 1 ? "attempt" : "attempts"}
                  </span>
                  {d.last_error && <span className="min-w-0 flex-1 truncate text-xs text-destructive" title={d.last_error}>{d.last_error}</span>}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatDate(d.created_at, true)}</span>
                  {d.status !== "success" && d.event !== "ping" && (
                    <form method="post">
                      <input type="hidden" name="op" value="retry" />
                      <input type="hidden" name="delivery" value={d.id} />
                      <Button variant="ghost" size="sm" className="h-7">
                        Retry now
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Delete webhook" tone="danger" description="Stops all deliveries and removes their history.">
          <form method="post">
            <input type="hidden" name="op" value="delete" />
            <Button type="submit" variant="destructive">
              Delete {hook.name}
            </Button>
          </form>
        </Section>
      </div>
    </Shell>
  );
}

export async function webhookAction({ params, request }: RequestInfo) {
  const hook = await env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(params.id).first<WebhookRow>();
  if (!hook) return notFound();
  const form = await request.formData();
  const here = `/admin/webhooks/${hook.id}`;

  switch (field(form, "op")) {
    case "test": {
      const ok = await sendTestEvent(hook);
      return redirect(withFlash(here, ok ? "msg" : "err", ok ? "Test event delivered." : "Test event failed. See the delivery below."));
    }
    case "retry": {
      const d = await env.DB.prepare("SELECT * FROM webhook_deliveries WHERE id = ? AND webhook_id = ?")
        .bind(field(form, "delivery"), hook.id)
        .first<DeliveryRow>();
      if (!d) return notFound();
      const ok = await attemptDelivery({ ...d, attempts: 0 }, hook);
      return redirect(withFlash(here, ok ? "msg" : "err", ok ? "Delivered." : "Still failing. Next automatic retry in a minute."));
    }
    case "rotate":
      await env.DB.prepare("UPDATE webhooks SET secret = ? WHERE id = ?").bind(newSecret(), hook.id).run();
      return redirect(withFlash(here, "msg", "New secret generated. Update your receiver."));
    case "delete":
      await env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(hook.id).run();
      return redirect(withFlash("/admin/api", "msg", `${hook.name} deleted.`));
    case "update": {
      const url = field(form, "url");
      const events = form.getAll("events").map(String).filter((e) => EVENTS.some((x) => x.id === e));
      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {}
      if (!parsed || parsed.protocol !== "https:") return redirect(withFlash(here, "err", "The URL must start with https://."));
      if (!events.length) return redirect(withFlash(here, "err", "Pick at least one event."));
      const mailboxId = field(form, "mailbox_id") || null;
      await env.DB.prepare("UPDATE webhooks SET name = ?, url = ?, mailbox_id = ?, events = ?, active = ? WHERE id = ?")
        .bind(field(form, "name") || hook.name, parsed.toString(), mailboxId, events.join(","), form.get("active") === "1" ? 1 : 0, hook.id)
        .run();
      return redirect(withFlash(here, "msg", "Saved."));
    }
  }
  return redirect(here);
}
