import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { Plus } from "lucide-react";
import {
  createWebhookAction,
  deleteWebhookAction,
  retryDeliveryAction,
  revokeKeyAction,
  rotateSecretAction,
  testWebhookAction,
  updateWebhookAction,
} from "@/app/actions/admin";
import { ActionButton, ActionForm, ConfirmAction, FormDialog } from "@/app/components/action-form";
import { FormSelect, type Option } from "@/app/components/form-select";
import { NewKeyDialog } from "@/app/components/key-dialog";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Field, Section, StatusBadge } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Switch } from "@/app/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { notFound } from "@/app/http";
import { type ApiKeyRow, SCOPES } from "@/lib/apikeys";
import { type Mailbox } from "@/lib/db";
import { formatDate } from "@/lib/util";
import { cn } from "@/lib/utils";
import { type DeliveryRow, EVENTS, type WebhookRow, publicUrl } from "@/lib/webhooks";

const listMailboxes = async () =>
  (await env.DB.prepare("SELECT id, address FROM mailboxes ORDER BY address").all<Pick<Mailbox, "id" | "address">>()).results;

const mailboxOptions = (list: { id: string; address: string }[]): Option[] => [
  { value: "all", label: "All mailboxes" },
  ...list.map((m) => ({ value: m.id, label: m.address })),
];

/** Fields shared by "New webhook" and the webhook settings. */
function HookFields({ mailboxes, hook }: { mailboxes: { id: string; address: string }[]; hook?: WebhookRow }) {
  const events = new Set(hook ? hook.events.split(",") : ["message.received"]);
  return (
    <>
      {hook && <input type="hidden" name="id" value={hook.id} />}
      <Field label="Name">
        <Input name="name" placeholder="Invoice processor" defaultValue={hook?.name} required autoFocus={!hook} />
      </Field>
      <Field label="URL" hint="Must be https. We POST each event here.">
        <Input name="url" type="url" placeholder="https://agents.example.com/hooks/mail" defaultValue={hook?.url} required />
      </Field>
      <Field label="Mailbox">
        <FormSelect name="mailbox_id" options={mailboxOptions(mailboxes)} defaultValue={hook?.mailbox_id ?? "all"} aria-label="Mailbox" />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Events</legend>
        {EVENTS.map((e) => (
          <label key={e.id} className="flex items-center gap-2.5 text-sm">
            <Checkbox name="events" value={e.id} defaultChecked={events.has(e.id)} />
            {e.label} <code className="font-mono text-xs text-muted-foreground">{e.id}</code>
          </label>
        ))}
      </fieldset>
    </>
  );
}

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-md bg-sidebar px-4 py-3 font-mono text-[12.5px] leading-relaxed text-sidebar-foreground">{children}</pre>
);

/* ---------- /admin/api ---------- */

export async function DevelopersPage({ ctx, request }: RequestInfo) {
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
        <Section
          title="API keys"
          description="Each key can be limited to one mailbox and to sending, reading, or both."
          action={<NewKeyDialog mailboxes={mailboxes.map((m) => ({ value: m.id, label: m.address }))} scopes={SCOPES} />}
        >
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
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                            Revoke
                          </Button>
                        }
                        title={`Revoke “${k.name}”?`}
                        description="Programs using this key are refused from the next request. This can't be undone."
                        confirmLabel="Revoke key"
                        action={revokeKeyAction}
                        args={[k.id]}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {keys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No keys yet. Create one for each program that sends or reads mail.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>


        </Section>

        <Section
          title="Webhooks"
          description="We POST a signed JSON event to your URL when mail arrives or is sent. Failed deliveries are retried for about a day."
          action={
            <FormDialog
              trigger={
                <Button>
                  <Plus /> New webhook
                </Button>
              }
              title="New webhook"
              description="You'll get its signing secret on the next screen."
              action={createWebhookAction}
              submitLabel="Add webhook"
            >
              <HookFields mailboxes={mailboxes} />
            </FormDialog>
          }
        >
          {hooks.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No webhooks yet. Add one to start a workflow when mail arrives.
            </p>
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

  return (
    <Shell user={ctx.user!} folder="api" flash={flashFrom(request)}>
      <PageHeader title={hook.name} back={{ href: "/admin/api", label: "API & webhooks" }} sub={hook.url}>
        <ActionButton variant="outline" action={testWebhookAction} args={[hook.id]}>
          Send test event
        </ActionButton>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Signing secret" description="Your receiver uses it to check that a request really comes from this app.">
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium select-none">Show secret</summary>
            <input readOnly value={hook.secret} aria-label="Signing secret" className="mt-3 w-full rounded-md border bg-card px-3 py-2 font-mono text-sm select-all" />
          </details>
          <div className="mt-4">
            <ConfirmAction
              trigger={
                <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
                  Generate a new secret
                </Button>
              }
              title="Generate a new secret?"
              description="The old one stops working right away, so deliveries fail until your receiver uses the new one."
              confirmLabel="Generate secret"
              action={rotateSecretAction}
              args={[hook.id]}
            />
          </div>
        </Section>

        <Section title="Settings">
          <ActionForm action={updateWebhookAction} submitLabel="Save webhook">
            <HookFields mailboxes={mailboxes} hook={hook} />
            <label className="flex items-center gap-3 text-sm">
              <Switch name="active" defaultChecked={!!hook.active} />
              <span className="font-medium">On</span>
            </label>
          </ActionForm>
        </Section>

        <Section title="Recent deliveries" description="The last 30 attempts, newest first." className="xl:col-span-2">
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
                    <ActionButton variant="ghost" size="sm" className="h-7" action={retryDeliveryAction} args={[hook.id, d.id]}>
                      Retry now
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Delete webhook" tone="danger" description="Stops all deliveries and removes their history." className="xl:col-span-2">
          <ConfirmAction
            trigger={<Button variant="destructive">Delete {hook.name}</Button>}
            title={`Delete ${hook.name}?`}
            description="No more events are sent to this URL, and the delivery history is removed."
            confirmLabel="Delete webhook"
            action={deleteWebhookAction}
            args={[hook.id]}
          />
        </Section>
      </div>
    </Shell>
  );
}
