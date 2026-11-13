import { env } from "cloudflare:workers";
import type { User } from "@/lib/auth";
import { FOLDERS, domainOf, listMailboxesForUser } from "@/lib/db";
import { Icon, type IconName } from "./icons";

type Props = {
  user: User;
  mailboxId?: string;
  folder?: string;
  flash?: { msg?: string | null; err?: string | null };
  children: React.ReactNode;
};

const folderIcon: Record<string, IconName> = {
  inbox: "inbox",
  sent: "sent",
  archive: "archive",
  spam: "spam",
  trash: "trash",
};

export async function Shell({ user, mailboxId, folder, flash, children }: Props) {
  const mailboxes = await listMailboxesForUser(user);
  const current = mailboxes.find((m) => m.id === mailboxId) ?? null;

  // Group the mailbox list by domain: one instance serves several.
  const byDomain = new Map<string, typeof mailboxes>();
  for (const m of mailboxes) {
    const d = domainOf(m.address);
    byDomain.set(d, [...(byDomain.get(d) ?? []), m]);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <a href="/" className="brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span>{appName()}</span>
        </a>

        {current && (
          <>
            <div className="current-box">
              <div className="current-name truncate">{current.display_name}</div>
              <div className="current-addr truncate">{current.address}</div>
            </div>
            <a href={`/mb/${current.id}/compose`} className="btn btn-primary compose-btn">
              <Icon name="compose" size={17} /> New message
            </a>
            <nav className="nav-group" aria-label="Folders">
              {FOLDERS.map((f) => (
                <a
                  key={f.id}
                  href={`/mb/${current.id}/${f.id}`}
                  className={`nav-item ${folder === f.id ? "active" : ""}`}
                  aria-current={folder === f.id ? "page" : undefined}
                >
                  <Icon name={folderIcon[f.id]} />
                  <span className="grow">{f.label}</span>
                  {f.id === "inbox" && current.unread > 0 && <span className="badge">{current.unread}</span>}
                </a>
              ))}
              <a
                href={`/mb/${current.id}/settings`}
                className={`nav-item ${folder === "settings" ? "active" : ""}`}
              >
                <Icon name="signature" />
                <span className="grow">Signature</span>
              </a>
            </nav>
          </>
        )}

        <div className="nav-section">
          {mailboxes.length === 0 && <div className="muted small pad">No mailboxes yet.</div>}
          {[...byDomain].map(([domain, list]) => (
            <div key={domain} className="domain-group">
              <div className="nav-label">{domain}</div>
              <nav className="nav-group">
                {list.map((m) => (
                  <a
                    key={m.id}
                    href={`/mb/${m.id}/inbox`}
                    className={`nav-item mailbox-item ${m.id === mailboxId ? "active" : ""} ${m.active ? "" : "inactive"}`}
                    title={m.address}
                  >
                    <span className="local truncate grow">{m.address.slice(0, m.address.lastIndexOf("@"))}</span>
                    {m.unread > 0 && <span className="badge quiet">{m.unread}</span>}
                  </a>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          {user.role === "admin" && (
            <a href="/admin" className={`nav-item ${folder === "admin" ? "active" : ""}`}>
              <Icon name="admin" />
              <span className="grow">Admin</span>
            </a>
          )}
          <div className="me">
            <div className="avatar sm">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="truncate grow">
              <div className="me-name truncate">{user.name}</div>
              <div className="muted small truncate">{user.email}</div>
            </div>
            <form method="post" action="/logout">
              <button className="icon-btn" type="submit" title="Log out" aria-label="Log out">
                <Icon name="logout" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="main">
        {flash?.msg && <div className="flash ok" role="status">{flash.msg}</div>}
        {flash?.err && <div className="flash err" role="alert">{flash.err}</div>}
        {children}
      </main>
    </div>
  );
}

export const appName = () => env.APP_NAME || "Mail";

export const flashFrom = (request: Request) => {
  const u = new URL(request.url);
  return { msg: u.searchParams.get("msg"), err: u.searchParams.get("err") };
};
