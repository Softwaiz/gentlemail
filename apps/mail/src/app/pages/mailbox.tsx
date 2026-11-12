import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { Shell, flashFrom } from "@/app/components/shell";
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
import { formatAddr, formatBytes, formatDate } from "@/lib/util";

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

  return (
    <Shell user={user} mailboxId={mailbox.id} folder={q ? undefined : folder} flash={flashFrom(request)}>
      <header className="toolbar">
        <div>
          <h1>{q ? `Search: “${q}”` : label}</h1>
          <div className="muted small">{mailbox.address}</div>
        </div>
        <form method="get" action={`/mb/${mailbox.id}/inbox`} className="search">
          <input name="q" type="search" placeholder="Search mail" defaultValue={q} />
        </form>
      </header>

      <form method="post" action={`/mb/${mailbox.id}/actions`}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="folder" value={folder} />
        <input type="hidden" name="scope" value={q ? "message" : "thread"} />
        <div className="bulkbar">
          <span className="muted small">With selected:</span>
          {folder !== "inbox" && <ActionBtn value="inbox">Move to inbox</ActionBtn>}
          {folder !== "archive" && folder !== "sent" && <ActionBtn value="archive">Archive</ActionBtn>}
          <ActionBtn value="read">Mark read</ActionBtn>
          <ActionBtn value="unread">Mark unread</ActionBtn>
          {folder !== "spam" && folder !== "sent" && <ActionBtn value="spam">Spam</ActionBtn>}
          {folder === "trash" ? (
            <ActionBtn value="delete" danger>
              Delete forever
            </ActionBtn>
          ) : (
            <ActionBtn value="trash" danger>
              Trash
            </ActionBtn>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="empty">{q ? "No messages match your search." : `No messages in ${label}.`}</div>
        ) : (
          <ul className="msg-list">
            {rows.map((m) => {
              const unread = m.thread_unread > 0;
              const who =
                m.direction === "out"
                  ? "To: " + (parseAddrs(m.to_json).map((a) => a.name || a.address).join(", ") || "—")
                  : m.from_name || m.from_addr;
              return (
                <li key={m.id} className={`msg-row ${unread ? "unread" : ""}`}>
                  <input
                    type="checkbox"
                    name="ids"
                    value={q ? m.id : m.thread_id}
                    aria-label="Select"
                  />
                  <a
                    className="msg-link"
                    href={`/mb/${mailbox.id}/thread/${m.thread_id}?f=${q ? m.folder : folder}`}
                  >
                    <span className="msg-from truncate">
                      {m.is_starred ? "★ " : ""}
                      {who}
                      {m.thread_count > 1 && <span className="count"> {m.thread_count}</span>}
                    </span>
                    <span className="msg-subject truncate">
                      <strong>{m.subject}</strong>
                      <span className="muted"> — {m.snippet}</span>
                    </span>
                    <span className="msg-meta">
                      {q && <span className="tag">{m.folder}</span>}
                      {m.has_attachments ? <span title="Has attachments">📎</span> : null}
                      <time>{formatDate(m.date)}</time>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </form>

      <div className="pager">
        {page > 1 && (
          <a className="btn btn-ghost" href={pageUrl(url, page - 1)}>
            ← Newer
          </a>
        )}
        {hasMore && (
          <a className="btn btn-ghost" href={pageUrl(url, page + 1)}>
            Older →
          </a>
        )}
      </div>
    </Shell>
  );
}

const pageUrl = (url: URL, p: number) => {
  const u = new URL(url);
  u.searchParams.set("page", String(p));
  return u.pathname + u.search;
};

function ActionBtn({ value, children, danger }: { value: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="submit" name="action" value={value} className={`btn btn-sm ${danger ? "btn-danger" : "btn-ghost"}`}>
      {children}
    </button>
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

  return (
    <Shell user={user} mailboxId={mailbox.id} folder={folder} flash={flashFrom(request)}>
      <header className="toolbar">
        <div>
          <a href={back} className="muted small">
            ← Back to {FOLDERS.find((f) => f.id === folder)?.label}
          </a>
          <h1>{last.subject}</h1>
        </div>
      </header>

      <form method="post" action={`/mb/${mailbox.id}/actions`} className="bulkbar">
        <input type="hidden" name="ids" value={params.threadId} />
        <input type="hidden" name="scope" value="thread" />
        <input type="hidden" name="back" value={here} />
        <input type="hidden" name="after" value={back} />
        {folder !== "inbox" && <ActionBtn value="inbox">Move to inbox</ActionBtn>}
        {folder !== "archive" && folder !== "sent" && <ActionBtn value="archive">Archive</ActionBtn>}
        <button type="submit" name="action" value="unread" className="btn btn-sm btn-ghost" formAction={`/mb/${mailbox.id}/actions`}>
          Mark unread
        </button>
        {folder !== "spam" && folder !== "sent" && <ActionBtn value="spam">Spam</ActionBtn>}
        {folder === "trash" ? (
          <ActionBtn value="delete" danger>
            Delete forever
          </ActionBtn>
        ) : (
          <ActionBtn value="trash" danger>
            Trash
          </ActionBtn>
        )}
      </form>

      <div className="thread">
        {msgs.map((m) => (
          <MessageCard key={m.id} m={m} mailboxId={mailbox.id} attachments={byMsg.get(m.id) ?? []} open={m.id === last.id || msgs.length <= 3} here={here} />
        ))}
      </div>

      <div className="reply-bar">
        <a className="btn btn-primary" href={`/mb/${mailbox.id}/compose?reply=${lastIncoming.id}`}>
          ↩ Reply
        </a>
        <a className="btn btn-ghost" href={`/mb/${mailbox.id}/compose?reply=${lastIncoming.id}&all=1`}>
          ↩↩ Reply all
        </a>
        <a className="btn btn-ghost" href={`/mb/${mailbox.id}/compose?forward=${last.id}`}>
          ↪ Forward
        </a>
      </div>
    </Shell>
  );
}

function MessageCard({
  m,
  mailboxId,
  attachments,
  open,
  here,
}: {
  m: MessageRow;
  mailboxId: string;
  attachments: AttachmentRow[];
  open: boolean;
  here: string;
}) {
  const to = parseAddrs(m.to_json);
  const cc = parseAddrs(m.cc_json);
  const bcc = parseAddrs(m.bcc_json);
  const hasHtml = !!(m.html_body || m.html_key);
  const files = attachments.filter((a) => a.disposition !== "inline" || !a.content_id);

  return (
    <details className="msg-card" open={open}>
      <summary>
        <div className="avatar">{(m.from_name || m.from_addr).slice(0, 1).toUpperCase()}</div>
        <div className="msg-head">
          <div>
            <strong>{m.from_name || m.from_addr}</strong>{" "}
            {m.from_name && <span className="muted small">&lt;{m.from_addr}&gt;</span>}
          </div>
          <div className="muted small truncate">
            to {to.map(formatAddr).join(", ") || "—"}
            {cc.length > 0 && <> · cc {cc.map(formatAddr).join(", ")}</>}
            {bcc.length > 0 && <> · bcc {bcc.map(formatAddr).join(", ")}</>}
          </div>
        </div>
        <div className="muted small nowrap">
          {files.length > 0 && "📎 "}
          {formatDate(m.date, true)}
        </div>
      </summary>

      <div className="msg-body">
        {hasHtml ? (
          <>
            <MailFrame src={`/body/${m.id}`} title={m.subject} />
            <div className="small muted body-tools">
              Remote images are blocked for privacy.{" "}
              <a href={`/body/${m.id}?images=1`} target="_blank" rel="noopener">
                Open with images
              </a>
            </div>
          </>
        ) : (
          <pre className="plain">{m.text_body ?? ""}</pre>
        )}

        {files.length > 0 && (
          <div className="attachments">
            {files.map((a) => (
              <div key={a.id} className="att">
                {a.content_type.startsWith("image/") ? (
                  <a href={`/attachments/${a.id}?inline=1`} target="_blank" rel="noopener">
                    <img src={`/attachments/${a.id}?inline=1`} alt={a.filename} loading="lazy" />
                  </a>
                ) : (
                  <div className="att-icon">{(a.filename.split(".").pop() ?? "file").slice(0, 4).toUpperCase()}</div>
                )}
                <div className="att-info">
                  <div className="truncate" title={a.filename}>
                    {a.filename}
                  </div>
                  <div className="muted small">
                    {formatBytes(a.size)} ·{" "}
                    {/^(image\/|application\/pdf|text\/plain)/.test(a.content_type) && (
                      <>
                        <a href={`/attachments/${a.id}?inline=1`} target="_blank" rel="noopener">
                          View
                        </a>{" "}
                        ·{" "}
                      </>
                    )}
                    <a href={`/attachments/${a.id}`}>Download</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="msg-actions">
          <a className="btn btn-sm btn-ghost" href={`/mb/${mailboxId}/compose?reply=${m.id}`}>
            Reply
          </a>
          <a className="btn btn-sm btn-ghost" href={`/mb/${mailboxId}/compose?reply=${m.id}&all=1`}>
            Reply all
          </a>
          <a className="btn btn-sm btn-ghost" href={`/mb/${mailboxId}/compose?forward=${m.id}`}>
            Forward
          </a>
          <form method="post" action={`/mb/${mailboxId}/actions`} className="inline">
            <input type="hidden" name="ids" value={m.id} />
            <input type="hidden" name="scope" value="message" />
            <input type="hidden" name="back" value={here} />
            <button className="btn btn-sm btn-ghost" name="action" value={m.is_starred ? "unstar" : "star"}>
              {m.is_starred ? "★ Unstar" : "☆ Star"}
            </button>
          </form>
          {m.raw_key && (
            <a className="btn btn-sm btn-ghost" href={`/raw/${m.id}`}>
              Download .eml
            </a>
          )}
        </div>
      </div>
    </details>
  );
}
