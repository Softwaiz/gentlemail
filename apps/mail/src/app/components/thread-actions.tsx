"use client";

import { Archive, Inbox, Mail, OctagonAlert, ShieldCheck, Star, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { navigate } from "rwsdk/client";
import { toast } from "sonner";
import { type MailAction, updateMessages } from "@/app/actions/mail";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

function useMailAction(mailboxId: string) {
  const [pending, start] = useTransition();
  const run = (input: { ids: string[]; scope: "thread" | "message"; folder?: string; action: MailAction }, then?: string) =>
    start(async () => {
      try {
        const r = await updateMessages({ mailboxId, ...input });
        if (r && !r.ok) return void toast.error(r.error);
        if (r?.message) toast.success(r.message);
        if (then) await navigate(then);
      } catch {
        toast.error("That didn't work. Check your connection and try again.");
      }
    });
  return { run, pending };
}

/** Actions above a conversation. Moving it away returns to the folder. */
export function ThreadToolbar({ mailboxId, threadId, folder }: { mailboxId: string; threadId: string; folder: string }) {
  const { run, pending } = useMailAction(mailboxId);
  const back = `/mb/${mailboxId}/${folder}`;
  const act = (action: MailAction, leave = true) => run({ ids: [threadId], scope: "thread", folder, action }, leave ? back : undefined);
  const btn = "h-8 text-[13px] text-muted-foreground";
  return (
    <div className={cn("flex flex-wrap items-center gap-1", pending && "pointer-events-none opacity-60")}>
      {folder === "spam" ? (
        <Button variant="ghost" size="sm" className={btn} onClick={() => act("inbox")}>
          <ShieldCheck /> Not spam
        </Button>
      ) : (
        folder !== "inbox" &&
        folder !== "sent" && (
          <Button variant="ghost" size="sm" className={btn} onClick={() => act("inbox")}>
            <Inbox /> Move to inbox
          </Button>
        )
      )}
      {folder !== "archive" && folder !== "sent" && folder !== "spam" && folder !== "trash" && (
        <Button variant="ghost" size="sm" className={btn} onClick={() => act("archive")}>
          <Archive /> Archive
        </Button>
      )}
      <Button variant="ghost" size="sm" className={btn} onClick={() => act("unread")}>
        <Mail /> Mark unread
      </Button>
      {(folder === "inbox" || folder === "archive") && (
        <Button variant="ghost" size="sm" className={btn} onClick={() => act("spam")}>
          <OctagonAlert /> Spam
        </Button>
      )}
      {folder === "trash" || folder === "spam" ? (
        <Button variant="ghost" size="sm" className={cn(btn, "text-destructive hover:text-destructive")} onClick={() => act("delete")}>
          <Trash2 /> Delete forever
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className={cn(btn, "text-destructive hover:text-destructive")} onClick={() => act("trash")}>
          <Trash2 /> Trash
        </Button>
      )}
    </div>
  );
}

export function StarButton({ mailboxId, messageId, starred }: { mailboxId: string; messageId: string; starred: boolean }) {
  const { run, pending } = useMailAction(mailboxId);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-muted-foreground"
      onClick={() => run({ ids: [messageId], scope: "message", action: starred ? "unstar" : "star" })}
    >
      <Star className={cn(starred && "fill-violet text-violet")} /> {starred ? "Starred" : "Star"}
    </Button>
  );
}
