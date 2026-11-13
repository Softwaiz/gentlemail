import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Field, Section, StatusBadge } from "@/app/components/section";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/app/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { Textarea } from "@/app/components/ui/textarea";
import { field, notFound, redirect, withFlash } from "@/app/http";
import { DomainsSection, listDomainsWithCounts } from "@/app/pages/domains";
import { createUser, hashPassword } from "@/lib/auth";
import { type Mailbox, isDomainActive } from "@/lib/db";
import { isEmail, newId, now } from "@/lib/util";

type UserRow = { id: string; email: string; name: string; role: string; created_at: number };

/* ---------- Overview: domains, mailboxes, users ---------- */

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
  const stats = [
    { n: domains.length, label: domains.length === 1 ? "domain" : "domains" },
    { n: mailboxes.length, label: mailboxes.length === 1 ? "mailbox" : "mailboxes" },
    { n: users.length, label: users.length === 1 ? "user" : "users" },
  ];

  return (
    <Shell user={user} folder="admin" flash={flashFrom(request)}>
      <PageHeader title="Admin">
        <div className="flex gap-6">
          {stats.map((s) => (
            <div key={s.label} className="text-right">
              <div className="font-display text-3xl leading-none tabular-nums">{s.n}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-col gap-6">
        <DomainsSection domains={domains} />

        <Section title="Mailboxes" description="Addresses that receive and send mail. Each one can be shared with several users.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Sender name</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mailboxes.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <a href={`/mb/${m.id}/inbox`} className="font-medium hover:underline">
                      {m.address}
                    </a>
                  </TableCell>
                  <TableCell>{m.display_name}</TableCell>
                  <TableCell className="text-muted-foreground">{m.members || "Admins only"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.total}</TableCell>
                  <TableCell>
                    <StatusBadge on={!!m.active} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/admin/mailboxes/${m.id}`}>Manage</a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {mailboxes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No mailboxes yet. Create the first one below.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="mt-6 rounded-md bg-muted/50 p-4">
            <h3 className="mb-3 text-sm font-semibold">New mailbox</h3>
            {usable.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add an active domain above before creating mailboxes.</p>
            ) : (
              <form method="post" action="/admin/mailboxes" className="flex flex-wrap items-end gap-3">
                <div className="grid min-w-72 flex-[2] gap-1.5">
                  <span className="text-sm font-medium">Address</span>
                  <div className="flex items-center rounded-md border border-input bg-card focus-within:ring-[3px] focus-within:ring-ring/50">
                    <input
                      name="local"
                      placeholder="hello"
                      required
                      pattern="[A-Za-z0-9._+\-]+"
                      aria-label="Name before the @"
                      className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                    />
                    <span className="px-1 text-muted-foreground">@</span>
                    <select name="domain" aria-label="Domain" className="h-9 rounded-r-md bg-transparent pr-3 pl-1 text-sm outline-none">
                      {usable.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid min-w-56 flex-1 gap-1.5">
                  <span className="text-sm font-medium">Sender name</span>
                  <Input name="display_name" placeholder="Acme Support" required className="bg-card" />
                </div>
                <Button type="submit">Create mailbox</Button>
              </form>
            )}
          </div>
        </Section>

        <Section title="Users" description="Members only see the mailboxes you give them. Admins see every mailbox.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Login email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <StatusBadge on={u.role === "admin"} onLabel="Admin" offLabel="Member" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/admin/users/${u.id}`}>Edit</a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 rounded-md bg-muted/50 p-4">
            <h3 className="mb-3 text-sm font-semibold">New user</h3>
            <form method="post" action="/admin/users" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_140px_auto] lg:items-end">
              <Field label="Name">
                <Input name="name" required className="bg-card" />
              </Field>
              <Field label="Login email">
                <Input name="email" type="email" required className="bg-card" />
              </Field>
              <Field label="Password">
                <Input name="password" type="password" placeholder="10+ characters" minLength={10} required autoComplete="new-password" className="bg-card" />
              </Field>
              <Field label="Role">
                <NativeSelect name="role" className="bg-card">
                  <NativeSelectOption value="member">Member</NativeSelectOption>
                  <NativeSelectOption value="admin">Admin</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Button type="submit">Add user</Button>
            </form>
          </div>
        </Section>
      </div>
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
      <PageHeader title={mailbox.display_name} back={{ href: "/admin", label: "Admin" }} sub={mailbox.address}>
        <Button variant="outline" asChild>
          <a href={`/mb/${mailbox.id}/inbox`}>Open inbox</a>
        </Button>
      </PageHeader>

      <div className="grid max-w-[980px] gap-6">
        <Section title="Details">
          <form method="post" className="grid gap-5">
            <input type="hidden" name="op" value="update" />
            <Field label="Sender name">
              <Input name="display_name" defaultValue={mailbox.display_name} required />
            </Field>
            <Field label="Signature" hint="Plain text, added under messages sent from this mailbox.">
              <Textarea name="signature" rows={5} defaultValue={mailbox.signature} />
            </Field>
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="active" value="1" defaultChecked={!!mailbox.active} className="size-4 accent-[var(--violet)]" />
              Active: receives and sends mail
            </label>
            <div>
              <Button type="submit">Save details</Button>
            </div>
          </form>
        </Section>

        <Section title="Who can use this mailbox" description="Admins always have access.">
          <form method="post" className="grid gap-4">
            <input type="hidden" name="op" value="members" />
            <div className="grid gap-1 sm:grid-cols-2">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-3 rounded-md border px-3 py-2.5 has-[:checked]:border-foreground/40">
                  <input
                    type="checkbox"
                    name="members"
                    value={u.id}
                    defaultChecked={!!u.member || u.role === "admin"}
                    disabled={u.role === "admin"}
                    className="size-4 accent-[var(--violet)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.email}
                      {u.role === "admin" ? ", admin" : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div>
              <Button type="submit">Save access</Button>
            </div>
          </form>
        </Section>

        <Section
          title="Delete mailbox"
          tone="danger"
          description="Permanently deletes the mailbox with all its messages and attachments. This can't be undone."
        >
          <form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="op" value="delete" />
            <div className="min-w-64 flex-1">
              <Field label={`Type ${mailbox.address} to confirm`}>
                <Input name="confirm" placeholder={mailbox.address} autoComplete="off" />
              </Field>
            </div>
            <Button type="submit" variant="destructive">
              Delete forever
            </Button>
          </form>
        </Section>
      </div>
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
      <PageHeader title={u.name} back={{ href: "/admin", label: "Admin" }} sub={u.email} />
      <div className="grid max-w-[720px] gap-6">
        <Section title="Account">
          <form method="post" className="grid gap-5">
            <input type="hidden" name="op" value="update" />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" defaultValue={u.name} required />
              </Field>
              <Field label="Login email">
                <Input name="email" type="email" defaultValue={u.email} required />
              </Field>
            </div>
            <Field label="Role" hint={isSelf ? "You can't change your own role." : undefined}>
              <NativeSelect name="role" defaultValue={u.role} disabled={isSelf}>
                <NativeSelectOption value="member">Member</NativeSelectOption>
                <NativeSelectOption value="admin">Admin</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field label="New password" hint="Leave empty to keep the current one. Changing it signs the user out elsewhere.">
              <Input name="password" type="password" minLength={10} autoComplete="new-password" />
            </Field>
            <div>
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </Section>
        {!isSelf && (
          <Section title="Remove user" tone="danger" description="They lose access straight away. Mailboxes and mail are kept.">
            <form method="post">
              <input type="hidden" name="op" value="delete" />
              <Button type="submit" variant="destructive">
                Remove {u.name}
              </Button>
            </form>
          </Section>
        )}
      </div>
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
