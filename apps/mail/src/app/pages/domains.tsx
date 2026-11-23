import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Section, StatusBadge } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteDomain, setDomainActive } from "@/app/actions/admin";
import { ActionSwitch, ConfirmAction } from "@/app/components/action-form";
import { missing } from "@/app/pages/errors";
import type { Domain, Mailbox } from "@/lib/db";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

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
        {t({ id: "domains.no_domains_yet_use", message: "No domains yet. Use “New domain” to add the first one." })}
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
                {t({ id: "admin.count_mailboxes", message: plural(d.mailboxes, { one: "# mailbox", other: "# mailboxes" }) })}
              </span>
              <span className="text-xs font-medium group-hover:text-foreground">{t({ id: "domains.setup_status", message: "Setup and status" })}</span>
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
      return { label, state: "error", detail: e instanceof Error ? e.message : t({ id: "domains.lookup_failed", message: "Lookup failed" }) };
    }
  };
  return Promise.all([
    safe(t({ id: "domains.receiving_mx", message: "Receiving (MX)" }), async () => {
      const hosts = (await lookup(name, "MX")).map((r) => r.split(/\s+/).pop()!.replace(/\.$/, "").toLowerCase());
      const cf = hosts.filter((h) => h.endsWith(".mx.cloudflare.net"));
      if (!hosts.length) return { label: t({ id: "domains.receiving_mx", message: "Receiving (MX)" }), state: "missing", detail: t({ id: "domains.no_mx", message: "No MX records. Enable Email Routing." }) };
      if (cf.length === hosts.length) return { label: t({ id: "domains.receiving_mx", message: "Receiving (MX)" }), state: "ok", detail: hosts.join(", ") };
      if (cf.length) return { label: t({ id: "domains.receiving_mx", message: "Receiving (MX)" }), state: "warn", detail: t({ id: "domains.mixed_mx", message: `Mixed MX records: ${hosts.join(", ")}` }) };
      return { label: t({ id: "domains.receiving_mx", message: "Receiving (MX)" }), state: "missing", detail: t({ id: "domains.mx_elsewhere", message: `MX points elsewhere: ${hosts.join(", ")}` }) };
    }),
    safe("SPF", async () => {
      const spf = (await lookup(name, "TXT")).find((t) => t.toLowerCase().startsWith("v=spf1"));
      if (!spf) return { label: "SPF", state: "missing", detail: t({ id: "domains.no_spf", message: "No SPF record." }) };
      return spf.includes("cloudflare.net")
        ? { label: "SPF", state: "ok", detail: spf }
        : { label: "SPF", state: "warn", detail: t({ id: "domains.spf_no_cf", message: `SPF doesn't include Cloudflare: ${spf}` }) };
    }),
    safe("DMARC", async () => {
      const dmarc = (await lookup(`_dmarc.${name}`, "TXT")).find((t) => t.toUpperCase().startsWith("V=DMARC1"));
      return dmarc
        ? { label: "DMARC", state: "ok", detail: dmarc }
        : { label: "DMARC", state: "missing", detail: t({ id: "domains.no_dmarc", message: "No DMARC record. Recommended for deliverability." }) };
    }),
  ]);
}

const stateStyle: Record<Check["state"], string> = {
  ok: "bg-lime/25 text-foreground dark:bg-lime/15 dark:text-lime",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  missing: "bg-destructive/10 text-destructive",
  error: "bg-muted text-muted-foreground",
};
/** Called while rendering, so the words are in the reader's language. */
const stateLabel = (s: Check["state"]) =>
  ({
    ok: t({ id: "domains.state_ok", message: "OK" }),
    warn: t({ id: "domains.state_warn", message: "Check" }),
    missing: t({ id: "domains.state_missing", message: "Missing" }),
    error: t({ id: "domains.state_error", message: "Unknown" }),
  })[s];

/* ---------- Single domain ---------- */

export async function AdminDomainPage(ri: RequestInfo) {
  const { params, ctx, request } = ri;
  const domain = await env.DB.prepare("SELECT * FROM domains WHERE id = ?").bind(params.id).first<Domain>();
  if (!domain) return missing(ri, "domain");
  const [{ results: mailboxes }, checks] = await Promise.all([
    env.DB.prepare("SELECT * FROM mailboxes WHERE address LIKE ? ORDER BY address")
      .bind(`%@${domain.name}`)
      .all<Mailbox>(),
    checkDomain(domain.name),
  ]);
  const worker = __WORKER_NAME__ || "<worker-name>";
  const d = domain.name;
  const steps = [
    { title: t({ id: "domains.allow_sending", message: `Allow sending from *@${d}` }), cmd: `npx wrangler email sending enable ${d}` },
    { title: t({ id: "domains.receive_mail_adds_mx", message: "Receive mail (adds MX and SPF records)" }), cmd: `npx wrangler email routing enable ${d}` },
    {
      title: t({ id: "domains.deliver_every_address_app", message: "Deliver every address to this app" }),
      cmd: null,
      text: (
        <>
          <Trans id="domains.catch_all_steps">
            In the Cloudflare dashboard, open {d}, then Email, then Email Routing, then Routing rules. Edit the catch-all: action{" "}
            <strong>Send to a Worker</strong>, Worker <code className="font-mono">{worker}</code>, enabled.
          </Trans>
        </>
      ),
    },
  ];

  return (
    <Shell user={ctx.user!} folder="admin" flash={flashFrom(request)}>
      <PageHeader title={d} back={{ href: "/admin", label: t({ id: "domains.admin", message: "Admin" }) }}>
        <label className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2 text-sm">
          <ActionSwitch action={setDomainActive} id={domain.id} checked={!!domain.active} label={t({ id: "domains.active_label", message: `${d} active` })} />
          {domain.active ? t({ id: "domains.active", message: "Active" }) : t({ id: "domains.turned_off", message: "Turned off" })}
        </label>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t({ id: "domains.dns_status", message: "DNS status" })} description={t({ id: "domains.live_lookup_public_dns", message: "Live lookup of public DNS. Refresh the page after a change." })}>
          <ul className="divide-y rounded-md border">
            {checks.map((c) => (
              <li key={c.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="w-32 text-sm font-medium">{c.label}</span>
                <span className={cn("rounded-sm px-2 py-0.5 text-xs font-semibold", stateStyle[c.state])}>{stateLabel(c.state)}</span>
                <span className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title={t({ id: "domains.connect_domain", message: "Connect this domain" })}
          description={t({ id: "domains.run_once_from_apps", message: "Run once, from apps/mail, logged in to the Cloudflare account that owns the zone." })}
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
            {t({
              id: "domains.rules_priority",
              message:
                "Rules for a specific address, such as a forward to Gmail, still take priority over the catch-all. Mail to an address with no mailbox here is rejected.",
            })}
          </p>
        </Section>

        <Section title={t({ id: "domains.mailboxes_on", message: `Mailboxes on ${d}` })} className="xl:col-span-2">
          {mailboxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t({ id: "domains.none_yet_create_one", message: "None yet. Create one from Admin, then Mailboxes." })}</p>
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

        <Section title={t({ id: "domains.remove_domain", message: "Remove domain" })} tone="danger" className="xl:col-span-2">
          {mailboxes.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t({ id: "domains.delete_mailboxes_first", message: plural(mailboxes.length, { one: "Delete its # mailbox first.", other: "Delete its # mailboxes first." }) })}
            </p>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                {t({
                  id: "domains.remove_body",
                  message: `Removes ${d} from this app. Cloudflare settings stay as they are, so turn off the catch-all too if mail shouldn't reach this app anymore.`,
                })}
              </p>
              <div>
                <ConfirmAction
                  trigger={<Button variant="destructive">{t({ id: "domains.remove_named", message: `Remove ${d}` })}</Button>}
                  title={t({ id: "domains.remove_title", message: `Remove ${d}?` })}
                  description={t({ id: "domains.mail_domain_rejected_from", message: "Mail to this domain is rejected from now on. You can add it again later." })}
                  confirmLabel={t({ id: "domains.remove_domain", message: "Remove domain" })}
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
