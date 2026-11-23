"use client";

import { Paperclip, Send } from "lucide-react";
import { useState } from "react";
import { sendMessage } from "@/app/actions/mail";
import { FormError, useServerAction } from "@/app/components/action-form";
import { Button } from "@/app/components/ui/button";
import { formatBytes } from "@/lib/util";
import { t } from "@lingui/core/macro";

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
          <Paperclip className="size-4" /> {t({ id: "composer.attach", message: "Attach files" })}
          <input type="file" name="files" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </label>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {files.length
            ? total > 25 * 1024 * 1024
              ? t({ id: "composer.files_over", message: `${files.map((f) => f.name).join(", ")} (${formatBytes(total)}, over the 25 MB limit)` })
              : t({ id: "composer.files", message: `${files.map((f) => f.name).join(", ")} (${formatBytes(total)})` })
            : t({ id: "composer.files_limit", message: "Up to 25 MB in total" })}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" asChild>
          <a href={discardHref}>{t({ id: "composer.discard", message: "Discard" })}</a>
        </Button>
        <Button type="submit" className="min-w-28" disabled={pending}>
          <Send /> {pending ? t({ id: "composer.sending", message: "Sending…" }) : t({ id: "composer.send", message: "Send" })}
        </Button>
      </div>
    </form>
  );
}
