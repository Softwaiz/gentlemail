import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Section, StatusBadge } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteDomain, setDomainActive } from "@/app/actions/admin";
import { ActionSwitch, ConfirmAction } from "@/app/components/action-form";
import { notFound } from "@/app/http";
import type { Domain, Mailbox } from "@/lib/db";

type DomainWithCount = Domain & { mailboxes: number };

export async function listDomainsWithCounts(): Promise<DomainWithCount[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.*, (SELECT COUNT(*) FROM mailboxes m WHERE m.address LIKE '%@' || d.name) AS mailboxes
     FROM domains d ORDER BY d.name`,
  ).all<DomainWithCount>();
  return results;
}

/* ---------- Grid on the admin overview ---------- */

export function DomainsGrid({ domains }: { domains: DomainWithCount[] }) {
  if (domains.length === 0)
    return (
      <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No domains yet. Use “New domain” to add the first one.
      </p>
    );
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {domains.map((d) => (
        <li key={d.id}>
          <a
            href={`/admin/domains/${d.id}`}
            className="group flex h-full flex-col justify-between gap-4 rounded-md border p-4 transition-colors hover:border-foreground/30 hover:bg-accent/40"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{d.name}</span>
              <StatusBadge on={!!d.active} />
            </div>
            <div className="flex items-end justify-between text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground tabular-nums">{d.mailboxes}</span>{" "}
                {d.mailboxes === 1 ? "mailbox" : "mailboxes"}
              </span>
              <span className="text-xs font-medium group-hover:text-foreground">Setup and status</span>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ---------- DNS checks (public DNS over HTTPS) ---------- */

type Check = { label: string; state: "ok" | "warn" | "missing" | "error"; detail: string };

async function lookup(name: string, type: "MX" | "TXT"): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const json = await res.json<{ Answer?: { type: number; data: string }[] }>();
  const code = type === "MX" ? 15 : 16;
  return (json.Answer ?? [])
    .filter((a) => a.type === code)
    .map((a) => (type === "TXT" ? a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, "") : a.data));
}

async function checkDomain(name: string): Promise<Check[]> {
  const safe = async (label: string, fn: () => Promise<Check>): Promise<Check> => {
    try {
      return await fn();
    } catch (e) {
      return { label, state: "error", detail: e instanceof Error ? e.message : "Lookup failed" };
    }
  };
  return Promise.all([
    safe("Receiving (MX)", async () => {
      const hosts = (await lookup(name, "MX")).map((r) => r.split(/\s+/).pop()!.replace(/\.$/, "").toLowerCase());
      const cf = hosts.filter((h) => h.endsWith(".mx.cloudflare.net"));
      if (!hosts.length) return { label: "Receiving (MX)", state: "missing", detail: "No MX records. Enable Email Routing." };
      if (cf.length === hosts.length) return { label: "Receiving (MX)", state: "ok", detail: hosts.join(", ") };
      if (cf.length) return { label: "Receiving (MX)", state: "warn", detail: `Mixed MX records: ${hosts.join(", ")}` };
      return { label: "Receiving (MX)", state: "missing", detail: `MX points elsewhere: ${hosts.join(", ")}` };
    }),
    safe("SPF", async () => {
      const spf = (await lookup(name, "TXT")).find((t) => t.toLowerCase().startsWith("v=spf1"));
      if (!spf) return { label: "SPF", state: "missing", detail: "No SPF record." };
      return spf.includes("cloudflare.net")
        ? { label: "SPF", state: "ok", detail: spf }
        : { label: "SPF", state: "warn", detail: `SPF doesn't include Cloudflare: ${spf}` };
    }),
    safe("DMARC", async () => {
      const dmarc = (await lookup(`_dmarc.${name}`, "TXT")).find((t) => t.toUpperCase().startsWith("V=DMARC1"));
      return dmarc
        ? { label: "DMARC", state: "ok", detail: dmarc }
        : { label: "DMARC", state: "missing", detail: "No DMARC record. Recommended for deliverability." };
    }),
  ]);
}

const stateStyle: Record<Check["state"], string> = {
  ok: "bg-lime/25 text-foreground dark:bg-lime/15 dark:text-lime",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  missing: "bg-destructive/10 text-destructive",
  error: "bg-muted text-muted-foreground",
};
const stateLabel: Record<Check["state"], string> = { ok: "OK", warn: "Check", missing: "Missing", error: "Unknown" };

/* ---------- Single domain ---------- */

export async function AdminDomainPage({ params, ctx, request }: RequestInfo) {
  const domain = await env.DB.prepare("SELECT * FROM domains WHERE id = ?").bind(params.id).first<Domain>();
  if (!domain) return notFound();
  const [{ results: mailboxes }, checks] = await Promise.all([
    env.DB.prepare("SELECT * FROM mailboxes WHERE address LIKE ? ORDER BY address")
      .bind(`%@${domain.name}`)
      .all<Mailbox>(),
    checkDomain(domain.name),
  ]);
  const worker = env.WORKER_NAME || "<worker-name>";
  const d = domain.name;
  const steps = [
    { title: `Allow sending from *@${d}`, cmd: `npx wrangler email sending enable ${d}` },
    { title: "Receive mail (adds MX and SPF records)", cmd: `npx wrangler email routing enable ${d}` },
    {
      title: "Deliver every address to this app",
      cmd: null,
      text: (
        <>
          In the Cloudflare dashboard, open {d}, then Email, then Email Routing, then Routing rules. Edit the
          catch-all: action <strong>Send to a Worker</strong>, Worker <code className="font-mono">{worker}</code>, enabled.
        </>
      ),
    },
  ];

  return (
    <Shell user={ctx.user!} folder="admin" flash={flashFrom(request)}>
      <PageHeader title={d} back={{ href: "/admin", label: "Admin" }}>
        <label className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2 text-sm">
          <ActionSwitch action={setDomainActive} id={domain.id} checked={!!domain.active} label={`${d} active`} />
          {domain.active ? "Active" : "Turned off"}
        </label>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="DNS status" description="Live lookup of public DNS. Refresh the page after a change.">
          <ul className="divide-y rounded-md border">
            {checks.map((c) => (
              <li key={c.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="w-32 text-sm font-medium">{c.label}</span>
                <span className={cn("rounded-sm px-2 py-0.5 text-xs font-semibold", stateStyle[c.state])}>{stateLabel[c.state]}</span>
                <span className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Connect this domain"
          description="Run once, from apps/mail, logged in to the Cloudflare account that owns the zone."
        >
          <ol className="grid gap-4">
            {steps.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <span className="grid size-7 place-items-center rounded-sm bg-primary text-sm font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="pt-0.5 text-sm font-medium">{s.title}</div>
                  {s.cmd ? (
                    <pre className="mt-2 overflow-x-auto rounded-md bg-sidebar px-4 py-3 font-mono text-[12.5px] text-sidebar-foreground">
                      <span className="text-lime select-none">$ </span>
                      {s.cmd}
                    </pre>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-xs text-muted-foreground">
            Rules for a specific address, such as a forward to Gmail, still take priority over the catch-all. Mail to an
            address with no mailbox here is rejected.
          </p>
        </Section>

        <Section title={`Mailboxes on ${d}`} className="xl:col-span-2">
          {mailboxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet. Create one from Admin, then Mailboxes.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {mailboxes.map((m) => (
                <li key={m.id}>
                  <a href={`/admin/mailboxes/${m.id}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-sm hover:bg-accent/40">
                    <span className="truncate font-medium">{m.address}</span>
                    <StatusBadge on={!!m.active} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Remove domain" tone="danger" className="xl:col-span-2">
          {mailboxes.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Delete its {mailboxes.length} {mailboxes.length === 1 ? "mailbox" : "mailboxes"} first.
            </p>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Removes {d} from this app. Cloudflare settings stay as they are, so turn off the catch-all too if mail
                shouldn't reach this app anymore.
              </p>
              <div>
                <ConfirmAction
                  trigger={<Button variant="destructive">Remove {d}</Button>}
                  title={`Remove ${d}?`}
                  description="Mail to this domain is rejected from now on. You can add it again later."
                  confirmLabel="Remove domain"
                  action={deleteDomain}
                  args={[domain.id]}
                />
              </div>
            </div>
          )}
        </Section>
      </div>
    </Shell>
  );
}
