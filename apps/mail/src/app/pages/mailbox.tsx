import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import {
  Archive,
  ChevronLeft,
  Download,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  OctagonAlert,
  Paperclip,
  Reply,
  ReplyAll,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { PageHeader, Shell, flashFrom } from "@/app/components/shell";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/utils";
import { MailFrame } from "@/app/components/mail-frame";
import { field, notFound, redirect, withFlash } from "@/app/http";
import {
  type AttachmentRow,
  FOLDERS,
  type MessageRow,
  deleteMessageForever,
  getMailboxForUser,
  isFolder,
  listAttachments,
  parseAddrs,
} from "@/lib/db";
import { formatAddr, formatBytes, formatDate, htmlHasOwnColors } from "@/lib/util";

const PAGE_SIZE = 50;

type ListRow = MessageRow & { thread_count: number; thread_unread: number };

/* ---------- Folder / search list ---------- */

export async function FolderPage({ params, ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const mailbox = await getMailboxForUser(user, params.mailboxId);
  if (!mailbox) return notFound();
  const folder = params.folder;
  if (!isFolder(folder)) return notFound();

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let rows: ListRow[];
  if (q) {
    const like = `%${q}%`;
    rows = (
      await env.DB.prepare(
        `SELECT m.*, 1 AS thread_count, (1 - m.is_read) AS thread_unread FROM messages m
         WHERE m.mailbox_id = ? AND m.folder != 'trash'
           AND (m.subject LIKE ? OR m.from_addr LIKE ? OR m.from_name LIKE ? OR m.to_json LIKE ? OR m.text_body LIKE ?)
         ORDER BY m.date DESC LIMIT ? OFFSET ?`,
      )
        .bind(mailbox.id, like, like, like, like, like, PAGE_SIZE + 1, offset)
        .all<ListRow>()
    ).results;
  } else {
    // One row per conversation: the latest message of each thread in this folder.
    rows = (
      await env.DB.prepare(
        `SELECT m.*, s.thread_count, s.thread_unread FROM messages m
         JOIN (
           SELECT thread_id, MAX(date) AS last, COUNT(*) AS thread_count, SUM(1 - is_read) AS thread_unread
           FROM messages WHERE mailbox_id = ?1 AND folder = ?2 GROUP BY thread_id
         ) s ON s.thread_id = m.thread_id AND s.last = m.date
         WHERE m.mailbox_id = ?1 AND m.folder = ?2
         GROUP BY m.thread_id
         ORDER BY m.date DESC LIMIT ?3 OFFSET ?4`,
      )
        .bind(mailbox.id, folder, PAGE_SIZE + 1, offset)
        .all<ListRow>()
    ).results;
  }
  const hasMore = rows.length > PAGE_SIZE;
  rows = rows.slice(0, PAGE_SIZE);
  const label = FOLDERS.find((f) => f.id === folder)!.label;
  const back = url.pathname + url.search;
  const unreadHere = rows.filter((r) => r.thread_unread > 0).length;

  return (
    <Shell user={user} mailboxId={mailbox.id} folder={q ? undefined : folder} flash={flashFrom(request)}>
      <PageHeader
        title={q ? "Search" : label}
        sub={
          q
            ? `Results for “${q}” in ${mailbox.address}`
            : rows.length === 0
              ? mailbox.address
              : `${rows.length}${hasMore ? "+" : ""} conversations${unreadHere ? `, ${unreadHere} unread` : ""}`
        }
      >
        <form method="get" action={`/mb/${mailbox.id}/inbox`} role="search" className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" type="search" placeholder="Search this mailbox" defaultValue={q} aria-label="Search mail" className="h-10 bg-card pl-9" />
        </form>
      </PageHeader>

      <form method="post" action={`/mb/${mailbox.id}/actions`}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="folder" value={folder} />
        <input type="hidden" name="scope" value={q ? "message" : "thread"} />

        {rows.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-input bg-card px-6 py-20 text-center">
            <div className="font-display text-2xl">{q ? "Nothing found" : `${label} is empty`}</div>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {q
                ? "Try a name, an address or a word from the subject."
                : folder === "inbox"
                  ? `New mail to ${mailbox.address} shows up here.`
                  : "Conversations you move here will show up in this list."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-3 py-1.5">
              <span className="mr-2 pl-1 text-xs text-muted-foreground">Selected</span>
              {folder !== "inbox" && <ActionBtn value="inbox" icon={Inbox}>Move to inbox</ActionBtn>}
              {folder !== "archive" && folder !== "sent" && <ActionBtn value="archive" icon={Archive}>Archive</ActionBtn>}
              <ActionBtn value="read" icon={MailOpen}>Mark read</ActionBtn>
              <ActionBtn value="unread" icon={Mail}>Mark unread</ActionBtn>
              {folder !== "spam" && folder !== "sent" && <ActionBtn value="spam" icon={OctagonAlert}>Spam</ActionBtn>}
              {folder === "trash" ? (
                <ActionBtn value="delete" icon={Trash2} danger>Delete forever</ActionBtn>
              ) : (
                <ActionBtn value="trash" icon={Trash2} danger>Trash</ActionBtn>
              )}
            </div>
            <ul className="divide-y">
              {rows.map((m) => {
                const unread = m.thread_unread > 0;
                const who =
                  m.direction === "out"
                    ? "To " + (parseAddrs(m.to_json).map((a) => a.name || a.address).join(", ") || "nobody")
                    : m.from_name || m.from_addr;
                return (
                  <li key={m.id} className={cn("group relative flex items-center gap-3 pl-4 transition-colors hover:bg-accent/60", unread && "bg-card")}>
                    {unread && <span className="absolute inset-y-0 left-0 w-[3px] bg-unread" aria-hidden="true" />}
                    <input
                      type="checkbox"
                      name="ids"
                      value={q ? m.id : m.thread_id}
                      aria-label={`Select ${m.subject}`}
                      className="size-4 shrink-0 accent-[var(--violet)]"
                    />
                    <a
                      href={`/mb/${mailbox.id}/thread/${m.thread_id}?f=${q ? m.folder : folder}`}
                      className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 pr-4 md:grid-cols-[200px_minmax(0,1fr)_auto]"
                    >
                      <span className={cn("flex min-w-0 items-center gap-2 truncate", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>
                        <span className="truncate">{who}</span>
                        {m.thread_count > 1 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{m.thread_count}</span>}
                      </span>
                      <span className="col-span-2 row-start-2 min-w-0 truncate md:col-span-1 md:row-start-auto">
                        <span className={unread ? "font-semibold" : "font-medium"}>{m.subject || "(no subject)"}</span>
                        <span className="ml-2 text-muted-foreground">{m.snippet}</span>
                      </span>
                      <span className="flex items-center gap-2 justify-self-end text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {q && <Badge variant="secondary">{m.folder}</Badge>}
                        {m.is_starred ? <Star className="size-3.5 fill-current text-violet" aria-label="Starred" /> : null}
                        {m.has_attachments ? <Paperclip className="size-3.5" aria-label="Has attachments" /> : null}
                        <time className={cn(unread && "font-semibold text-foreground")}>{formatDate(m.date)}</time>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </form>

      {(page > 1 || hasMore) && (
        <div className="flex justify-end gap-2 pt-4">
          {page > 1 && (
            <Button variant="outline" size="sm" asChild>
              <a href={pageUrl(url, page - 1)}>Newer</a>
            </Button>
          )}
          {hasMore && (
            <Button variant="outline" size="sm" asChild>
              <a href={pageUrl(url, page + 1)}>Older</a>
            </Button>
          )}
        </div>
      )}
    </Shell>
  );
}

const pageUrl = (url: URL, p: number) => {
  const u = new URL(url);
  u.searchParams.set("page", String(p));
  return u.pathname + u.search;
};

function ActionBtn({
  value,
  children,
  danger,
  icon: I,
}: {
  value: string;
  children: React.ReactNode;
  danger?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Button
      type="submit"
      name="action"
      value={value}
      variant="ghost"
      size="sm"
      className={cn("h-8 text-[13px] text-muted-foreground", danger && "text-destructive hover:text-destructive")}
    >
      <I className="size-3.5" />
      {children}
    </Button>
  );
}

/* ---------- Bulk / single actions ---------- */

export async function actionsHandler({ params, ctx, request }: RequestInfo) {
  const mailbox = await getMailboxForUser(ctx.user!, params.mailboxId);
  if (!mailbox) return notFound();
  const form = await request.formData();
  const action = field(form, "action");
  const scope = field(form, "scope") === "message" ? "message" : "thread";
  const folder = field(form, "folder");
  const ids = form.getAll("ids").map(String).filter(Boolean);
  let back = field(form, "back") || `/mb/${mailbox.id}/inbox`;
  if (!back.startsWith("/")) back = `/mb/${mailbox.id}/inbox`;
  if (!ids.length) return redirect(withFlash(back, "err", "Select at least one conversation."));

  // Resolve affected message rows.
  const ph = ids.map(() => "?").join(",");
  const col = scope === "thread" ? "thread_id" : "id";
  const folderFilter = scope === "thread" && isFolder(folder) ? "AND folder = ?" : "";
  const { results: msgs } = await env.DB.prepare(
    `SELECT * FROM messages WHERE mailbox_id = ? AND ${col} IN (${ph}) ${folderFilter}`,
  )
    .bind(mailbox.id, ...ids, ...(folderFilter ? [folder] : []))
    .all<MessageRow>();
  if (!msgs.length) return redirect(back);
  const msgIds = msgs.map((m) => m.id);
  const mph = msgIds.map(() => "?").join(",");

  const update = (set: string, ...vals: unknown[]) =>
    env.DB.prepare(`UPDATE messages SET ${set} WHERE id IN (${mph})`).bind(...vals, ...msgIds).run();

  switch (action) {
    case "read":
      await update("is_read = 1");
      break;
    case "unread":
      await update("is_read = 0");
      break;
    case "star":
      await update("is_starred = 1");
      break;
    case "unstar":
      await update("is_starred = 0");
      break;
    case "inbox":
      // Outgoing mail goes back to "sent" rather than the inbox.
      await env.DB.prepare(
        `UPDATE messages SET folder = CASE direction WHEN 'out' THEN 'sent' ELSE 'inbox' END WHERE id IN (${mph})`,
      )
        .bind(...msgIds)
        .run();
      break;
    case "archive":
    case "trash":
    case "spam":
      await update("folder = ?", action);
      break;
    case "delete":
      for (const m of msgs) if (m.folder === "trash") await deleteMessageForever(m);
      break;
    default:
      return redirect(withFlash(back, "err", "Unknown action."));
  }

  // Leaving a thread view after moving it away → return to its folder.
  const target = field(form, "after") || back;
  const done: Record<string, string> = {
    archive: "Archived.",
    trash: "Moved to trash.",
    spam: "Marked as spam.",
    inbox: "Moved to inbox.",
    delete: "Deleted forever.",
  };
  return redirect(done[action] ? withFlash(target, "msg", done[action]) : target);
}

/* ---------- Conversation view ---------- */

export async function ThreadPage({ params, ctx, request }: RequestInfo) {
  const user = ctx.user!;
  const mailbox = await getMailboxForUser(user, params.mailboxId);
  if (!mailbox) return notFound();
  const url = new URL(request.url);
  const folder = isFolder(url.searchParams.get("f") ?? "") ? url.searchParams.get("f")! : "inbox";

  const { results: msgs } = await env.DB.prepare(
    `SELECT * FROM messages WHERE mailbox_id = ? AND thread_id = ? ${folder === "trash" ? "" : "AND folder != 'trash'"} ORDER BY date ASC`,
  )
    .bind(mailbox.id, params.threadId)
    .all<MessageRow>();
  if (!msgs.length) return redirect(`/mb/${mailbox.id}/${folder}`);

  const unreadIds = msgs.filter((m) => !m.is_read).map((m) => m.id);
  if (unreadIds.length) {
    await env.DB.prepare(`UPDATE messages SET is_read = 1 WHERE id IN (${unreadIds.map(() => "?").join(",")})`)
      .bind(...unreadIds)
      .run();
  }
  const atts = await listAttachments(msgs.map((m) => m.id));
  const byMsg = new Map<string, AttachmentRow[]>();
  for (const a of atts) byMsg.set(a.message_id, [...(byMsg.get(a.message_id) ?? []), a]);

  const last = msgs[msgs.length - 1];
  const lastIncoming = [...msgs].reverse().find((m) => m.direction === "in") ?? last;
  const back = `/mb/${mailbox.id}/${folder}`;
  const here = url.pathname + url.search;
  const people = new Set(msgs.map((m) => m.from_addr.toLowerCase())).size;

  return (
    <Shell user={user} mailboxId={mailbox.id} folder={folder} flash={flashFrom(request)}>
      <div className="max-w-[880px]">
        <a href={back} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> {FOLDERS.find((f) => f.id === folder)?.label}
        </a>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em] text-balance md:text-[32px]">
          {last.subject || "(no subject)"}
        </h1>
        <div className="mt-2 text-sm text-muted-foreground">
          {msgs.length} {msgs.length === 1 ? "message" : "messages"}, {people} {people === 1 ? "person" : "people"}
        </div>

        <form method="post" action={`/mb/${mailbox.id}/actions`} className="my-5 flex flex-wrap items-center gap-1 border-y py-1.5">
          <input type="hidden" name="ids" value={params.threadId} />
          <input type="hidden" name="scope" value="thread" />
          <input type="hidden" name="back" value={here} />
          <input type="hidden" name="after" value={back} />
          {folder !== "inbox" && <ActionBtn value="inbox" icon={Inbox}>Move to inbox</ActionBtn>}
          {folder !== "archive" && folder !== "sent" && <ActionBtn value="archive" icon={Archive}>Archive</ActionBtn>}
          <ActionBtn value="unread" icon={Mail}>Mark unread</ActionBtn>
          {folder !== "spam" && folder !== "sent" && <ActionBtn value="spam" icon={OctagonAlert}>Spam</ActionBtn>}
          {folder === "trash" ? (
            <ActionBtn value="delete" icon={Trash2} danger>Delete forever</ActionBtn>
          ) : (
            <ActionBtn value="trash" icon={Trash2} danger>Trash</ActionBtn>
          )}
        </form>

        <div className="flex flex-col gap-3">
          {msgs.map((m) => (
            <MessageCard
              key={m.id}
              m={m}
              mailboxId={mailbox.id}
              attachments={byMsg.get(m.id) ?? []}
              open={m.id === last.id || msgs.length <= 3}
              isLast={m.id === last.id}
              here={here}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <a href={`/mb/${mailbox.id}/compose?reply=${lastIncoming.id}`}>
              <Reply /> Reply
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/mb/${mailbox.id}/compose?reply=${lastIncoming.id}&all=1`}>
              <ReplyAll /> Reply all
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/mb/${mailbox.id}/compose?forward=${last.id}`}>
              <Forward /> Forward
            </a>
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function MessageCard({
  m,
  mailboxId,
  attachments,
  open,
  isLast,
  here,
}: {
  m: MessageRow;
  mailboxId: string;
  attachments: AttachmentRow[];
  open: boolean;
  isLast: boolean;
  here: string;
}) {
  const to = parseAddrs(m.to_json);
  const cc = parseAddrs(m.cc_json);
  const bcc = parseAddrs(m.bcc_json);
  const hasHtml = !!(m.html_body || m.html_key);
  const files = attachments.filter((a) => a.disposition !== "inline" || !a.content_id);
  const name = m.from_name || m.from_addr;

  return (
    <details open={open} className="group/msg rounded-lg border bg-card [&:not([open])]:bg-card/60">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3.5 hover:bg-accent/40 group-open/msg:hover:bg-transparent [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold",
            m.direction === "out" ? "bg-lime text-lime-ink" : "bg-secondary text-secondary-foreground",
          )}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-semibold">{name}</span>
            {m.from_name && <span className="ml-1.5 text-xs text-muted-foreground">{m.from_addr}</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            <span className="hidden group-open/msg:inline">
              to {to.map(formatAddr).join(", ") || "nobody"}
              {cc.length > 0 && <>, cc {cc.map(formatAddr).join(", ")}</>}
              {bcc.length > 0 && <>, bcc {bcc.map(formatAddr).join(", ")}</>}
            </span>
            <span className="group-open/msg:hidden">{m.snippet}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {m.is_starred ? <Star className="size-3.5 fill-current text-violet" /> : null}
          {files.length > 0 && <Paperclip className="size-3.5" />}
          {formatDate(m.date, true)}
        </span>
      </summary>

      <div className="px-4 pb-4 md:pl-16">
        {hasHtml ? (
          <>
            <MailFrame src={`/body/${m.id}`} title={m.subject} adaptive={!!m.html_body && !htmlHasOwnColors(m.html_body)} />
            <p className="mt-2 text-xs text-muted-foreground">
              Remote images are blocked to protect your privacy.{" "}
              <a href={`/body/${m.id}?images=1`} target="_blank" rel="noopener" className="font-medium text-foreground underline underline-offset-2">
                Open with images
              </a>
            </p>
          </>
        ) : (
          <pre className="max-w-[75ch] font-sans text-[14.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text_body ?? ""}</pre>
        )}

        {files.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((a) => {
              const viewable = /^(image\/|application\/pdf|text\/plain)/.test(a.content_type);
              return (
                <div key={a.id} className="flex items-center gap-3 rounded-md border p-2">
                  {a.content_type.startsWith("image/") ? (
                    <a href={`/attachments/${a.id}?inline=1`} target="_blank" rel="noopener" className="shrink-0">
                      <img src={`/attachments/${a.id}?inline=1`} alt={a.filename} loading="lazy" className="size-11 rounded-sm object-cover" />
                    </a>
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-sm bg-secondary text-[10px] font-bold text-muted-foreground uppercase">
                      {(a.filename.split(".").pop() ?? "file").slice(0, 4)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="truncate font-medium" title={a.filename}>
                      {a.filename}
                    </div>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>{formatBytes(a.size)}</span>
                      {viewable && (
                        <a href={`/attachments/${a.id}?inline=1`} target="_blank" rel="noopener" className="font-medium text-foreground hover:underline">
                          View
                        </a>
                      )}
                      <a href={`/attachments/${a.id}`} className="font-medium text-foreground hover:underline">
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 -ml-2 flex flex-wrap gap-1">
          {/* The last message is answered from the buttons under the thread. */}
          {!isLast && (
            <>
              <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
                <a href={`/mb/${mailboxId}/compose?reply=${m.id}`}>
                  <Reply /> Reply
                </a>
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
                <a href={`/mb/${mailboxId}/compose?reply=${m.id}&all=1`}>
                  <ReplyAll /> Reply all
                </a>
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
                <a href={`/mb/${mailboxId}/compose?forward=${m.id}`}>
                  <Forward /> Forward
                </a>
              </Button>
            </>
          )}
          <form method="post" action={`/mb/${mailboxId}/actions`} className="inline">
            <input type="hidden" name="ids" value={m.id} />
            <input type="hidden" name="scope" value="message" />
            <input type="hidden" name="back" value={here} />
            <Button variant="ghost" size="sm" className="text-muted-foreground" name="action" value={m.is_starred ? "unstar" : "star"}>
              <Star className={cn(m.is_starred && "fill-current text-violet")} /> {m.is_starred ? "Starred" : "Star"}
            </Button>
          </form>
          {m.raw_key && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <a href={`/raw/${m.id}`}>
                <Download /> Original .eml
              </a>
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
