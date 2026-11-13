import { Archive, Inbox, Menu, OctagonAlert, PenLine, Send, Settings, Shield, Trash2, Webhook } from "lucide-react";
import type { User } from "@/lib/auth";
import { FOLDERS, type Folder, switcherGroups, unreadByFolder } from "@/lib/db";
import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "./brand";
import { MailboxSwitcher } from "./mailbox-switcher";
import { Toaster } from "./ui/sonner";
import { UserMenu } from "./user-menu";

export { appName } from "./brand";

type Props = {
  user: User;
  mailboxId?: string;
  folder?: string;
  flash?: { msg?: string | null; err?: string | null };
  /** Let the page use the whole content area, edge to edge (mail lists). */
  bleed?: boolean;
  children: React.ReactNode;
};

const folderIcon = {
  inbox: Inbox,
  sent: Send,
  archive: Archive,
  spam: OctagonAlert,
  trash: Trash2,
} as const;

function NavItem({
  href,
  active,
  icon: Icon,
  children,
  count,
  strong,
}: {
  href: string;
  active?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  count?: number;
  /** Inbox count stands out; other folders get a quiet number. */
  strong?: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-3 text-[13.5px] text-sidebar-foreground/80 transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-violet",
        active && "bg-sidebar-accent font-semibold text-sidebar-foreground",
      )}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-lime" aria-hidden="true" />}
      {Icon && <Icon className={cn("size-4 shrink-0 text-sidebar-muted", active && "text-lime")} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {!!count && (
        <span
          className={cn(
            "rounded-sm px-1.5 text-[11px] leading-[18px] font-bold tabular-nums",
            strong ? "bg-lime text-lime-ink" : "bg-sidebar-accent text-sidebar-foreground/80 group-hover:bg-sidebar",
          )}
          aria-label={`${count} unread`}
        >
          {count}
        </span>
      )}
    </a>
  );
}

export async function Shell({ user, mailboxId, folder, flash, bleed, children }: Props) {
  const groups = await switcherGroups(user);
  const all = groups.flatMap((g) => g.mailboxes);
  const current = all.find((m) => m.id === mailboxId) ?? null;
  const unread = current ? await unreadByFolder(current.id) : {};
  // Sent mail is never "unread" for you, so it gets no badge.
  const badge = (f: Folder) => (f === "sent" ? undefined : unread[f]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="scrollbar-thin flex flex-col gap-1 overflow-y-auto bg-sidebar p-3 text-sidebar-foreground md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-2 px-2 pt-1 md:pb-3">
          <a href="/" className="flex flex-1 items-center gap-2.5 text-[17px] text-sidebar-foreground">
            <LogoMark />
            <Wordmark />
          </a>
          {current && (
            <a
              href={`/mb/${current.id}/compose`}
              aria-label="New message"
              className="grid size-9 place-items-center rounded-md bg-lime text-lime-ink md:hidden"
            >
              <PenLine className="size-4" />
            </a>
          )}
          <label
            htmlFor="nav-toggle"
            className="grid size-9 cursor-pointer place-items-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent md:hidden"
          >
            <Menu className="size-5" />
            <span className="sr-only">Menu</span>
          </label>
        </div>
        {/* Phones: the rest of the sidebar folds behind the menu button (no JS needed). */}
        <input type="checkbox" id="nav-toggle" className="peer sr-only" />
        <div className="hidden flex-1 flex-col gap-1 pt-3 peer-checked:flex md:flex md:pt-0">
          {all.length > 0 && (
            <div className="mb-3">
              <MailboxSwitcher
                current={current && { id: current.id, address: current.address, name: current.name }}
                groups={groups}
                folder={folder}
              />
            </div>
          )}
          {current && (
            <>
              <a
                href={`/mb/${current.id}/compose`}
                className="mb-3 flex h-10 items-center justify-center gap-2 rounded-md bg-lime font-semibold text-lime-ink transition hover:bg-[#f0ff5b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
              >
                <PenLine className="size-4" /> New message
              </a>
              <nav aria-label="Folders" className="flex flex-col gap-0.5">
                {FOLDERS.map((f) => (
                  <NavItem
                    key={f.id}
                    href={`/mb/${current.id}/${f.id}`}
                    active={folder === f.id}
                    icon={folderIcon[f.id]}
                    count={badge(f.id)}
                    strong={f.id === "inbox"}
                  >
                    {f.label}
                  </NavItem>
                ))}
                <NavItem href={`/mb/${current.id}/settings`} active={folder === "settings"} icon={Settings}>
                  Mailbox settings
                </NavItem>
              </nav>
            </>
          )}
          {all.length === 0 && <p className="px-3 text-xs text-sidebar-muted">No mailboxes yet.</p>}

          <div className="mt-auto flex flex-col gap-1 border-t border-sidebar-border pt-3">
            {user.role === "admin" && (
              <>
                <NavItem href="/admin" active={folder === "admin"} icon={Shield}>
                  Admin
                </NavItem>
                <NavItem href="/admin/api" active={folder === "api"} icon={Webhook}>
                  API &amp; webhooks
                </NavItem>
              </>
            )}
            <UserMenu name={user.name} email={user.email} isAdmin={user.role === "admin"} />
          </div>
        </div>
      </aside>

      <main className={cn("flex min-w-0 flex-col", !bleed && "px-4 pt-6 pb-20 md:px-8 md:pt-7")}>
        {(flash?.msg || flash?.err) && (
          <div className={cn(bleed && "px-4 pt-4 md:px-6")}>
            {flash?.msg && (
              <div role="status" className="mb-5 flex items-center gap-2 rounded-md border bg-card px-4 py-2.5 text-sm font-medium">
                <span className="size-2 rounded-full bg-unread" aria-hidden="true" />
                {flash.msg}
              </div>
            )}
            {flash?.err && (
              <div
                role="alert"
                className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive"
              >
                {flash.err}
              </div>
            )}
          </div>
        )}
        {children}
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}

/** Page title with an optional line under it and actions on the right. */
export function PageHeader({
  title,
  back,
  sub,
  children,
  className,
}: {
  title: React.ReactNode;
  back?: { href: string; label: string };
  sub?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {back && (
          <a
            href={back.href}
            className="mb-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden="true">‹</span> {back.label}
          </a>
        )}
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
        {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export const flashFrom = (request: Request) => {
  const u = new URL(request.url);
  return { msg: u.searchParams.get("msg"), err: u.searchParams.get("err") };
};
