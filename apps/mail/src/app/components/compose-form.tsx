"use client";

import { Paperclip, Send } from "lucide-react";
import { useState } from "react";
import { sendMessage } from "@/app/actions/mail";
import { FormError, useServerAction } from "@/app/components/action-form";
import { Button } from "@/app/components/ui/button";
import { formatBytes } from "@/lib/util";

/** Wraps the compose fields; posts them with attachments to the sendMessage server action. */
export function ComposeForm({ children, discardHref }: { children: React.ReactNode; discardHref: string }) {
  const { run, pending, error } = useServerAction(sendMessage);
  const [files, setFiles] = useState<File[]>([]);
  const total = files.reduce((n, f) => n + f.size, 0);
  return (
    <form
      className="overflow-hidden rounded-lg border bg-card"
      onSubmit={(e) => {
        e.preventDefault();
        run(new FormData(e.currentTarget));
      }}
    >
      {children}
      {error && (
        <div className="px-5 pb-4">
          <FormError error={error} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t bg-muted/40 px-5 py-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-within:ring-2 focus-within:ring-ring/50">
          <Paperclip className="size-4" /> Attach files
          <input type="file" name="files" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </label>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {files.length
            ? `${files.map((f) => f.name).join(", ")} (${formatBytes(total)}${total > 25 * 1024 * 1024 ? ", over the 25 MB limit" : ""})`
            : "Up to 25 MB in total"}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" asChild>
          <a href={discardHref}>Discard</a>
        </Button>
        <Button type="submit" className="min-w-28" disabled={pending}>
          <Send /> {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
