import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { Icon } from "@/app/components/icons";
import { Shell, flashFrom } from "@/app/components/shell";
import { field, notFound, redirect, withFlash } from "@/app/http";
import { createUser, hashPassword } from "@/lib/auth";
import { type Mailbox, isDomainActive } from "@/lib/db";
import { DomainsSection, listDomainsWithCounts } from "@/app/pages/domains";
import { isEmail, newId, now } from "@/lib/util";

type UserRow = { id: string; email: string; name: string; role: string; created_at: number };

/* ---------- Overview: mailboxes + users ---------- */

export async function AdminPage({ ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const { results: mailboxes } = await env.DB.prepare(
    `SELECT m.*,
      (SELECT COUNT(*) FROM messages x WHERE x.mailbox_id = m.id) AS total,
      (SELECT GROUP_CONCAT(u.name, ', ') FROM mailbox_members mm JOIN users u ON u.id = mm.user_id WHERE mm.mailbox_id = m.id) AS members
     FROM mailboxes m ORDER BY m.address`,
  ).all<Mailbox & { total: number; members: string | null }>();
  const { results: users } = await env.DB.prepare(
    "SELECT id, email, name, role, created_at FROM users ORDER BY created_at",
  ).all<UserRow>();
  const domains = await listDomainsWithCounts();
  const usable = domains.filter((d) => d.active);

  return (
    <Shell user={user} folder="admin" flash={flashFrom(request)}>
      <header className="toolbar">
        <h1>Admin</h1>
      </header>

      <DomainsSection domains={domains} />

      <section className="card">
        <h2>Mailboxes</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Sender name</th>
              <th>Members</th>
              <th>Messages</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mailboxes.map((m) => (
              <tr key={m.id}>
                <td>
                  <a href={`/mb/${m.id}/inbox`}>{m.address}</a>
                </td>
                <td>{m.display_name}</td>
                <td className="muted">{m.members || "admins only"}</td>
                <td>{m.total}</td>
                <td>{m.active ? <span className="tag ok">active</span> : <span className="tag">disabled</span>}</td>
                <td>
                  <a className="btn btn-sm btn-ghost" href={`/admin/mailboxes/${m.id}`}>
                    Manage
                  </a>
                </td>
              </tr>
            ))}
            {mailboxes.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No mailboxes yet — create the first one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h3>New mailbox</h3>
        {usable.length === 0 ? (
          <p className="muted">Add an active domain above before creating mailboxes.</p>
        ) : (
        <form method="post" action="/admin/mailboxes" className="row-form">
          <div className="addr-input">
            <input name="local" placeholder="hello" required pattern="[A-Za-z0-9._+\-]+" />
            <span>@</span>
            <select name="domain">
              {usable.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <input name="display_name" placeholder="Sender name (e.g. Acme Support)" required />
          <button className="btn btn-primary" type="submit">
            Create mailbox
          </button>
        </form>
        )}
      </section>

      <section className="card">
        <h2>Users</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Login email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  <a className="btn btn-sm btn-ghost" href={`/admin/users/${u.id}`}>
                    Edit
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>New user</h3>
        <form method="post" action="/admin/users" className="row-form">
          <input name="name" placeholder="Name" required />
          <input name="email" type="email" placeholder="Login email" required />
          <input name="password" type="password" placeholder="Password (min. 10)" minLength={10} required autoComplete="new-password" />
          <select name="role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" type="submit">
            Add user
          </button>
        </form>
        <p className="muted small">
          Members only see the mailboxes you assign them to. Admins see every mailbox.
        </p>
      </section>
    </Shell>
  );
}

export async function createMailboxAction({ request }: RequestInfo) {
  const form = await request.formData();
  const local = field(form, "local").toLowerCase();
  const domain = field(form, "domain").toLowerCase();
  if (!(await isDomainActive(domain))) return redirect(withFlash("/admin", "err", "Unknown or disabled domain."));
  const address = `${local}@${domain}`;
  if (!/^[a-z0-9._+\-]+$/.test(local) || !isEmail(address)) {
    return redirect(withFlash("/admin", "err", "Invalid address."));
  }
  const exists = await env.DB.prepare("SELECT 1 FROM mailboxes WHERE address = ?").bind(address).first();
  if (exists) return redirect(withFlash("/admin", "err", `${address} already exists.`));
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO mailboxes (id, address, display_name, signature, active, created_at) VALUES (?, ?, ?, '', 1, ?)",
  )
    .bind(id, address, field(form, "display_name") || local, now())
    .run();
  return redirect(withFlash(`/admin/mailboxes/${id}`, "msg", `${address} created.`));
}

export async function createUserAction({ request }: RequestInfo) {
  const form = await request.formData();
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!isEmail(email)) return redirect(withFlash("/admin", "err", "Invalid email."));
  if (password.length < 10) return redirect(withFlash("/admin", "err", "Password must be at least 10 characters."));
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) return redirect(withFlash("/admin", "err", "A user with that email exists."));
  await createUser({
    email,
    name: field(form, "name"),
    password,
    role: field(form, "role") === "admin" ? "admin" : "member",
  });
  return redirect(withFlash("/admin", "msg", "User added."));
}

/* ---------- Single mailbox ---------- */

export async function AdminMailboxPage({ params, ctx, request }: RequestInfo) {
  const mailbox = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(params.id).first<Mailbox>();
  if (!mailbox) return notFound();
  const { results: users } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role,
       EXISTS(SELECT 1 FROM mailbox_members mm WHERE mm.user_id = u.id AND mm.mailbox_id = ?) AS member
     FROM users u ORDER BY u.name`,
  )
    .bind(mailbox.id)
    .all<UserRow & { member: number }>();

  return (
    <Shell user={ctx.user!} folder="admin" flash={flashFrom(request)}>
      <header className="toolbar">
        <div>
          <a href="/admin" className="back-link">
            <Icon name="back" size={16} /> Admin
          </a>
          <h1>{mailbox.address}</h1>
        </div>
      </header>

      <form method="post" className="card stack narrow">
        <input type="hidden" name="op" value="update" />
        <h2>Details</h2>
        <label>
          Sender name
          <input name="display_name" defaultValue={mailbox.display_name} required />
        </label>
        <label>
          Signature
          <textarea name="signature" rows={5} defaultValue={mailbox.signature} />
        </label>
        <label className="check">
          <input type="checkbox" name="active" value="1" defaultChecked={!!mailbox.active} /> Active (receives &amp; sends mail)
        </label>
        <div>
          <button className="btn btn-primary" type="submit">
            Save
          </button>
        </div>
      </form>

      <form method="post" className="card stack narrow">
        <input type="hidden" name="op" value="members" />
        <h2>Who can use this mailbox</h2>
        {users.map((u) => (
          <label key={u.id} className="check">
            <input type="checkbox" name="members" value={u.id} defaultChecked={!!u.member || u.role === "admin"} disabled={u.role === "admin"} />
            {u.name} <span className="muted small">{u.email}{u.role === "admin" ? " · admin (always)" : ""}</span>
          </label>
        ))}
        <div>
          <button className="btn btn-primary" type="submit">
            Save access
          </button>
        </div>
      </form>

      <form method="post" className="card stack narrow danger-zone">
        <input type="hidden" name="op" value="delete" />
        <h2>Delete mailbox</h2>
        <p className="muted small">Permanently deletes the mailbox, all its messages and attachments. Type the address to confirm.</p>
        <input name="confirm" placeholder={mailbox.address} />
        <div>
          <button className="btn btn-danger" type="submit">
            Delete forever
          </button>
        </div>
      </form>
    </Shell>
  );
}

export async function adminMailboxAction({ params, request }: RequestInfo) {
  const mailbox = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(params.id).first<Mailbox>();
  if (!mailbox) return notFound();
  const form = await request.formData();
  const here = `/admin/mailboxes/${mailbox.id}`;

  switch (field(form, "op")) {
    case "update":
      await env.DB.prepare("UPDATE mailboxes SET display_name = ?, signature = ?, active = ? WHERE id = ?")
        .bind(
          field(form, "display_name") || mailbox.display_name,
          String(form.get("signature") ?? "").slice(0, 5000),
          form.get("active") === "1" ? 1 : 0,
          mailbox.id,
        )
        .run();
      return redirect(withFlash(here, "msg", "Saved."));

    case "members": {
      const ids = form.getAll("members").map(String);
      const stmts = [
        env.DB.prepare("DELETE FROM mailbox_members WHERE mailbox_id = ?").bind(mailbox.id),
        ...ids.map((uid) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO mailbox_members (mailbox_id, user_id) SELECT ?, id FROM users WHERE id = ?",
          ).bind(mailbox.id, uid),
        ),
      ];
      await env.DB.batch(stmts);
      return redirect(withFlash(here, "msg", "Access updated."));
    }

    case "delete": {
      if (field(form, "confirm").toLowerCase() !== mailbox.address.toLowerCase()) {
        return redirect(withFlash(here, "err", "Type the exact address to confirm deletion."));
      }
      // Remove R2 objects, then rows (messages/attachments cascade).
      for (const prefix of [`raw/${mailbox.id}/`, `att/${mailbox.id}/`, `bodies/${mailbox.id}/`]) {
        let cursor: string | undefined;
        do {
          const list = await env.MAIL_BUCKET.list({ prefix, cursor });
          if (list.objects.length) await env.MAIL_BUCKET.delete(list.objects.map((o) => o.key));
          cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);
      }
      await env.DB.prepare("DELETE FROM mailboxes WHERE id = ?").bind(mailbox.id).run();
      return redirect(withFlash("/admin", "msg", `${mailbox.address} deleted.`));
    }
  }
  return redirect(here);
}

/* ---------- Single user ---------- */

export async function AdminUserPage({ params, ctx, request }: RequestInfo) {
  const u = await env.DB.prepare("SELECT id, email, name, role, created_at FROM users WHERE id = ?")
    .bind(params.id)
    .first<UserRow>();
  if (!u) return notFound();
  const isSelf = u.id === ctx.user!.id;
  return (
    <Shell user={ctx.user!} folder="admin" flash={flashFrom(request)}>
      <header className="toolbar">
        <div>
          <a href="/admin" className="back-link">
            <Icon name="back" size={16} /> Admin
          </a>
          <h1>{u.name}</h1>
        </div>
      </header>
      <form method="post" className="card stack narrow">
        <input type="hidden" name="op" value="update" />
        <label>
          Name
          <input name="name" defaultValue={u.name} required />
        </label>
        <label>
          Login email
          <input name="email" type="email" defaultValue={u.email} required />
        </label>
        <label>
          Role
          <select name="role" defaultValue={u.role} disabled={isSelf}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>
          New password <span className="muted small">(leave empty to keep)</span>
          <input name="password" type="password" minLength={10} autoComplete="new-password" />
        </label>
        <div>
          <button className="btn btn-primary" type="submit">
            Save
          </button>
        </div>
      </form>
      {!isSelf && (
        <form method="post" className="card stack narrow danger-zone">
          <input type="hidden" name="op" value="delete" />
          <h2>Remove user</h2>
          <p className="muted small">The user loses access. Mailboxes and mail are kept.</p>
          <div>
            <button className="btn btn-danger" type="submit">
              Remove user
            </button>
          </div>
        </form>
      )}
    </Shell>
  );
}

export async function adminUserAction({ params, ctx, request }: RequestInfo) {
  const u = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(params.id).first<UserRow>();
  if (!u) return notFound();
  const isSelf = u.id === ctx.user!.id;
  const form = await request.formData();
  const here = `/admin/users/${u.id}`;

  if (field(form, "op") === "delete") {
    if (isSelf) return redirect(withFlash(here, "err", "You can't remove yourself."));
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(u.id).run();
    return redirect(withFlash("/admin", "msg", "User removed."));
  }

  const email = field(form, "email").toLowerCase();
  if (!isEmail(email)) return redirect(withFlash(here, "err", "Invalid email."));
  const role = isSelf ? u.role : field(form, "role") === "admin" ? "admin" : "member";
  const password = String(form.get("password") ?? "");
  if (password && password.length < 10) return redirect(withFlash(here, "err", "Password too short."));

  const stmts = [
    env.DB.prepare("UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?").bind(field(form, "name"), email, role, u.id),
  ];
  if (password) {
    stmts.push(env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), u.id));
    // Sign the user out everywhere else.
    if (!isSelf) stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id));
  }
  try {
    await env.DB.batch(stmts);
  } catch {
    return redirect(withFlash(here, "err", "That email is already used."));
  }
  return redirect(withFlash(here, "msg", "Saved."));
}
