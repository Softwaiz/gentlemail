import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { Icon } from "@/app/components/icons";
import { Shell, flashFrom } from "@/app/components/shell";
import { field, notFound, redirect, withFlash } from "@/app/http";
import type { Domain, Mailbox } from "@/lib/db";
import { newId, now } from "@/lib/util";

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type DomainWithCount = Domain & { mailboxes: number };

export async function listDomainsWithCounts(): Promise<DomainWithCount[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.*, (SELECT COUNT(*) FROM mailboxes m WHERE m.address LIKE '%@' || d.name) AS mailboxes
     FROM domains d ORDER BY d.name`,
  ).all<DomainWithCount>();
  return results;
}

/* ---------- Section on the admin overview ---------- */

export function DomainsSection({ domains }: { domains: DomainWithCount[] }) {
  return (
    <section className="card">
      <h2>Domains</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Mailboxes</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>{d.mailboxes}</td>
              <td>{d.active ? <span className="tag ok">active</span> : <span className="tag">disabled</span>}</td>
              <td>
                <a className="btn btn-sm btn-ghost" href={`/admin/domains/${d.id}`}>
                  Setup &amp; status
                </a>
              </td>
            </tr>
          ))}
          {domains.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No domains yet. Add the first one below.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Add domain</h3>
      <form method="post" action="/admin/domains" className="row-form">
        <input name="name" placeholder="example.com" required />
        <button className="btn btn-primary" type="submit">
          Add domain
        </button>
      </form>
      <p className="muted small">
        The domain must be a zone in the same Cloudflare account as this Worker. After adding it, open
        “Setup &amp; status” for the commands that connect it.
      </p>
    </section>
  );
}

export async function createDomainAction({ request }: RequestInfo) {
  const form = await request.formData();
  const name = field(form, "name").toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (!DOMAIN_RE.test(name)) return redirect(withFlash("/admin", "err", "That doesn't look like a domain name."));
  const exists = await env.DB.prepare("SELECT 1 FROM domains WHERE name = ?").bind(name).first();
  if (exists) return redirect(withFlash("/admin", "err", `${name} is already added.`));
  const id = newId();
  await env.DB.prepare("INSERT INTO domains (id, name, active, created_at) VALUES (?, ?, 1, ?)")
    .bind(id, name, now())
    .run();
  return redirect(withFlash(`/admin/domains/${id}`, "msg", `${name} added. Finish the setup below.`));
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

const stateTag = (s: Check["state"]) =>
  s === "ok" ? <span className="tag ok">ok</span> : <span className={`tag ${s === "warn" ? "" : "bad"}`}>{s}</span>;

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

  return (
    <Shell user={ctx.user!} folder="admin" flash={flashFrom(request)}>
      <header className="toolbar">
        <div>
          <a href="/admin" className="back-link">
            <Icon name="back" size={16} /> Admin
          </a>
          <h1>{d}</h1>
        </div>
      </header>

      <section className="card">
        <h2>DNS status</h2>
        <table className="table">
          <tbody>
            {checks.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td>{stateTag(c.state)}</td>
                <td className="muted small break">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Live public DNS lookup. The catch-all rule and the sending setup can't be checked from here, so verify
          them with the commands below.
        </p>
      </section>

      <section className="card">
        <h2>Connect this domain</h2>
        <p className="muted small">Run once, from the app folder, with a Cloudflare login that owns the zone:</p>
        <pre className="code">{`# 1. Allow sending from *@${d}
npx wrangler email sending enable ${d}

# 2. Receive mail (adds MX + SPF records)
npx wrangler email routing enable ${d}

# 3. Deliver every address on ${d} to this app
npx wrangler email routing rules update ${d} catch-all \\
  --action-type worker --action-value ${worker} --enabled true

# Check
npx wrangler email sending list
npx wrangler email routing rules list ${d}`}</pre>
        <p className="muted small">
          Address-specific routing rules (for example a forward to Gmail) still take priority over the catch-all.
          Mail to addresses with no mailbox here is rejected.
        </p>
      </section>

      <section className="card">
        <h2>Mailboxes on {d}</h2>
        {mailboxes.length === 0 ? (
          <p className="muted">None yet. Create one from the Admin page.</p>
        ) : (
          <ul className="plain-list">
            {mailboxes.map((m) => (
              <li key={m.id}>
                <a href={`/admin/mailboxes/${m.id}`}>{m.address}</a> {!m.active && <span className="tag">disabled</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form method="post" className="card stack narrow">
        <input type="hidden" name="op" value="update" />
        <h2>Status</h2>
        <label className="check">
          <input type="checkbox" name="active" value="1" defaultChecked={!!domain.active} /> Active (when off, inbound
          mail to {d} is rejected and sending is blocked)
        </label>
        <div>
          <button className="btn btn-primary" type="submit">
            Save
          </button>
        </div>
      </form>

      <form method="post" className="card stack narrow danger-zone">
        <input type="hidden" name="op" value="delete" />
        <h2>Remove domain</h2>
        {mailboxes.length > 0 ? (
          <p className="muted small">Delete its {mailboxes.length} mailbox(es) first.</p>
        ) : (
          <>
            <p className="muted small">
              Removes {d} from this app. It doesn't change any Cloudflare settings, so also turn off the catch-all
              rule if you no longer want mail delivered here.
            </p>
            <div>
              <button className="btn btn-danger" type="submit">
                Remove domain
              </button>
            </div>
          </>
        )}
      </form>
    </Shell>
  );
}

export async function adminDomainAction({ params, request }: RequestInfo) {
  const domain = await env.DB.prepare("SELECT * FROM domains WHERE id = ?").bind(params.id).first<Domain>();
  if (!domain) return notFound();
  const form = await request.formData();
  const here = `/admin/domains/${domain.id}`;

  if (field(form, "op") === "delete") {
    const used = await env.DB.prepare("SELECT 1 FROM mailboxes WHERE address LIKE ? LIMIT 1")
      .bind(`%@${domain.name}`)
      .first();
    if (used) return redirect(withFlash(here, "err", "Delete the mailboxes on this domain first."));
    await env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(domain.id).run();
    return redirect(withFlash("/admin", "msg", `${domain.name} removed.`));
  }

  await env.DB.prepare("UPDATE domains SET active = ? WHERE id = ?")
    .bind(form.get("active") === "1" ? 1 : 0, domain.id)
    .run();
  return redirect(withFlash(here, "msg", "Saved."));
}
