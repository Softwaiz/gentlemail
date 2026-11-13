"use client";

import { Archive, Inbox, Mail, MailOpen, OctagonAlert, Paperclip, ShieldCheck, Star, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { type MailAction, updateMessages } from "@/app/actions/mail";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/app/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ListItem = {
  /** Thread id, or message id in search results. */
  key: string;
  threadId: string;
  folder: string;
  who: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  attachments: boolean;
  count: number;
};

type Props = {
  mailboxId: string;
  folder: string;
  scope: "thread" | "message";
  items: ListItem[];
  showFolder?: boolean;
};

/** Which moves make sense from a folder. */
function movesFor(folder: string) {
  return {
    archive: folder !== "archive" && folder !== "sent" && folder !== "trash" && folder !== "spam",
    inbox: folder === "archive" || folder === "trash",
    notSpam: folder === "spam",
    spam: folder === "inbox" || folder === "archive",
    forever: folder === "trash" || folder === "spam",
  };
}

export function MessageList({ mailboxId, folder, scope, items, showFolder }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  // The list re-renders from the server after each action: drop selections that are gone.
  useEffect(() => setSelected((s) => new Set([...s].filter((k) => items.some((i) => i.key === k)))), [items]);

  const run = (action: MailAction, keys: string[]) =>
    start(async () => {
      try {
        const r = await updateMessages({ mailboxId, ids: keys, scope, folder: scope === "thread" ? folder : undefined, action });
        if (r && !r.ok) toast.error(r.error);
        else if (r?.message) toast.success(r.message);
        setSelected(new Set());
      } catch {
        toast.error("That didn't work. Check your connection and try again.");
      }
    });

  const all = items.length > 0 && selected.size === items.length;
  const some = selected.size > 0 && !all;
  const keys = [...selected];
  const chosen = items.filter((i) => selected.has(i.key));
  const anyUnread = chosen.some((i) => i.unread);
  const m = movesFor(folder);

  return (
    <TooltipProvider delayDuration={400}>
    <div className={cn("flex min-h-0 flex-1 flex-col", pending && "opacity-70 transition-opacity")}>
      <div className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b bg-background/95 px-4 backdrop-blur md:px-6">
        <Checkbox
          checked={all ? true : some ? "indeterminate" : false}
          onCheckedChange={(v) => setSelected(v ? new Set(items.map((i) => i.key)) : new Set())}
          aria-label="Select all"
          className="mr-3"
        />
        {selected.size === 0 ? (
          <span className="text-[13px] text-muted-foreground">Select conversations to act on several at once</span>
        ) : (
          <>
            <span className="mr-2 text-[13px] font-medium tabular-nums">{selected.size} selected</span>
            {m.archive && <Bulk icon={Archive} label="Archive" onClick={() => run("archive", keys)} />}
            {m.inbox && <Bulk icon={Inbox} label="Move to inbox" onClick={() => run("inbox", keys)} />}
            {m.notSpam && <Bulk icon={ShieldCheck} label="Not spam" onClick={() => run("inbox", keys)} />}
            {anyUnread ? (
              <Bulk icon={MailOpen} label="Mark read" onClick={() => run("read", keys)} />
            ) : (
              <Bulk icon={Mail} label="Mark unread" onClick={() => run("unread", keys)} />
            )}
            {m.spam && <Bulk icon={OctagonAlert} label="Spam" onClick={() => run("spam", keys)} />}
            {m.forever ? (
              <Bulk icon={Trash2} label="Delete forever" danger onClick={() => run("delete", keys)} />
            ) : (
              <Bulk icon={Trash2} label="Trash" danger onClick={() => run("trash", keys)} />
            )}
          </>
        )}
      </div>

      <ul className="divide-y">
        {items.map((i) => (
          <li
            key={i.key}
            className={cn(
              "group relative flex items-center gap-3 pr-2 pl-4 transition-colors hover:bg-accent/60 md:pl-6",
              selected.has(i.key) && "bg-accent/70",
              i.unread && "bg-card",
            )}
          >
            {i.unread && <span className="absolute inset-y-0 left-0 w-[3px] bg-unread" aria-hidden="true" />}
            <Checkbox
              checked={selected.has(i.key)}
              onCheckedChange={(v) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (v) n.add(i.key);
                  else n.delete(i.key);
                  return n;
                })
              }
              aria-label={`Select ${i.subject}`}
            />
            <button
              type="button"
              onClick={() => run(i.starred ? "unstar" : "star", [i.key])}
              aria-label={i.starred ? "Remove star" : "Star"}
              className="hidden text-muted-foreground/60 hover:text-foreground sm:block"
            >
              <Star className={cn("size-4", i.starred && "fill-violet text-violet")} />
            </button>
            <a
              href={`/mb/${mailboxId}/thread/${i.threadId}?f=${i.folder}`}
              className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-3 md:grid-cols-[minmax(140px,220px)_minmax(0,1fr)_auto]"
            >
              <span className={cn("flex min-w-0 items-center gap-2", i.unread ? "font-semibold text-foreground" : "text-muted-foreground")}>
                <span className="truncate">{i.who}</span>
                {i.count > 1 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{i.count}</span>}
              </span>
              <span className="col-span-2 row-start-2 min-w-0 truncate md:col-span-1 md:row-start-auto">
                {showFolder && (
                  <span className="mr-2 rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground capitalize">{i.folder}</span>
                )}
                <span className={i.unread ? "font-semibold" : "font-medium"}>{i.subject || "(no subject)"}</span>
                <span className="ml-2 text-muted-foreground">{i.snippet}</span>
              </span>
              <span className="flex items-center gap-2 justify-self-end text-xs whitespace-nowrap text-muted-foreground tabular-nums md:group-hover:invisible">
                {i.attachments && <Paperclip className="size-3.5" aria-label="Has attachments" />}
                <time className={cn(i.unread && "font-semibold text-foreground")}>{i.date}</time>
              </span>
            </a>
            {/* Quick actions replace the date on hover (desktop). */}
            <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-accent md:group-hover:flex md:group-focus-within:flex">
              {m.archive && <Quick icon={Archive} label="Archive" onClick={() => run("archive", [i.key])} />}
              {m.inbox && <Quick icon={Inbox} label="Move to inbox" onClick={() => run("inbox", [i.key])} />}
              {m.notSpam && <Quick icon={ShieldCheck} label="Not spam" onClick={() => run("inbox", [i.key])} />}
              {i.unread ? (
                <Quick icon={MailOpen} label="Mark read" onClick={() => run("read", [i.key])} />
              ) : (
                <Quick icon={Mail} label="Mark unread" onClick={() => run("unread", [i.key])} />
              )}
              {m.spam && <Quick icon={OctagonAlert} label="Spam" onClick={() => run("spam", [i.key])} />}
              {m.forever ? (
                <Quick icon={Trash2} label="Delete forever" onClick={() => run("delete", [i.key])} />
              ) : (
                <Quick icon={Trash2} label="Trash" onClick={() => run("trash", [i.key])} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
    </TooltipProvider>
  );
}

type Icon = React.ComponentType<{ className?: string }>;

function Bulk({ icon: I, label, onClick, danger }: { icon: Icon; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
        danger && "text-destructive hover:text-destructive",
      )}
    >
      <I className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Quick({ icon: I, label, onClick }: { icon: Icon; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <I className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
