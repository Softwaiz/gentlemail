import { env } from "cloudflare:workers";
import type { User } from "@/lib/auth";
import { FOLDERS, listMailboxesForUser } from "@/lib/db";

type Props = {
  user: User;
  mailboxId?: string;
  folder?: string;
  flash?: { msg?: string | null; err?: string | null };
  children: React.ReactNode;
};

export async function Shell({ user, mailboxId, folder, flash, children }: Props) {
  const mailboxes = await listMailboxesForUser(user);
  const current = mailboxes.find((m) => m.id === mailboxId) ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <a href="/" className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>{appName()}</span>
        </a>

        {current && (
          <a href={`/mb/${current.id}/compose`} className="btn btn-primary compose-btn">
            ✎ Compose
          </a>
        )}

        {current && (
          <nav className="nav-group">
            {FOLDERS.map((f) => (
              <a
                key={f.id}
                href={`/mb/${current.id}/${f.id}`}
                className={`nav-item ${folder === f.id ? "active" : ""}`}
              >
                <span>{f.label}</span>
                {f.id === "inbox" && current.unread > 0 && <span className="badge">{current.unread}</span>}
              </a>
            ))}
            <a
              href={`/mb/${current.id}/settings`}
              className={`nav-item ${folder === "settings" ? "active" : ""}`}
            >
              Signature &amp; settings
            </a>
          </nav>
        )}

        <div className="nav-label">Mailboxes</div>
        <nav className="nav-group">
          {mailboxes.length === 0 && <div className="muted small pad">No mailboxes yet.</div>}
          {mailboxes.map((m) => (
            <a
              key={m.id}
              href={`/mb/${m.id}/inbox`}
              className={`nav-item mailbox-item ${m.id === mailboxId ? "active" : ""} ${m.active ? "" : "inactive"}`}
              title={m.address}
            >
              <span className="truncate">{m.address}</span>
              {m.unread > 0 && <span className="badge">{m.unread}</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          {user.role === "admin" && (
            <a href="/admin" className={`nav-item ${folder === "admin" ? "active" : ""}`}>
              ⚙ Admin
            </a>
          )}
          <div className="me">
            <div className="truncate">
              <strong>{user.name}</strong>
              <div className="muted small truncate">{user.email}</div>
            </div>
            <form method="post" action="/logout">
              <button className="btn btn-ghost btn-sm" type="submit">
                Log out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="main">
        {flash?.msg && <div className="flash ok">{flash.msg}</div>}
        {flash?.err && <div className="flash err">{flash.err}</div>}
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
