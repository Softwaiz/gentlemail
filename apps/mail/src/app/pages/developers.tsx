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
import { Code, CodeSamples, type Sample } from "@/app/components/code-samples";
import { FormSelect, type Option } from "@/app/components/form-select";
import { type AccessTargets, type AccessValue, EditKeyAccessDialog, NewKeyDialog } from "@/app/components/key-dialog";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Field, Section, StatusBadge, cardRow, cardTable, cardTableHeader } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Switch } from "@/app/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { missing } from "@/app/pages/errors";
import { AccessSummary, grantValue, targetNames } from "@/app/components/access-summary";
import { Connections } from "@/app/components/connections";
import { type ApiKeyRow, type Grant, listActiveGrants, listConnections } from "@/lib/apikeys";
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

/* ---------- Quick reference ---------- */

/** The GentleMail docs. They follow the latest release, so a much older instance may lack some of what they describe. */
const DOCS = {
  sdk: "https://gentlemail.dev/docs/sdk/",
  api: "https://gentlemail.dev/docs/api/",
  webhooks: "https://gentlemail.dev/docs/webhooks/",
  npm: "https://www.npmjs.com/package/gentlemail",
};

const link = "font-medium text-foreground underline underline-offset-4 hover:no-underline";
const mono = (s: string) => <code className="font-mono">{s}</code>;

/** Send, read and webhooks, each with the SDK and over HTTP. `base` is this instance's URL. */
const samples = (base: string, example: string): Sample[] => [
  {
    title: "Send an email",
    sdk: `import { GentleMail } from "gentlemail";

const mail = new GentleMail({ url: "${base}", apiKey: process.env.GENTLEMAIL_KEY });

await mail.send({
  from: "${example}",
  to: "someone@example.com",
  subject: "Your invoice",
  text: "Hello, the invoice is attached.",
  attachments: [{ filename: "invoice.pdf", content: pdfBytes }], // bytes or base64
});`,
    http: `curl ${base}/api/v1/send \\
  -H "Authorization: Bearer $GENTLEMAIL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "${example}",
    "to": ["someone@example.com"],
    "subject": "Your invoice",
    "text": "Hello, the invoice is attached.",
    "attachments": [{ "filename": "invoice.pdf", "content": "<base64>", "content_type": "application/pdf" }]
  }'`,
    sdkNote: (
      <>
        Optional: {mono("html")}, {mono("cc")}, {mono("bcc")}, {mono("signature: true")}. To answer in the same thread, use{" "}
        {mono("mail.messages.reply(message, { text })")}.
      </>
    ),
    httpNote: (
      <>
        Optional: {mono("html")}, {mono("cc")}, {mono("bcc")}, {mono("signature: true")}, and {mono("reply_to_message_id")} to
        answer in the same thread.
      </>
    ),
  },
  {
    title: "Read mail",
    sdk: `const mailboxes = await mail.mailboxes.list();       // the ones this key can use
const unread = await mail.messages.list({ mailbox: "${example}", unread: true });
const message = await mail.messages.get(unread[0].id);  // full text and HTML
await mail.messages.update(message.id, "archive");       // read, unread, star, unstar, archive, trash, spam, inbox
await mail.messages.reply(message, { text: "Thanks, we're on it." });
const file = await mail.attachments.download(message.attachments[0].url);`,
    http: `GET  /api/v1/mailboxes
GET  /api/v1/messages?mailbox=${example}&folder=inbox&unread=true&since=2026-11-01
GET  /api/v1/messages/{id}             full text, raw HTML, attachment links
GET  /api/v1/attachments/{id}          file bytes
POST /api/v1/messages/{id}  {"action":"archive"}   read, unread, star, unstar, archive, trash, spam, inbox`,
    sdkNote: <>Reading needs a key with the Read permission on that mailbox, marking and moving needs Organize, and sending needs Send.</>,
    httpNote: <>Reading needs a key with the Read permission on that mailbox, marking and moving needs Organize, and sending needs Send.</>,
  },
  {
    title: "Receive webhooks",
    sdk: `import { verifyWebhook } from "gentlemail";

export default {
  async fetch(request, env) {
    const event = await verifyWebhook(request, env.WEBHOOK_SECRET).catch(() => null);
    if (!event) return new Response("Bad signature", { status: 401 });

    if (event.event === "message.received") {
      console.log(event.data.from.address, event.data.subject);
    }
    return new Response("OK");
  },
};`,
    http: `POST <your url>
X-GentleMail-Event: message.received
X-GentleMail-Delivery: <id, use it to ignore duplicates>
X-GentleMail-Timestamp: <unix seconds>
X-GentleMail-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>

{ "id": "...", "event": "message.received", "created_at": "...",
  "data": { "id", "thread_id", "mailbox", "from", "to", "subject", "text", "attachments": [{ "url", ... }], ... } }`,
    sdkNote: (
      <>
        {mono("verifyWebhook")} checks the signature and refuses events older than five minutes. Answer with any 2xx within 10
        seconds; anything else is retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h.
      </>
    ),
    httpNote: (
      <>
        Check the signature and reject timestamps older than five minutes. Answer with any 2xx status within 10 seconds;
        anything else is retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h. Attachment URLs need a key with the Read
        permission.
      </>
    ),
  },
];

/* ---------- /admin/api ---------- */

export async function DevelopersPage({ ctx, request }: RequestInfo) {
  const mailboxes = await listMailboxes();
  const { results: domains } = await env.DB.prepare("SELECT id, name FROM domains ORDER BY name").all<{ id: string; name: string }>();
  const targets: AccessTargets = { domains, mailboxes };
  const names = targetNames(targets);
  const label = (id: string | null) => (id ? (names.get(`mailbox:${id}`) ?? "deleted mailbox") : "All mailboxes");

  const { results: keys } = await env.DB.prepare(
    "SELECT * FROM api_keys WHERE user_id IS NULL ORDER BY revoked_at IS NOT NULL, created_at DESC",
  ).all<ApiKeyRow>();
  const [grants, connections, connectionGrants] = await Promise.all([listActiveGrants(), listConnections(), listActiveGrants("connections")]);
  const grantsByKey = new Map<string, Grant[]>();
  for (const g of grants) {
    const list = grantsByKey.get(g.key_id);
    if (list) list.push(g);
    else grantsByKey.set(g.key_id, [g]);
  }
  const grantsOf = (id: string) => grantsByKey.get(id) ?? [];
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
          description="Give each key Read, Organize and/or Send on all mailboxes, whole domains or the mailboxes you pick."
          action={<NewKeyDialog targets={targets} />}
        >
          {/* Phones and tablets: each key is a small card (name, key and buttons; access; last use). */}
          <Table className={cardTable}>
            <TableHeader className={cardTableHeader}>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow
                  key={k.id}
                  className={cn(cardRow, "max-lg:grid-cols-[1fr_auto]", k.revoked_at && "opacity-50")}
                >
                  <TableCell className="min-w-32 whitespace-normal max-lg:min-w-0">
                    <div className="font-medium">{k.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{k.prefix}…</div>
                  </TableCell>
                  <TableCell className="whitespace-normal max-lg:col-span-2 max-lg:row-start-2">
                    {k.revoked_at ? <span className="text-muted-foreground">None</span> : <AccessSummary grants={grantsOf(k.id)} names={names} />}
                  </TableCell>
                  <TableCell className="text-muted-foreground lg:min-w-28 lg:whitespace-normal max-lg:col-span-2 max-lg:row-start-3 max-lg:text-xs">
                    {k.last_used_at ? (
                      <>
                        <span className="lg:hidden">Last used </span>
                        {formatDate(k.last_used_at, true)}
                      </>
                    ) : (
                      <>
                        Never<span className="lg:hidden"> used</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right max-lg:col-start-2 max-lg:row-start-1 max-lg:self-start">
                    {k.revoked_at ? (
                      <span className="text-xs text-muted-foreground">Revoked</span>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <EditKeyAccessDialog keyId={k.id} name={k.name} targets={targets} initial={grantValue(grantsOf(k.id))} />
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
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {keys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center whitespace-normal text-muted-foreground max-lg:block">
                    No keys yet. Create one for each program that sends or reads mail.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Section>

        <Connections
          connections={connections}
          grants={connectionGrants}
          names={names}
          mcpUrl={`${base}/mcp`}
          showOwner
        />

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
                    {/* Phones: name and status, then the URL on its own line, then mailbox and failures. */}
                    <span className="min-w-0 font-medium max-sm:flex-auto sm:min-w-40">{h.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground max-sm:order-2 max-sm:basis-full">{h.url}</span>
                    <span className="text-xs text-muted-foreground max-sm:order-3">{label(h.mailbox_id)}</span>
                    {h.failed > 0 && <span className="text-xs font-medium text-destructive max-sm:order-4">{h.failed} failed</span>}
                    <span className="max-sm:order-1">
                      <StatusBadge on={!!h.active} onLabel="On" offLabel="Off" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Quick reference"
          description="Use the JavaScript SDK, or call the HTTP API from any language. Each example runs as is with a key from above."
        >
          <CodeSamples
            intro={{
              sdk: (
                <>
                  Install{" "}
                  <a href={DOCS.npm} className={link}>
                    gentlemail
                  </a>{" "}
                  from npm: typed, no dependencies, runs on Workers, Node 20+, Deno and Bun. It also checks webhook
                  signatures for you.
                  <Code>npm install gentlemail</Code>
                </>
              ),
              http: (
                <>
                  Base URL <code className="font-mono text-foreground">{base}/api/v1</code>. Send the key as a Bearer token.
                </>
              ),
            }}
            samples={samples(base, example)}
          />
          <p className="mt-6 border-t pt-4 text-sm text-muted-foreground">
            Go further in the docs:{" "}
            <a href={DOCS.sdk} className={link}>
              SDK guide
            </a>
            {" · "}
            <a href={DOCS.api} className={link}>
              API reference
            </a>
            {" · "}
            <a href={DOCS.webhooks} className={link}>
              Webhooks
            </a>
          </p>
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

export async function WebhookPage(ri: RequestInfo) {
  const { params, ctx, request } = ri;
  const hook = await env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(params.id).first<WebhookRow>();
  if (!hook) return missing(ri, "webhook");
  const mailboxes = await listMailboxes();
  const { results: deliveries } = await env.DB.prepare(
    "SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 30",
  )
    .bind(hook.id)
    .all<DeliveryRow>();

  return (
    <Shell user={ctx.user!} folder="api" flash={flashFrom(request)}>
      <PageHeader title={hook.name} back={{ href: "/admin/api", label: "API & webhooks" }} sub={<span className="[overflow-wrap:anywhere]">{hook.url}</span>}>
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
                  {/* Phones: status, event and date; then the response and Retry; then the error, in full. */}
                  <span className="text-xs text-muted-foreground tabular-nums max-sm:order-2 max-sm:grow max-sm:basis-1/2">
                    {d.last_status ? `HTTP ${d.last_status}` : d.attempts ? "no response" : "queued"}, {d.attempts}{" "}
                    {d.attempts === 1 ? "attempt" : "attempts"}
                  </span>
                  {d.last_error && (
                    <span className="min-w-0 flex-1 truncate text-xs text-destructive max-sm:order-4 max-sm:line-clamp-2 max-sm:basis-full max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]" title={d.last_error}>
                      {d.last_error}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums max-sm:order-1">{formatDate(d.created_at, true)}</span>
                  {d.status !== "success" && d.event !== "ping" && (
                    <ActionButton variant="ghost" size="sm" className="h-7 max-sm:order-3 max-sm:-my-1" action={retryDeliveryAction} args={[hook.id, d.id]}>
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
