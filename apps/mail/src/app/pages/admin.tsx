import { env } from "cloudflare:workers";
import { Plus } from "lucide-react";
import type { RequestInfo } from "rwsdk/worker";
import {
  createDomain,
  createMailbox,
  createUserAction,
  deleteMailbox,
  deleteUserAction,
  setMailboxMembers,
  updateMailbox,
  updateUserAction,
} from "@/app/actions/admin";
import { ActionForm, ConfirmAction, FormDialog } from "@/app/components/action-form";
import { FormSelect } from "@/app/components/form-select";
import { Field, Section, StatusBadge } from "@/app/components/section";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Switch } from "@/app/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { Textarea } from "@/app/components/ui/textarea";
import { notFound } from "@/app/http";
import { DomainsGrid, listDomainsWithCounts } from "@/app/pages/domains";
import { type Mailbox, domainOf } from "@/lib/db";

type UserRow = { id: string; email: string; name: string; role: string; created_at: number };

const ROLES = [
  { value: "member", label: "Member", hint: "" },
  { value: "admin", label: "Admin", hint: "" },
];

/** A list of checkboxes, e.g. which users can open a mailbox. */
function CheckList({
  name,
  items,
  checked,
  empty,
}: {
  name: string;
  items: { value: string; label: string; sub?: string; locked?: boolean }[];
  checked: Set<string>;
  empty: string;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid max-h-60 gap-1 overflow-y-auto rounded-md border p-1">
      {items.map((i) => (
        <label key={i.value} className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-accent/60">
          <Checkbox name={name} value={i.value} defaultChecked={checked.has(i.value) || i.locked} disabled={i.locked} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{i.label}</span>
            {i.sub && <span className="block truncate text-xs text-muted-foreground">{i.sub}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/* ---------- Overview: domains, mailboxes, users ---------- */

export async function AdminPage({ ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const [{ results: mailboxes }, { results: users }, { results: members }, domains] = await Promise.all([
    env.DB.prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM messages x WHERE x.mailbox_id = m.id) AS total,
        (SELECT GROUP_CONCAT(u.name, ', ') FROM mailbox_members mm JOIN users u ON u.id = mm.user_id WHERE mm.mailbox_id = m.id) AS member_names
       FROM mailboxes m ORDER BY m.address`,
    ).all<Mailbox & { total: number; member_names: string | null }>(),
    env.DB.prepare("SELECT id, email, name, role, created_at FROM users ORDER BY created_at").all<UserRow>(),
    env.DB.prepare("SELECT mailbox_id, user_id FROM mailbox_members").all<{ mailbox_id: string; user_id: string }>(),
    listDomainsWithCounts(),
  ]);
  const usable = domains.filter((d) => d.active);
  const memberUsers = users.filter((u) => u.role !== "admin");
  const mailboxItems = mailboxes.map((m) => ({ value: m.id, label: m.address, sub: m.display_name }));
  const accessOf = (uid: string) => new Set(members.filter((x) => x.user_id === uid).map((x) => x.mailbox_id));

  const userFields = (u?: UserRow) => (
    <>
      {u && <input type="hidden" name="id" value={u.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" defaultValue={u?.name} required autoFocus />
        </Field>
        <Field label="Login email">
          <Input name="email" type="email" defaultValue={u?.email} required />
        </Field>
        <Field label={u ? "New password" : "Password"} hint={u ? "Leave empty to keep the current one." : "At least 10 characters."}>
          <Input name="password" type="password" minLength={10} required={!u} autoComplete="new-password" />
        </Field>
        <Field label="Role" hint={u?.id === user.id ? "You can't change your own role." : "Admins manage everything."}>
          <FormSelect name="role" options={ROLES} defaultValue={u?.role ?? "member"} disabled={u?.id === user.id} aria-label="Role" />
        </Field>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Mailboxes they can open</span>
        <span className="-mt-1 text-xs text-muted-foreground">Only applies to members. Admins open every mailbox.</span>
        <CheckList name="mailboxes" items={mailboxItems} checked={u ? accessOf(u.id) : new Set()} empty="No mailboxes yet." />
      </div>
    </>
  );

  return (
    <Shell user={user} folder="admin" flash={flashFrom(request)}>
      <PageHeader
        title="Admin"
        sub={`${domains.length} ${domains.length === 1 ? "domain" : "domains"}, ${mailboxes.length} ${mailboxes.length === 1 ? "mailbox" : "mailboxes"}, ${users.length} ${users.length === 1 ? "user" : "users"}`}
      />

      <div className="flex flex-col gap-6">
        <Section
          title="Domains"
          description="Every domain this app receives and sends mail for. Each must be a zone in the same Cloudflare account."
          action={
            <FormDialog
              trigger={
                <Button>
                  <Plus /> New domain
                </Button>
              }
              title="Add a domain"
              description="You'll get the steps that connect it to Cloudflare Email next."
              action={createDomain}
              submitLabel="Add domain"
            >
              <Field label="Domain name">
                <Input name="name" placeholder="acme.com" required autoFocus />
              </Field>
            </FormDialog>
          }
        >
          <DomainsGrid domains={domains} />
        </Section>

        <Section
          title="Mailboxes"
          description="Addresses that receive and send mail. Each one can be shared with several users."
          action={
            <FormDialog
              trigger={
                <Button disabled={!usable.length}>
                  <Plus /> New mailbox
                </Button>
              }
              title="New mailbox"
              description="Mail to this address shows up here as soon as it's created."
              action={createMailbox}
              submitLabel="Create mailbox"
              wide
            >
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Address</span>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <Input name="local" placeholder="hello" required pattern="[A-Za-z0-9._+\-]+" aria-label="Name before the @" autoFocus />
                  <span className="text-muted-foreground">@</span>
                  <FormSelect
                    name="domain"
                    aria-label="Domain"
                    options={usable.map((d) => ({ value: d.name, label: d.name }))}
                    defaultValue={usable[0]?.name}
                  />
                </div>
              </div>
              <Field label="Sender name" hint="Recipients see it next to the address.">
                <Input name="display_name" placeholder="Acme Support" required />
              </Field>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Who can use it</span>
                <span className="-mt-1 text-xs text-muted-foreground">Admins always can.</span>
                <CheckList
                  name="members"
                  items={memberUsers.map((u) => ({ value: u.id, label: u.name, sub: u.email }))}
                  checked={new Set()}
                  empty="No members yet. Only admins will see it."
                />
              </div>
            </FormDialog>
          }
        >
          {!usable.length && <p className="mb-4 text-sm text-muted-foreground">Add an active domain before creating mailboxes.</p>}
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
                  <TableCell className="max-w-64 truncate text-muted-foreground">{m.member_names || "Admins only"}</TableCell>
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
                    No mailboxes yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Section>

        <Section
          title="Users"
          description="Members only see the mailboxes you give them. Admins see every mailbox."
          action={
            <FormDialog
              trigger={
                <Button>
                  <Plus /> New user
                </Button>
              }
              title="New user"
              description="They sign in with this email and password."
              action={createUserAction}
              submitLabel="Add user"
              wide
            >
              {userFields()}
            </FormDialog>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Login email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Mailboxes</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const access = accessOf(u.id);
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.name}
                      {u.id === user.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <StatusBadge on={u.role === "admin"} onLabel="Admin" offLabel="Member" />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.role === "admin" ? "All" : access.size}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <FormDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Edit
                          </Button>
                        }
                        title={`Edit ${u.name}`}
                        description="Changing the password signs them out on other devices."
                        action={updateUserAction}
                        submitLabel="Save changes"
                        wide
                      >
                        {userFields(u)}
                      </FormDialog>
                      {u.id !== user.id && (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              Remove
                            </Button>
                          }
                          title={`Remove ${u.name}?`}
                          description="They lose access straight away. Mailboxes and mail are kept."
                          confirmLabel="Remove user"
                          action={deleteUserAction}
                          args={[u.id]}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      </div>
    </Shell>
  );
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
  const domain = await env.DB.prepare("SELECT id FROM domains WHERE name = ?").bind(domainOf(mailbox.address)).first<{ id: string }>();

  return (
    <Shell user={ctx.user!} folder="admin" flash={flashFrom(request)}>
      <PageHeader title={mailbox.display_name} back={{ href: "/admin", label: "Admin" }} sub={mailbox.address}>
        {domain && (
          <Button variant="outline" asChild>
            <a href={`/admin/domains/${domain.id}`}>{domainOf(mailbox.address)}</a>
          </Button>
        )}
        <Button variant="outline" asChild>
          <a href={`/mb/${mailbox.id}/inbox`}>Open inbox</a>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Details">
          <ActionForm action={updateMailbox} submitLabel="Save details">
            <input type="hidden" name="id" value={mailbox.id} />
            <Field label="Sender name">
              <Input name="display_name" defaultValue={mailbox.display_name} required />
            </Field>
            <Field label="Signature" hint="Plain text, added under messages sent from this mailbox.">
              <Textarea name="signature" rows={5} defaultValue={mailbox.signature} />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <Switch name="active" defaultChecked={!!mailbox.active} />
              <span>
                <span className="font-medium">Active</span>
                <span className="block text-muted-foreground">When off, mail to it is rejected and it can't send.</span>
              </span>
            </label>
          </ActionForm>
        </Section>

        <Section title="Who can use this mailbox" description="Admins always have access.">
          <ActionForm action={setMailboxMembers} submitLabel="Save access">
            <input type="hidden" name="id" value={mailbox.id} />
            <CheckList
              name="members"
              items={users.map((u) => ({
                value: u.id,
                label: u.name,
                sub: u.role === "admin" ? `${u.email}, admin` : u.email,
                locked: u.role === "admin",
              }))}
              checked={new Set(users.filter((u) => u.member).map((u) => u.id))}
              empty="No users yet."
            />
          </ActionForm>
        </Section>

        <Section
          title="Delete mailbox"
          tone="danger"
          description="Permanently deletes the mailbox with all its messages and attachments. This can't be undone."
          className="xl:col-span-2"
        >
          <ConfirmAction
            trigger={<Button variant="destructive">Delete {mailbox.address}</Button>}
            title={`Delete ${mailbox.address} forever?`}
            description="Every message and attachment in it is deleted. Mail sent to the address afterwards is rejected."
            confirmLabel="Delete forever"
            action={deleteMailbox}
            args={[mailbox.id]}
            confirmText={mailbox.address}
          />
        </Section>
      </div>
    </Shell>
  );
}
