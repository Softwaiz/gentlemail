import {
  Archive,
  Webhook,
  Inbox,
  Menu,
  OctagonAlert,
  PenLine,
  Send,
  Shield,
  Signature,
  Trash2,
} from "lucide-react";
import type { User } from "@/lib/auth";
import { FOLDERS, domainOf, listMailboxesForUser } from "@/lib/db";
import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "./brand";
import { UserMenu } from "./user-menu";

export { appName } from "./brand";

type Props = {
  user: User;
  mailboxId?: string;
  folder?: string;
  flash?: { msg?: string | null; err?: string | null };
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
}: {
  href: string;
  active?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  count?: number;
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
      {active && (
        <span
          className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-lime"
          aria-hidden="true"
        />
      )}
      {Icon && (
        <Icon
          className={cn(
            "size-4 shrink-0 text-sidebar-muted",
            active && "text-lime",
          )}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {!!count && (
        <span className="rounded-sm bg-lime px-1.5 text-[11px] font-bold leading-[18px] text-lime-ink tabular-nums">
          {count}
        </span>
      )}
    </a>
  );
}

export async function Shell({
  user,
  mailboxId,
  folder,
  flash,
  children,
}: Props) {
  const mailboxes = await listMailboxesForUser(user);
  const current = mailboxes.find((m) => m.id === mailboxId) ?? null;

  // One instance serves several domains, so group the mailbox list by domain.
  const byDomain = new Map<string, typeof mailboxes>();
  for (const m of mailboxes) {
    const d = domainOf(m.address);
    byDomain.set(d, [...(byDomain.get(d) ?? []), m]);
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="scrollbar-thin flex flex-col gap-1 overflow-y-auto bg-sidebar p-3 text-sidebar-foreground md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-2 px-2 pt-1 md:pb-4">
          <a
            href="/"
            className="flex flex-1 items-center gap-2.5 text-[17px] text-sidebar-foreground"
          >
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
          {current && (
            <>
              <div className="mb-3 rounded-md border border-sidebar-border px-3 py-2.5">
                <div className="truncate text-[13.5px] font-semibold">
                  {current.display_name}
                </div>
                <div className="truncate text-xs text-sidebar-muted">
                  {current.address}
                </div>
              </div>
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
                    count={f.id === "inbox" ? current.unread : undefined}
                  >
                    {f.label}
                  </NavItem>
                ))}
                <NavItem
                  href={`/mb/${current.id}/settings`}
                  active={folder === "settings"}
                  icon={Signature}
                >
                  Signature
                </NavItem>
              </nav>
            </>
          )}

          <div className="mt-4 flex flex-col gap-3 border-t border-sidebar-border pt-4">
            {mailboxes.length === 0 && (
              <p className="px-3 text-xs text-sidebar-muted">
                No mailboxes yet.
              </p>
            )}
            {[...byDomain].map(([domain, list]) => (
              <div key={domain}>
                <div className="px-3 pb-1 text-xs font-medium text-sidebar-muted">
                  {domain}
                </div>
                <nav className="flex flex-col gap-0.5">
                  {list.map((m) => (
                    <a
                      key={m.id}
                      href={`/mb/${m.id}/inbox`}
                      title={m.address}
                      className={cn(
                        "flex h-8 items-center gap-2 rounded-md px-3 text-[13px] text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        m.id === mailboxId && "text-sidebar-foreground",
                        !m.active && "opacity-45",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          m.id === mailboxId ? "bg-lime" : "bg-sidebar-border",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {m.address.slice(0, m.address.lastIndexOf("@"))}
                      </span>
                      {m.unread > 0 && (
                        <span className="text-[11px] text-sidebar-muted tabular-nums">
                          {m.unread}
                        </span>
                      )}
                    </a>
                  ))}
                </nav>
              </div>
            ))}
          </div>

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
            <UserMenu
              name={user.name}
              email={user.email}
              isAdmin={user.role === "admin"}
            />
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-4 pt-6 pb-20 md:px-10 md:pt-8">
        <div className="mx-auto max-w-[1120px]">
          {flash?.msg && (
            <div
              role="status"
              className="mb-5 flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium"
            >
              <span
                className="size-2 rounded-full bg-unread"
                aria-hidden="true"
              />
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
          {children}
        </div>
      </main>
    </div>
  );
}

/** Page title in the Softwaiz display face, with optional actions on the right. */
export function PageHeader({
  title,
  back,
  sub,
  children,
}: {
  title: React.ReactNode;
  back?: { href: string; label: string };
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <a
            href={back.href}
            className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden="true">‹</span> {back.label}
          </a>
        )}
        <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.01em]">
          {title}
        </h1>
        {sub && (
          <div className="mt-1.5 text-sm text-muted-foreground">{sub}</div>
        )}
      </div>
      {children}
    </header>
  );
}

export const flashFrom = (request: Request) => {
  const u = new URL(request.url);
  return { msg: u.searchParams.get("msg"), err: u.searchParams.get("err") };
};
