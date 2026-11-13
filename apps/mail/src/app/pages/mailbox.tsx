import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { ChevronLeft, Download, Forward, OctagonAlert, Paperclip, Reply, ReplyAll, Search, Star } from "lucide-react";
import { Shell, flashFrom } from "@/app/components/shell";
import { type ListItem, MessageList } from "@/app/components/message-list";
import { StarButton, ThreadToolbar } from "@/app/components/thread-actions";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/utils";
import { MailFrame } from "@/app/components/mail-frame";
import { notFound, redirect } from "@/app/http";
import { SPAM_RETENTION_DAYS } from "@/lib/spam";
import {
  type AttachmentRow,
  FOLDERS,
  type MessageRow,
  getMailboxForUser,
  isFolder,
  listAttachments,
  parseAddrs,
} from "@/lib/db";
import { formatAddr, formatBytes, formatDate, htmlHasOwnColors } from "@/lib/util";

const PAGE_SIZE = 50;

type ListRow = MessageRow & { thread_count: number; thread_unread: number; thread_starred: number };

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
        `SELECT m.*, 1 AS thread_count, (1 - m.is_read) AS thread_unread, m.is_starred AS thread_starred FROM messages m
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
        `SELECT m.*, s.thread_count, s.thread_unread, s.thread_starred FROM messages m
         JOIN (
           SELECT thread_id, MAX(date) AS last, COUNT(*) AS thread_count, SUM(1 - is_read) AS thread_unread,
             MAX(is_starred) AS thread_starred
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
  const unreadHere = rows.filter((r) => r.thread_unread > 0).length;

  const items: ListItem[] = rows.map((m) => ({
    key: q ? m.id : m.thread_id,
    threadId: m.thread_id,
    folder: q ? m.folder : folder,
    who:
      m.direction === "out"
        ? "To " + (parseAddrs(m.to_json).map((a) => a.name || a.address).join(", ") || "nobody")
        : m.from_name || m.from_addr,
    subject: m.subject,
    snippet: m.snippet,
    date: formatDate(m.date),
    unread: m.thread_unread > 0,
    starred: m.thread_starred > 0,
    attachments: !!m.has_attachments,
    count: m.thread_count,
  }));

  return (
    <Shell user={user} mailboxId={mailbox.id} folder={q ? undefined : folder} flash={flashFrom(request)} bleed>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-4 py-4 md:px-6">
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-semibold tracking-[-0.02em]">{q ? "Search" : label}</h1>
          <p className="text-[13px] text-muted-foreground">
            {q
              ? `Results for “${q}” in ${mailbox.address}`
              : rows.length === 0
                ? mailbox.address
                : `${rows.length}${hasMore ? "+" : ""} conversations${unreadHere ? `, ${unreadHere} unread` : ""}`}
          </p>
        </div>
        <form method="get" action={`/mb/${mailbox.id}/inbox`} role="search" className="relative w-full sm:w-96">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" type="search" placeholder="Search this mailbox" defaultValue={q} aria-label="Search mail" className="h-9 bg-card pl-9" />
        </form>
      </div>

      {folder === "spam" && !q && (
        <p className="border-b bg-muted/50 px-4 py-2 text-[13px] text-muted-foreground md:px-6">
          Spam is deleted automatically after {SPAM_RETENTION_DAYS} days. Marking a conversation “Not spam” keeps that sender in your
          inbox from now on.
        </p>
      )}

      {items.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 py-24 text-center">
          <div>
            <div className="text-lg font-semibold">{q ? "Nothing found" : `${label} is empty`}</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {q
                ? "Try a name, an address or a word from the subject."
                : folder === "inbox"
                  ? `New mail to ${mailbox.address} shows up here.`
                  : "Conversations you move here show up in this list."}
            </p>
          </div>
        </div>
      ) : (
        <MessageList mailboxId={mailbox.id} folder={folder} scope={q ? "message" : "thread"} items={items} showFolder={!!q} />
      )}

      {(page > 1 || hasMore) && (
        <div className="flex justify-end gap-2 px-4 py-4 md:px-6">
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
  const people = new Set(msgs.map((m) => m.from_addr.toLowerCase())).size;

  return (
    <Shell user={user} mailboxId={mailbox.id} folder={folder} flash={flashFrom(request)}>
      <div className="w-full">
        <a href={back} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> {FOLDERS.find((f) => f.id === folder)?.label}
        </a>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em] text-balance md:text-[32px]">
          {last.subject || "(no subject)"}
        </h1>
        <div className="mt-2 text-sm text-muted-foreground">
          {msgs.length} {msgs.length === 1 ? "message" : "messages"}, {people} {people === 1 ? "person" : "people"}
        </div>

        <div className="my-5 border-y py-1.5">
          <ThreadToolbar mailboxId={mailbox.id} threadId={params.threadId} folder={folder} />
        </div>

        <div className="flex flex-col gap-3">
          {msgs.map((m) => (
            <MessageCard
              key={m.id}
              m={m}
              mailboxId={mailbox.id}
              attachments={byMsg.get(m.id) ?? []}
              open={m.id === last.id || msgs.length <= 3}
              isLast={m.id === last.id}
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
}: {
  m: MessageRow;
  mailboxId: string;
  attachments: AttachmentRow[];
  open: boolean;
  isLast: boolean;
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
        {m.folder === "spam" && m.spam_reason && (
          <p className="mb-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            <OctagonAlert className="size-4 shrink-0" /> In spam: {m.spam_reason}
          </p>
        )}
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
          <StarButton mailboxId={mailboxId} messageId={m.id} starred={!!m.is_starred} />
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
