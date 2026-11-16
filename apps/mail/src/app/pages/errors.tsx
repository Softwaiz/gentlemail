import { Lock, SearchX } from "lucide-react";
import type { RequestInfo } from "rwsdk/worker";
import { Shell } from "@/app/components/shell";
import { Button } from "@/app/components/ui/button";
import { AuthCard } from "@/app/pages/auth";
import type { User } from "@/lib/auth";

/*
 * "Not found" and "Access restricted" pages. They render inside the app (with
 * the sidebar) for signed-in people, so switching mailbox is one click away.
 */

export type ErrorKind = "page" | "mailbox" | "message" | "domain" | "webhook" | "mailbox-restricted" | "admin-restricted";

const ERRORS: Record<ErrorKind, { status: 404 | 403; title: string; body: string }> = {
  page: {
    status: 404,
    title: "Page not found",
    body: "There's nothing at this address. The link may be mistyped or out of date.",
  },
  mailbox: {
    status: 404,
    title: "Mailbox not found",
    body: "This mailbox doesn't exist. It may have been deleted, or the link is wrong.",
  },
  message: {
    status: 404,
    title: "Message not found",
    body: "This conversation isn't in this mailbox. It may have been deleted for good, or the link is wrong.",
  },
  domain: {
    status: 404,
    title: "Domain not found",
    body: "This domain doesn't exist. It may have been removed, or the link is wrong.",
  },
  webhook: {
    status: 404,
    title: "Webhook not found",
    body: "This webhook doesn't exist. It may have been deleted, or the link is wrong.",
  },
  "mailbox-restricted": {
    status: 403,
    title: "Access restricted",
    body: "You don't have permission to view this mailbox. Ask an admin to give you access.",
  },
  "admin-restricted": {
    status: 403,
    title: "Access restricted",
    body: "Only admins can open this page.",
  },
};

export function ErrorPage({ kind, user, mailboxId }: { kind: ErrorKind; user: User | null; mailboxId?: string }) {
  const e = ERRORS[kind];
  const restricted = e.status === 403;
  const Icon = restricted ? Lock : SearchX;

  if (!user) {
    return (
      <AuthCard title={e.title}>
        <p className="text-sm text-muted-foreground">{e.body}</p>
        <Button asChild variant="outline" className="mt-5 w-full">
          <a href="/login">Sign in</a>
        </Button>
      </AuthCard>
    );
  }

  return (
    <Shell user={user} mailboxId={mailboxId}>
      <section aria-labelledby="error-title" className="grid flex-1 place-items-center py-16">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <Icon className="size-6" />
          </div>
          <p className="text-[13px] font-semibold tracking-[0.08em] text-muted-foreground uppercase tabular-nums">
            Error {e.status}
          </p>
          <h1 id="error-title" className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.025em] text-balance">
            {e.title}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-pretty text-muted-foreground">{e.body}</p>
          {restricted && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              You're signed in as <span className="font-medium text-foreground">{user.email}</span>.
            </p>
          )}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            <Button asChild>
              <a href="/">Back to your mail</a>
            </Button>
            {restricted && (
              <form method="post" action="/logout">
                <Button variant="outline">Sign in as someone else</Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </Shell>
  );
}

/** Route middleware: answer with the error page and its real HTTP status. */
export function showError(ri: RequestInfo, kind: ErrorKind, mailboxId?: string) {
  ri.response.status = ERRORS[kind].status;
  return <ErrorPage kind={kind} user={ri.ctx.user ?? null} mailboxId={mailboxId} />;
}

/**
 * For a page whose record is missing while it renders. After a server action
 * (e.g. "Delete mailbox") rwsdk re-renders the current page; the record is gone
 * on purpose and the client is about to follow the action's redirect, so show
 * an empty frame instead of an error. Otherwise it's a genuine "not found".
 */
export function missing(ri: RequestInfo, kind: ErrorKind) {
  if (ri.isAction) return <Shell user={ri.ctx.user!}>{null}</Shell>;
  return <ErrorPage kind={kind} user={ri.ctx.user ?? null} />;
}
