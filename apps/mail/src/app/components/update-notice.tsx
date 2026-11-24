"use client";

import { CircleArrowUp } from "lucide-react";
import { useState } from "react";
import { updateLater } from "@/app/actions/updates";
import { useServerAction } from "@/app/components/action-form";
import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import type { UpdateNews } from "@/lib/updates";
import { t } from "@lingui/core/macro";

const DOCS = "https://gentlemail.dev/docs/updating/";

/** By the version in the sidebar, for admins: a newer GentleMail, what changed, and how to update. */
export function UpdateNotice({ news, announce }: { news: UpdateNews; /** Open by itself, unless closed before. */ announce: boolean }) {
  const newest = news.releases[0].version;
  const [open, setOpen] = useState(announce && !news.later);
  const { run } = useServerAction(updateLater);
  const steps = news.releases.filter((r) => r.sections.Upgrading);
  const secure = news.releases.some((r) => r.sections.Security);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // However it's closed: it doesn't open by itself again for this version.
    if (!next && !news.later) run();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-3 mt-1 flex items-center gap-1.5 text-left text-[11px] font-medium text-sidebar-foreground tabular-nums underline-offset-2 hover:underline"
      >
        <CircleArrowUp className="size-3.5 text-unread" /> {t({ id: "updates.available", message: `GentleMail ${newest} is available` })}
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl"
          // Focus the dialog itself: the first thing in it that takes focus is the text that scrolls.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t({ id: "updates.available", message: `GentleMail ${newest} is available` })}</DialogTitle>
            <DialogDescription>
              {secure
                ? t({ id: "updates.have_secure", message: `You have ${news.current}. The update includes security changes.` })
                : t({ id: "updates.have", message: `You have ${news.current}.` })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-y-auto text-sm focus-visible:outline-none" tabIndex={0}>
            {steps.length > 0 && (
              <section className="rounded-md border border-l-4 p-3">
                <h3 className="font-semibold">{t({ id: "updates.steps", message: "Before you update" })}</h3>
                {steps.map((r) => (
                  <div key={r.version} className="mt-2" lang="en">
                    <div className="text-xs font-medium text-muted-foreground tabular-nums">{r.version}</div>
                    <Lines lines={r.sections.Upgrading} />
                  </div>
                ))}
              </section>
            )}
            <section>
              <h3 className="font-semibold">{t({ id: "updates.how", message: "How to update" })}</h3>
              <p className="mt-1 text-muted-foreground">{t({ id: "updates.how_clone", message: "From your copy of the repository (a clone or a fork):" })}</p>
              <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">git pull --no-rebase upstream main && git push</pre>
              <p className="mt-2 text-muted-foreground">
                {t({ id: "updates.how_other", message: "Pushing deploys it if your repository is connected to Cloudflare. Installed with the Deploy button, or deploying by hand: follow the guide." })}
              </p>
            </section>
            <section>
              <h3 className="font-semibold">{t({ id: "updates.changes", message: "What changed" })}</h3>
              {news.releases.map((r) => (
                <div key={r.version} className="mt-3" lang="en">
                  <div className="text-xs font-semibold tabular-nums">
                    {r.version} {r.date && <span className="font-normal text-muted-foreground">{r.date}</span>}
                  </div>
                  {Object.entries(r.sections)
                    .filter(([name]) => name !== "Upgrading")
                    .map(([name, lines]) => (
                      <div key={name} className="mt-1.5">
                        <div className="text-xs font-medium text-muted-foreground">{name}</div>
                        <Lines lines={lines} />
                      </div>
                    ))}
                </div>
              ))}
            </section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t({ id: "updates.later", message: "Later" })}
            </Button>
            <Button asChild>
              <a href={DOCS} target="_blank" rel="noreferrer">
                {t({ id: "updates.guide", message: "Open the guide" })}
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-1 pl-4">
      {lines.map((line, i) => (
        <li key={i} className="wrap-anywhere">
          {line}
        </li>
      ))}
    </ul>
  );
}
