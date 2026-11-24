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
import { ActionForm, ActionSwitch, ConfirmAction, FormDialog } from "@/app/components/action-form";
import { resetUserMfaAction, setRequireMfaAction } from "@/app/actions/security";
import { isMfaRequired } from "@/lib/mfa";
import { isUpdateCheckOn } from "@/lib/updates";
import { UpdateCheck } from "@/app/components/update-check";
import { FormSelect } from "@/app/components/form-select";
import { cn } from "@/lib/utils";
import { Field, Section, StatusBadge, cardRow, cardTable, cardTableHeader } from "@/app/components/section";
import { SignatureFields } from "@/app/components/signature-fields";
import { logoUrl, signatureLook } from "@/lib/signature";
import { PageHeader, Shell } from "@/app/components/shell";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { PasswordInput } from "@/app/components/password-input";
import { Switch } from "@/app/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/app/components/ui/table";
import { missing } from "@/app/pages/errors";
import { DomainsGrid, listDomainsWithCounts } from "@/app/pages/domains";
import { type Mailbox, domainOf } from "@/lib/db";
import { plural, t } from "@lingui/core/macro";

type UserRow = { id: string; email: string; name: string; role: string; created_at: number; mfa_enabled_at: number | null };

/** Called while rendering, so the names are in the reader's language. */
const roles = () => [
  { value: "member", label: t({ id: "admin.member", message: "Member" }), hint: "" },
  { value: "admin", label: t({ id: "admin.admin", message: "Admin" }), hint: "" },
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

export async function AdminPage({ ctx }: RequestInfo) {
  const user = ctx.user!;
  const [{ results: mailboxes }, { results: users }, { results: members }, domains, mfaRequired, updateCheck] = await Promise.all([
    env.DB.prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM messages x WHERE x.mailbox_id = m.id) AS total,
        (SELECT GROUP_CONCAT(u.name, ', ') FROM mailbox_members mm JOIN users u ON u.id = mm.user_id WHERE mm.mailbox_id = m.id) AS member_names
       FROM mailboxes m ORDER BY m.address`,
    ).all<Mailbox & { total: number; member_names: string | null }>(),
    env.DB.prepare("SELECT id, email, name, role, created_at, mfa_enabled_at FROM users ORDER BY created_at").all<UserRow>(),
    env.DB.prepare("SELECT mailbox_id, user_id FROM mailbox_members").all<{ mailbox_id: string; user_id: string }>(),
    listDomainsWithCounts(),
    isMfaRequired(),
    isUpdateCheckOn(),
  ]);
  const usable = domains.filter((d) => d.active);
  const memberUsers = users.filter((u) => u.role !== "admin");
  const mailboxItems = mailboxes.map((m) => ({ value: m.id, label: m.address, sub: m.display_name }));
  const accessOf = (uid: string) => new Set(members.filter((x) => x.user_id === uid).map((x) => x.mailbox_id));

  const userFields = (u?: UserRow) => (
    <>
      {u && <input type="hidden" name="id" value={u.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t({ id: "admin.name", message: "Name" })}>
          <Input name="name" defaultValue={u?.name} required autoFocus />
        </Field>
        <Field label={t({ id: "admin.login_email", message: "Login email" })}>
          <Input name="email" type="email" defaultValue={u?.email} required />
        </Field>
        <Field
          label={u ? t({ id: "admin.new_password", message: "New password" }) : t({ id: "admin.password", message: "Password" })}
          hint={u ? t({ id: "admin.password_keep", message: "Leave empty to keep the current one." }) : t({ id: "admin.password_min", message: "At least 10 characters." })}
        >
          <PasswordInput name="password" minLength={10} required={!u} autoComplete="new-password" />
        </Field>
        <Field label={t({ id: "admin.role", message: "Role" })} hint={u?.id === user.id ? t({ id: "admin.role_own", message: "You can't change your own role." }) : t({ id: "admin.role_hint", message: "Admins manage everything." })}>
          <FormSelect name="role" options={roles()} defaultValue={u?.role ?? "member"} disabled={u?.id === user.id} aria-label={t({ id: "admin.role", message: "Role" })} />
        </Field>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{t({ id: "admin.mailboxes_they_can_open", message: "Mailboxes they can open" })}</span>
        <span className="-mt-1 text-xs text-muted-foreground">{t({ id: "admin.only_applies_members_admins", message: "Only applies to members. Admins open every mailbox." })}</span>
        <CheckList name="mailboxes" items={mailboxItems} checked={u ? accessOf(u.id) : new Set()} empty={t({ id: "admin.no_mailboxes_yet", message: "No mailboxes yet." })} />
      </div>
    </>
  );

  return (
    <Shell user={user} folder="admin">
      <PageHeader
        title={t({ id: "admin.admin", message: "Admin" })}
        sub={[
          t({ id: "admin.count_domains", message: plural(domains.length, { one: "# domain", other: "# domains" }) }),
          t({ id: "admin.count_mailboxes", message: plural(mailboxes.length, { one: "# mailbox", other: "# mailboxes" }) }),
          t({ id: "admin.count_users", message: plural(users.length, { one: "# user", other: "# users" }) }),
        ].join(", ")}
      />

      <div className="flex flex-col gap-6">
        <Section
          title={t({ id: "admin.domains", message: "Domains" })}
          description={t({ id: "admin.every_domain_app_receives", message: "Every domain this app receives and sends mail for. Each must be a zone in the same Cloudflare account." })}
          action={
            <FormDialog
              trigger={
                <Button>
                  <Plus /> {t({ id: "admin.new_domain", message: "New domain" })}
                </Button>
              }
              title={t({ id: "admin.add_domain", message: "Add a domain" })}
              description={t({ id: "admin.youll_get_steps_connect", message: "You'll get the steps that connect it to Cloudflare Email next." })}
              action={createDomain}
              submitLabel={t({ id: "admin.add_domain_2", message: "Add domain" })}
            >
              <Field label={t({ id: "admin.domain_name", message: "Domain name" })}>
                <Input name="name" placeholder={t({ id: "admin.acme_com", message: "acme.com" })} required autoFocus />
              </Field>
            </FormDialog>
          }
        >
          <DomainsGrid domains={domains} />
        </Section>

        <Section
          title={t({ id: "admin.mailboxes", message: "Mailboxes" })}
          description={t({ id: "admin.addresses_receive_send_mail", message: "Addresses that receive and send mail. Each one can be shared with several users." })}
          action={
            <FormDialog
              trigger={
                <Button disabled={!usable.length}>
                  <Plus /> {t({ id: "admin.new_mailbox", message: "New mailbox" })}
                </Button>
              }
              title={t({ id: "admin.new_mailbox", message: "New mailbox" })}
              description={t({ id: "admin.mail_address_shows_up", message: "Mail to this address shows up here as soon as it's created." })}
              action={createMailbox}
              submitLabel={t({ id: "admin.create_mailbox", message: "Create mailbox" })}
              wide
            >
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t({ id: "admin.address", message: "Address" })}</span>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <Input name="local" placeholder={t({ id: "admin.hello", message: "hello" })} required pattern="[A-Za-z0-9._+\-]+" aria-label={t({ id: "admin.name_before", message: "Name before the @" })} autoFocus />
                  <span className="text-muted-foreground">@</span>
                  <FormSelect
                    name="domain"
                    aria-label={t({ id: "admin.domain", message: "Domain" })}
                    options={usable.map((d) => ({ value: d.name, label: d.name }))}
                    defaultValue={usable[0]?.name}
                  />
                </div>
              </div>
              <Field label={t({ id: "admin.sender_name", message: "Sender name" })} hint={t({ id: "admin.recipients_see_next_address", message: "Recipients see it next to the address." })}>
                <Input name="display_name" placeholder={t({ id: "admin.acme_support", message: "Acme Support" })} required />
              </Field>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t({ id: "admin.who_can_use", message: "Who can use it" })}</span>
                <span className="-mt-1 text-xs text-muted-foreground">{t({ id: "admin.admins_always_can", message: "Admins always can." })}</span>
                <CheckList
                  name="members"
                  items={memberUsers.map((u) => ({ value: u.id, label: u.name, sub: u.email }))}
                  checked={new Set()}
                  empty={t({ id: "admin.no_members_yet_only", message: "No members yet. Only admins will see it." })}
                />
              </div>
            </FormDialog>
          }
        >
          {!usable.length && <p className="mb-4 text-sm text-muted-foreground">{t({ id: "admin.add_active_domain_before", message: "Add an active domain before creating mailboxes." })}</p>}
          {/* Phones: address and Manage; sender name and status; who has access and the message count. */}
          <Table className={cardTable}>
            <TableHeader className={cardTableHeader}>
              <TableRow>
                <TableHead>{t({ id: "admin.address", message: "Address" })}</TableHead>
                <TableHead>{t({ id: "admin.sender_name", message: "Sender name" })}</TableHead>
                <TableHead>{t({ id: "admin.access", message: "Access" })}</TableHead>
                <TableHead className="text-right">{t({ id: "admin.messages", message: "Messages" })}</TableHead>
                <TableHead>{t({ id: "admin.status", message: "Status" })}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mailboxes.map((m) => (
                <TableRow key={m.id} className={cn(cardRow, "max-lg:grid-cols-[1fr_auto]")}>
                  <TableCell className="max-lg:truncate">
                    <a href={`/mb/${m.id}/inbox`} className="font-medium hover:underline">
                      {m.address}
                    </a>
                  </TableCell>
                  <TableCell className="max-lg:row-start-2 max-lg:truncate max-lg:text-xs max-lg:text-muted-foreground">{m.display_name}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground max-lg:row-start-3 max-lg:max-w-none max-lg:text-xs">{m.member_names || t({ id: "admin.admins_only", message: "Admins only" })}</TableCell>
                  <TableCell className="text-right tabular-nums max-lg:row-start-3 max-lg:text-xs max-lg:text-muted-foreground">
                    <span className="lg:hidden">{t({ id: "admin.count_messages", message: plural(m.total, { one: "# message", other: "# messages" }) })}</span>
                    <span className="max-lg:hidden">{m.total}</span>
                  </TableCell>
                  <TableCell className="max-lg:col-start-2 max-lg:row-start-2 max-lg:text-right">
                    <StatusBadge on={!!m.active} />
                  </TableCell>
                  <TableCell className="text-right max-lg:col-start-2 max-lg:row-start-1 max-lg:-my-1">
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/admin/mailboxes/${m.id}`}>{t({ id: "admin.manage", message: "Manage" })}</a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {mailboxes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground max-lg:block">
                    {t({ id: "admin.no_mailboxes_yet", message: "No mailboxes yet." })}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Section>

        <Section
          title={t({ id: "admin.users", message: "Users" })}
          description={t({ id: "admin.members_only_see_mailboxes", message: "Members only see the mailboxes you give them. Admins see every mailbox." })}
          action={
            <FormDialog
              trigger={
                <Button>
                  <Plus /> {t({ id: "admin.new_user", message: "New user" })}
                </Button>
              }
              title={t({ id: "admin.new_user", message: "New user" })}
              description={t({ id: "admin.they_sign_email_password", message: "They sign in with this email and password." })}
              action={createUserAction}
              submitLabel={t({ id: "admin.add_user", message: "Add user" })}
              wide
            >
              {userFields()}
            </FormDialog>
          }
        >
          <label className="mb-4 flex items-start gap-3 rounded-md border px-4 py-3">
            <ActionSwitch action={setRequireMfaAction} id="require_mfa" checked={mfaRequired} label={t({ id: "admin.require_two_step_verification", message: "Require two-step verification for everyone" })} />
            <span className="text-sm">
              <span className="block font-medium">{t({ id: "admin.require_two_step_verification", message: "Require two-step verification for everyone" })}</span>
              <span className="block text-muted-foreground">
                {mfaRequired
                  ? t({ id: "admin.require_on", message: "On: people without it must set it up before they can open their mail." })
                  : t({ id: "admin.require_off", message: "Off: each person can still turn it on for themselves in Security." })}
              </span>
            </span>
          </label>
          {/* Phones: name; login email; role, two-step and mailboxes; then the buttons. */}
          <Table className={cardTable}>
            <TableHeader className={cardTableHeader}>
              <TableRow>
                <TableHead>{t({ id: "admin.name", message: "Name" })}</TableHead>
                <TableHead>{t({ id: "admin.login_email", message: "Login email" })}</TableHead>
                <TableHead>{t({ id: "admin.role", message: "Role" })}</TableHead>
                <TableHead>{t({ id: "admin.two_step", message: "Two-step" })}</TableHead>
                <TableHead>{t({ id: "admin.mailboxes", message: "Mailboxes" })}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const access = accessOf(u.id);
                return (
                  <TableRow key={u.id} className={cn(cardRow, "max-lg:grid-cols-[auto_auto_1fr]")}>
                    <TableCell className="font-medium max-lg:col-span-3 max-lg:whitespace-normal">
                      {u.name}
                      {u.id === user.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t({ id: "admin.you", message: "(you)" })}</span>}
                    </TableCell>
                    <TableCell className="max-lg:col-span-3 max-lg:text-xs max-lg:text-muted-foreground max-lg:[overflow-wrap:anywhere] max-lg:whitespace-normal">{u.email}</TableCell>
                    <TableCell>
                      <StatusBadge on={u.role === "admin"} onLabel={t({ id: "admin.admin", message: "Admin" })} offLabel={t({ id: "admin.member", message: "Member" })} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge on={!!u.mfa_enabled_at} onLabel={t({ id: "admin.on", message: "On" })} offLabel={t({ id: "admin.off", message: "Off" })} label={t({ id: "admin.two_step", message: "Two-step" })} />
                    </TableCell>
                    <TableCell className="text-muted-foreground max-lg:text-xs">
                      <span className="max-lg:hidden">{u.role === "admin" ? t({ id: "admin.all", message: "All" }) : access.size}</span>
                      <span className="lg:hidden">
                        {u.role === "admin"
                          ? t({ id: "admin.all_mailboxes", message: "All mailboxes" })
                          : t({ id: "admin.count_mailboxes", message: plural(access.size, { one: "# mailbox", other: "# mailboxes" }) })}
                      </span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap max-lg:col-span-3 max-lg:-mb-1 max-lg:-ml-3 max-lg:text-left">
                      <FormDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            {t({ id: "admin.edit", message: "Edit" })}
                          </Button>
                        }
                        title={t({ id: "admin.edit_user", message: `Edit ${u.name}` })}
                        description={t({ id: "admin.changing_password_signs_them", message: "Changing the password signs them out on other devices." })}
                        action={updateUserAction}
                        submitLabel={t({ id: "admin.save_changes", message: "Save changes" })}
                        wide
                      >
                        {userFields(u)}
                      </FormDialog>
                      {u.id !== user.id && !!u.mfa_enabled_at && (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="sm">
                              {t({ id: "admin.reset_two_step", message: "Reset two-step" })}
                            </Button>
                          }
                          title={t({ id: "admin.reset_title", message: `Reset two-step verification for ${u.name}?` })}
                          description={t({ id: "admin.someone_who_lost_their", message: "For someone who lost their phone and their recovery codes. Two-step is turned off and they're signed out everywhere; they sign in with their password and set it up again." })}
                          confirmLabel={t({ id: "admin.reset_two_step", message: "Reset two-step" })}
                          action={resetUserMfaAction}
                          args={[u.id]}
                        />
                      )}
                      {u.id !== user.id && (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              {t({ id: "admin.remove", message: "Remove" })}
                            </Button>
                          }
                          title={t({ id: "admin.remove_title", message: `Remove ${u.name}?` })}
                          description={t({ id: "admin.they_lose_access_straight", message: "They lose access straight away. Mailboxes and mail are kept." })}
                          confirmLabel={t({ id: "admin.remove_user", message: "Remove user" })}
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

        <UpdateCheck on={updateCheck} />
      </div>
    </Shell>
  );
}

/* ---------- Single mailbox ---------- */

export async function AdminMailboxPage(ri: RequestInfo) {
  const { params, ctx } = ri;
  const mailbox = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(params.id).first<Mailbox>();
  if (!mailbox) return missing(ri, "mailbox");
  const { results: users } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role,
       EXISTS(SELECT 1 FROM mailbox_members mm WHERE mm.user_id = u.id AND mm.mailbox_id = ?) AS member
     FROM users u ORDER BY u.name`,
  )
    .bind(mailbox.id)
    .all<UserRow & { member: number }>();
  const domain = await env.DB.prepare("SELECT id FROM domains WHERE name = ?").bind(domainOf(mailbox.address)).first<{ id: string }>();

  return (
    <Shell user={ctx.user!} folder="admin">
      <PageHeader title={mailbox.display_name} back={{ href: "/admin", label: t({ id: "admin.admin", message: "Admin" }) }} sub={mailbox.address}>
        {domain && (
          <Button variant="outline" asChild>
            <a href={`/admin/domains/${domain.id}`}>{domainOf(mailbox.address)}</a>
          </Button>
        )}
        <Button variant="outline" asChild>
          <a href={`/mb/${mailbox.id}/inbox`}>{t({ id: "admin.open_inbox", message: "Open inbox" })}</a>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t({ id: "admin.details", message: "Details" })}>
          <ActionForm action={updateMailbox} submitLabel={t({ id: "admin.save_details", message: "Save details" })}>
            <input type="hidden" name="id" value={mailbox.id} />
            <Field label={t({ id: "admin.sender_name", message: "Sender name" })}>
              <Input name="display_name" defaultValue={mailbox.display_name} required />
            </Field>
            <SignatureFields look={signatureLook(mailbox, logoUrl(mailbox))} />
            <label className="flex items-center gap-3 text-sm">
              <Switch name="active" defaultChecked={!!mailbox.active} />
              <span>
                <span className="font-medium">{t({ id: "admin.active", message: "Active" })}</span>
                <span className="block text-muted-foreground">{t({ id: "admin.when_off_mail_rejected", message: "When off, mail to it is rejected and it can't send." })}</span>
              </span>
            </label>
          </ActionForm>
        </Section>

        <Section title={t({ id: "admin.who_can_use_mailbox", message: "Who can use this mailbox" })} description={t({ id: "admin.admins_always_have_access", message: "Admins always have access." })}>
          <ActionForm action={setMailboxMembers} submitLabel={t({ id: "admin.save_access", message: "Save access" })}>
            <input type="hidden" name="id" value={mailbox.id} />
            <CheckList
              name="members"
              items={users.map((u) => ({
                value: u.id,
                label: u.name,
                sub: u.role === "admin" ? t({ id: "admin.email_admin", message: `${u.email}, admin` }) : u.email,
                locked: u.role === "admin",
              }))}
              checked={new Set(users.filter((u) => u.member).map((u) => u.id))}
              empty={t({ id: "admin.no_users_yet", message: "No users yet." })}
            />
          </ActionForm>
        </Section>

        <Section
          title={t({ id: "admin.delete_mailbox", message: "Delete mailbox" })}
          tone="danger"
          description={t({ id: "admin.permanently_deletes_mailbox_all", message: "Permanently deletes the mailbox with all its messages and attachments. This can't be undone." })}
          className="xl:col-span-2"
        >
          <ConfirmAction
            trigger={<Button variant="destructive">{t({ id: "admin.delete_address", message: `Delete ${mailbox.address}` })}</Button>}
            title={t({ id: "admin.delete_title", message: `Delete ${mailbox.address} forever?` })}
            description={t({ id: "admin.every_message_attachment_deleted", message: "Every message and attachment in it is deleted. Mail sent to the address afterwards is rejected." })}
            confirmLabel={t({ id: "admin.delete_forever", message: "Delete forever" })}
            action={deleteMailbox}
            args={[mailbox.id]}
            confirmText={mailbox.address}
          />
        </Section>
      </div>
    </Shell>
  );
}
